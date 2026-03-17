import type { SetScore, GameConfig, MatchType, ScoringRules } from '../types';

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
