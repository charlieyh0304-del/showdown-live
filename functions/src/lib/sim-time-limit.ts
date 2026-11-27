/**
 * 시뮬레이션의 시간 제한 처리 (M0f). 순수 함수.
 * 심판 화면과 같은 판정(shared/rules/timeLimit: decideTimeExpiry, applyGoldenPoint)을 쓴다.
 * 시뮬레이션은 랠리 시간만 플레이 시간으로 센다(사이드 체인지·타임아웃 제외)는 점에서 실경기 시계와 같다.
 */
import type { ScoringRuleSet } from "../shared/rules/competitionRules";
import { applyGoldenPoint, decideTimeExpiry, timeLimitOf } from "../shared/rules/timeLimit";

export interface SimSet {
  player1Score: number;
  player2Score: number;
  winnerId: string | null;
  decidedBy?: "time_limit" | "golden_goal";
  decidedWinner?: 1 | 2;
  matchTimeUp?: boolean;
}

export interface SimExpiry {
  /** 시간 제한으로 끝난 현재 세트 (표시·승자 포함) */
  set: SimSet;
  /** 이 세트로 경기가 끝났다 */
  matchOver: boolean;
  /** 골든골로 정했다 */
  golden: boolean;
  /** 골든골 중 들어간 점수 (기록용, 순서대로) */
  goldenPoints: Array<{ scorer: 1 | 2; goal: boolean; before: { player1: number; player2: number }; after: { player1: number; player2: number } }>;
}

/**
 * 시간이 끝났을 때 현재 세트(done 다음 세트, 점수 current)를 정한다. 동점이면 rng로 골든골을 진행한다.
 * rules.timeLimitSeconds가 0이면 쓰지 않는다(호출자가 확인).
 */
export function simulateTimeExpiry(
  done: readonly SimSet[],
  current: { player1: number; player2: number },
  rules: ScoringRuleSet,
  ids: [string, string],
  rng: () => number = Math.random,
): SimExpiry {
  const cfg = timeLimitOf(rules);
  let sets: SimSet[] = [...done.map(s => ({ ...s })), { player1Score: current.player1, player2Score: current.player2, winnerId: null }];
  const ci = sets.length - 1;
  const out = decideTimeExpiry(sets, ci, rules, cfg.unit);
  if (out.kind === "decided") {
    const set = { ...out.sets[ci], winnerId: out.setWinner ? ids[out.setWinner - 1] : null };
    return { set, matchOver: !!out.matchWinner, golden: false, goldenPoints: [] };
  }
  const goldenPoints: SimExpiry["goldenPoints"] = [];
  for (let i = 0; i < 60; i++) {
    const goal = i >= 59 || rng() < 0.7;
    const scorer: 1 | 2 = rng() < 0.5 ? 1 : 2;
    const before = { player1: sets[ci].player1Score, player2: sets[ci].player2Score };
    const r = applyGoldenPoint(sets, ci, { actionType: goal ? "goal" : "foul", scorer, points: goal ? 2 : 1, toOpponent: !goal }, cfg, rules);
    sets = r.sets;
    goldenPoints.push({ scorer, goal, before, after: { player1: sets[ci].player1Score, player2: sets[ci].player2Score } });
    if (r.decisive) {
      return { set: { ...sets[ci], winnerId: ids[scorer - 1] }, matchOver: !!r.matchWinner, golden: true, goldenPoints };
    }
  }
  /* istanbul ignore next -- 위 루프의 마지막 점수는 항상 골이라 여기 오지 않는다 */
  return { set: { ...sets[ci], winnerId: null }, matchOver: true, golden: true, goldenPoints };
}
