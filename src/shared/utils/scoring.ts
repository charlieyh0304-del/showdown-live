import type { SetScore, GameConfig, MatchType, ScoringRules, ScoreActionType, ScoreHistoryEntry, Match, Tournament, TournamentStage } from '../types';
import { formatTime } from '@shared/utils/locale';

export const DEFAULT_GAME_CONFIG = {
  SETS_TO_WIN: 2,
  MAX_SETS: 3,
  POINTS_TO_WIN: 11,
  MIN_POINT_DIFF: 2,
} as const;

export const TEAM_GAME_CONFIG = {
  SETS_TO_WIN: 1,
  MAX_SETS: 1,
  POINTS_TO_WIN: 31,
  MIN_POINT_DIFF: 2,
} as const;

export function getEffectiveGameConfig(
  gameConfigOrRules?: GameConfig | ScoringRules,
  matchType?: MatchType,
) {
  // ScoringRules (확장 타입) 지원
  if (gameConfigOrRules && 'minLead' in gameConfigOrRules) {
    const rules = gameConfigOrRules as ScoringRules;
    return {
      SETS_TO_WIN: rules.setsToWin,
      MAX_SETS: rules.maxSets,
      POINTS_TO_WIN: rules.winScore,
      MIN_POINT_DIFF: rules.minLead,
    };
  }

  // 기존 로직 (하위 호환)
  if (matchType === 'team') return TEAM_GAME_CONFIG;
  if (!gameConfigOrRules) return DEFAULT_GAME_CONFIG;

  const gc = gameConfigOrRules as GameConfig;
  return {
    SETS_TO_WIN: gc.setsToWin,
    MAX_SETS: gc.setsToWin * 2 - 1,
    POINTS_TO_WIN: gc.winScore,
    MIN_POINT_DIFF: 2,
  };
}

export function checkSetWinner(
  player1Score: number,
  player2Score: number,
  config?: ReturnType<typeof getEffectiveGameConfig>,
  deuceCap?: number,
): 1 | 2 | null {
  const { POINTS_TO_WIN, MIN_POINT_DIFF } = config || DEFAULT_GAME_CONFIG;

  // 듀스 캡: 캡 점수 도달 시 1점 차로도 승리
  if (deuceCap && (player1Score >= deuceCap || player2Score >= deuceCap)) {
    if (player1Score > player2Score) return 1;
    if (player2Score > player1Score) return 2;
    return null;
  }

  if (player1Score >= POINTS_TO_WIN && player1Score - player2Score >= MIN_POINT_DIFF) return 1;
  if (player2Score >= POINTS_TO_WIN && player2Score - player1Score >= MIN_POINT_DIFF) return 2;
  return null;
}

export function checkMatchWinner(
  sets: SetScore[],
  config?: ReturnType<typeof getEffectiveGameConfig>
): 1 | 2 | null {
  const effectiveConfig = config || DEFAULT_GAME_CONFIG;
  let p1 = 0, p2 = 0;
  for (const set of sets) {
    const winner = checkSetWinner(set.player1Score, set.player2Score, effectiveConfig);
    if (winner === 1) p1++;
    if (winner === 2) p2++;
  }
  if (p1 >= effectiveConfig.SETS_TO_WIN) return 1;
  if (p2 >= effectiveConfig.SETS_TO_WIN) return 2;
  return null;
}

export function createEmptySet(): SetScore {
  return {
    player1Score: 0, player2Score: 0,
    player1Faults: 0, player2Faults: 0,
    player1Violations: 0, player2Violations: 0,
    winnerId: null,
  };
}

export function countSetWins(sets: SetScore[], config?: ReturnType<typeof getEffectiveGameConfig>) {
  let p1 = 0, p2 = 0;
  for (const set of sets) {
    const w = checkSetWinner(set.player1Score, set.player2Score, config);
    if (w === 1) p1++;
    if (w === 2) p2++;
  }
  return { player1: p1, player2: p2 };
}

// ===== IBSA 서브 로테이션 =====
// 개인전: 2회 서브 후 교대, 팀전: 3회 서브 후 교대
export function getMaxServes(matchType: MatchType): number {
  return matchType === 'team' ? 3 : 2;
}

export function advanceServe(
  currentServe: 'player1' | 'player2',
  serveCount: number,
  matchType: MatchType,
): { currentServe: 'player1' | 'player2'; serveCount: number } {
  const maxServes = getMaxServes(matchType);
  const nextCount = serveCount + 1;
  if (nextCount >= maxServes) {
    return {
      currentServe: currentServe === 'player1' ? 'player2' : 'player1',
      serveCount: 0,
    };
  }
  return { currentServe, serveCount: nextCount };
}

