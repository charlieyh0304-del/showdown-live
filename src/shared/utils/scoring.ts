import type { SetScore, ScoreActionType, ScoreHistoryEntry, Match } from '../types';
import { formatTime } from '@shared/utils/locale';
import {
  DEFAULT_INDIVIDUAL_SCORING,
  matchWinnerByRules,
  resolveMatchScoring,
  setWinnerByRules,
  setWinsByRules,
  type MatchScoringLike,
  type ScoringRuleSet,
  type TournamentLike,
} from '../rules/competitionRules';

/**
 * 경기 판정은 모두 대회 규칙 단일 설정원(shared/rules)을 쓴다:
 * resolveMatchScoring(경기, 대회) → setWinnerByRules / matchWinnerByRules / setWinsByRules (듀스 캡 포함).
 * 서브·사이드 체인지는 shared/rules/serve.ts.
 *
 * 아래 대문자 설정(LegacyGameConfig)과 checkSetWinner/checkMatchWinner/countSetWins는 연습 모드
 * (대회와 무관한 로컬 경기, PracticeMatch.gameConfig) 전용 어댑터다. 대회 경기에는 쓰지 않는다
 * (src/shared/rules/outcomeGuard.test.ts가 막는다).
 */
export interface LegacyGameConfig {
  SETS_TO_WIN: number;
  MAX_SETS: number;
  POINTS_TO_WIN: number;
  MIN_POINT_DIFF: number;
}

/** 연습 모드 설정 → 점수 규칙 (없으면 개인전 기본값) */
export function rulesFromLegacyConfig(config?: LegacyGameConfig | null, deuceCap?: number): ScoringRuleSet {
  const base: ScoringRuleSet = config
    ? { winScore: config.POINTS_TO_WIN, setsToWin: config.SETS_TO_WIN, maxSets: config.MAX_SETS, minLead: config.MIN_POINT_DIFF }
    : { ...DEFAULT_INDIVIDUAL_SCORING };
  return deuceCap ? { ...base, deuceCap } : base;
}

/** 연습 모드 전용: 세트 승자 */
export function checkSetWinner(player1Score: number, player2Score: number, config?: LegacyGameConfig, deuceCap?: number): 1 | 2 | null {
  return setWinnerByRules(player1Score, player2Score, rulesFromLegacyConfig(config, deuceCap));
}

/** 연습 모드 전용: 경기 승자 */
export function checkMatchWinner(sets: SetScore[], config?: LegacyGameConfig): 1 | 2 | null {
  return matchWinnerByRules(sets, rulesFromLegacyConfig(config));
}

/** 연습 모드 전용: 세트 승수 */
export function countSetWins(sets: SetScore[], config?: LegacyGameConfig) {
  return setWinsByRules(sets, rulesFromLegacyConfig(config));
}

/** 대회 경기의 세트 승수 (경기 → 스테이지 → 대회 규칙, 듀스 캡 포함) */
export function matchSetWins(
  match: MatchScoringLike & { sets?: ReadonlyArray<{ player1Score?: unknown; player2Score?: unknown } | null | undefined> | null },
  tournament: TournamentLike | null | undefined,
): { player1: number; player2: number } {
  return setWinsByRules(Array.isArray(match.sets) ? match.sets : [], resolveMatchScoring(match, tournament));
}

export function createEmptySet(): SetScore {
  return {
    player1Score: 0, player2Score: 0,
    player1Faults: 0, player2Faults: 0,
    player1Violations: 0, player2Violations: 0,
    winnerId: null,
  };
}

// ===== 골든골 (시간 제한 경기) =====
// 시간 제한·경기 시계·골든골 판정은 shared/rules/timeLimit.ts (M0f): 시계는 워밍업·사이드 체인지·타임아웃 동안 멈추고,
// 골든골은 next_point(다음 1점, 반칙 포함) 또는 goal_only(다음 골만)로 세트(경기)를 끝낸다.

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

/**
 * 경기의 유효 시간 제한(초). 0 = 시간 제한 없음.
 * 대회 규칙 단일 설정원(resolveMatchScoring: 경기 → 라운드/순위결정전 → 스테이지 → 대회)에서 읽는다.
 * 스테이지에서 0을 저장하면 대회 값을 끈다.
 */
export function getEffectiveTimeLimitSeconds(
  match: MatchScoringLike,
  tournament: TournamentLike | null | undefined,
): number {
  return resolveMatchScoring(match, tournament).timeLimitSeconds ?? 0;
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
