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
    // 개인전: 마지막 세트에서만
    const setWins = countSetWins(sets.slice(0, -1), config);
    const isLastSet = setWins.player1 === config.SETS_TO_WIN - 1 && setWins.player2 === config.SETS_TO_WIN - 1;
    return isLastSet && maxScore >= sideChangePoint;
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