// ===== 골든골 (시간 제한 경기) =====
//
// 시간 제한이 설정된 경기에서 시간이 만료되면 골든골 모드 진입.
// 모드 진입 후 다음 GOAL을 넣은 선수가 즉시 승자.
// 파울/규칙 위반은 점수에 반영되지 않음 (단, 이벤트 자체는 history에 기록 가능).

/**
 * 골든골 활성 여부 판단.
 * matchStartedAt이나 timeLimitSeconds가 없으면 항상 false (시간 제한 없는 경기).
 */
export function isGoldenGoalActive(
  matchStartedAt: number | undefined | null,
  now: number,
  timeLimitSeconds: number | undefined | null,
): boolean {
  if (!matchStartedAt || !timeLimitSeconds || timeLimitSeconds <= 0) return false;
  return (now - matchStartedAt) >= timeLimitSeconds * 1000;
}

/**
 * 골든골 모드에서 점수 이벤트 처리.
 * - 'goal': 득점 선수에게 +2 적용 후 즉시 승자 반환
 * - 'foul': 점수 변경 없음, winner null (이벤트는 호출자가 history에 기록)
 *
 * 일반 모드(골든골 비활성)에서는 호출하지 말 것 — 평소 점수 로직 사용.
 */
export function applyGoldenGoalEvent(
  event: 'goal' | 'foul',
  scorer: 1 | 2,
  currentScores: { player1: number; player2: number },
): { newScores: { player1: number; player2: number }; winner: 1 | 2 | null } {
  if (event === 'foul') {
    return { newScores: { ...currentScores }, winner: null };
  }
  // goal: +2 to scorer, 즉시 승자
  const newScores = {
    player1: currentScores.player1 + (scorer === 1 ? 2 : 0),
    player2: currentScores.player2 + (scorer === 2 ? 2 : 0),
  };
  return { newScores, winner: scorer };
}

// Undo 시 서브 되돌리기
export function revertServe(
  currentServe: 'player1' | 'player2',
  serveCount: number,
  matchType: MatchType,
): { currentServe: 'player1' | 'player2'; serveCount: number } {
  const maxServes = getMaxServes(matchType);
  const prevCount = serveCount - 1;
  if (prevCount < 0) {
    return {
      currentServe: currentServe === 'player1' ? 'player2' : 'player1',
      serveCount: maxServes - 1,
    };
  }
  return { currentServe, serveCount: prevCount };
}

// 사이드 체인지 체크
export function shouldSideChange(
  matchType: MatchType,
  set: SetScore,
  sideChangeUsed: boolean,
  sets: SetScore[],
  config: ReturnType<typeof getEffectiveGameConfig>,
): boolean {
  if (sideChangeUsed) return false;
  const sideChangePoint = matchType === 'team' ? 16 : 6;
  const maxScore = Math.max(set.player1Score, set.player2Score);

  if (matchType === 'individual') {
    // 개인전: 결정 세트(양쪽 모두 SETS_TO_WIN-1 승)에서만 사이드 체인지
    const setWins = countSetWins(sets.slice(0, -1), config);
    const isDecidingSet = setWins.player1 === config.SETS_TO_WIN - 1 && setWins.player2 === config.SETS_TO_WIN - 1;
    return isDecidingSet && maxScore >= sideChangePoint;
  }
  // 팀전: 항상
  return maxScore >= sideChangePoint;
}

// 득점 히스토리 항목 생성
export function createScoreHistoryEntry(opts: {
  scoringPlayer: string;
  actionPlayer: string;
  actionType: ScoreActionType;
  actionLabel: string;
  points: number;
  set: number;
  server: string;
  serveNumber: number;
  scoreBefore: { player1: number; player2: number };
  scoreAfter: { player1: number; player2: number };
  serverSide?: 'player1' | 'player2';
}): ScoreHistoryEntry {
  return {
    time: formatTime(),
    ...opts,
  };
}

// ===== 스코어링 규칙 우선순위 체인 =====
// match.appliedScoringRules > stage.scoringRules > tournament.scoringRules > gameConfig
export function getEffectiveScoringRules(
  match: Match,
  tournament: Tournament,
): ReturnType<typeof getEffectiveGameConfig> {
  if (match.appliedScoringRules) {
    return getEffectiveGameConfig(match.appliedScoringRules);
  }
  if (match.stageId && tournament.stages) {
    // Defensive: tournament.stages may still be a Firebase object if not normalized
    const stages = Array.isArray(tournament.stages) ? tournament.stages : Object.values(tournament.stages) as TournamentStage[];
    const stage = stages.find((s: TournamentStage) => s.id === match.stageId);
    if (stage?.scoringRules) {
      return getEffectiveGameConfig(stage.scoringRules);
    }
  }
  if (tournament.scoringRules) {
    return getEffectiveGameConfig(tournament.scoringRules);
  }
  return getEffectiveGameConfig(tournament.gameConfig, match.type);
}

/**
 * match + tournament에서 유효 시간 제한(초)을 추출.
 * 우선순위: match.appliedScoringRules > stage.scoringRules > tournament.scoringRules
 * 0/없음 = 시간 제한 없음.
 */
export function getEffectiveTimeLimitSeconds(
  match: Match,
  tournament: Tournament,
): number {
  if (match.appliedScoringRules?.timeLimitSeconds) return match.appliedScoringRules.timeLimitSeconds;
  if (match.stageId && tournament.stages) {
    const stages = Array.isArray(tournament.stages) ? tournament.stages : Object.values(tournament.stages) as TournamentStage[];
    const stage = stages.find((s: TournamentStage) => s.id === match.stageId);
    if (stage?.scoringRules?.timeLimitSeconds) return stage.scoringRules.timeLimitSeconds;
  }
  if (tournament.scoringRules?.timeLimitSeconds) return tournament.scoringRules.timeLimitSeconds;
  return 0;
}

/**
 * 각 세트의 첫 서버를 기준으로 점수를 [serverScore, receiverScore] 형태로 반환.
 * IBSA 쇼다운 기록지 규칙: 서브권 있는 선수의 점수를 먼저 표시.
 */
export function getSetScoresByServer(match: Match): Array<{ serverScore: number; receiverScore: number; serverSide: 'player1' | 'player2' }> {
  const sets = match.sets || [];
  if (sets.length === 0) return [];

  // 1. scoreHistory에서 각 세트 첫 서버 판별
  const setServerMap = new Map<number, 'player1' | 'player2'>();
  if (match.scoreHistory && match.scoreHistory.length > 0) {
    // scoreHistory는 newest-first → reverse
    const ordered = [...match.scoreHistory].reverse();
    for (const entry of ordered) {
      if (entry.serverSide && !setServerMap.has(entry.set)) {
        setServerMap.set(entry.set, entry.serverSide);
      }
    }
  }

  // 2. scoreHistory에 없으면 coinToss로 추정
  let firstServer: 'player1' | 'player2' = 'player1';
  if (setServerMap.has(1)) {
    firstServer = setServerMap.get(1)!;
  } else if (match.coinTossWinner && match.coinTossChoice) {
    if (match.coinTossChoice === 'serve') {
      firstServer = match.coinTossWinner.replace('team', 'player') as 'player1' | 'player2';
    } else {
      const w = match.coinTossWinner.replace('team', 'player');
      firstServer = w === 'player1' ? 'player2' : 'player1';
    }
  }

  return sets.map((s, i) => {
    const setNum = i + 1;
    // scoreHistory 우선, 없으면 홀수 세트=firstServer, 짝수 세트=opposite
    const server = setServerMap.get(setNum) ?? (i % 2 === 0 ? firstServer : (firstServer === 'player1' ? 'player2' : 'player1'));
    if (server === 'player1') {
      return { serverScore: s.player1Score, receiverScore: s.player2Score, serverSide: 'player1' as const };
    }
    return { serverScore: s.player2Score, receiverScore: s.player1Score, serverSide: 'player2' as const };
  });
}

/**
 * Determine whether a penalty action should be a warning or point deduction.
 * Cycle: warning(0) → deduction(1) → warning(2) → deduction(3) → ...
 * Electronic penalties always result in immediate deduction (no warning phase).
 */
export function getPenaltyAction(
  penaltyType: 'penalty_table_pushing' | 'penalty_electronic' | 'penalty_talking',
  totalPriorCount: number,
): { isWarning: boolean; points: number } {
  if (penaltyType === 'penalty_electronic') {
    return { isWarning: false, points: 2 };
  }
  const isWarning = totalPriorCount % 2 === 0;
  const points = isWarning ? 0 : (penaltyType === 'penalty_talking' ? 1 : 2);
  return { isWarning, points };
}

/**
 * Count warnings and penalty deductions from score history for a given player/team.
 */
export function computePenaltyCounts(
  history: ScoreHistoryEntry[],
  playerName: string,
): { warnings: number; penalties: number } {
  let warnings = 0;
  let penalties = 0;
  for (const h of history) {
    if (h.actionPlayer !== playerName) continue;
    const isPenaltyType = h.actionType === 'penalty_table_pushing'
      || h.actionType === 'penalty_electronic'
      || h.actionType === 'penalty_talking';
    if (!isPenaltyType) continue;
    if (h.penaltyWarning) warnings++;
    else penalties++;
  }
  return { warnings, penalties };
}
