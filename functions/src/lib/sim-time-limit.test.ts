import { describe, it, expect } from "vitest";
import { simulateTimeExpiry } from "./sim-time-limit";
import { DEFAULT_INDIVIDUAL_SCORING, DEFAULT_TEAM_SCORING, matchWinnerByRules } from "../shared/rules/competitionRules";

/** 고정 난수열 */
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe("simulateTimeExpiry (M0f: simulation honors the time limit like the referee screen)", () => {
  it("per_set: leader takes the set, match continues", () => {
    const rules = { ...DEFAULT_INDIVIDUAL_SCORING, timeLimitSeconds: 600, timeLimitUnit: "per_set" as const };
    const ex = simulateTimeExpiry([], { player1: 7, player2: 4 }, rules, ["a", "b"]);
    expect(ex).toMatchObject({ matchOver: false, golden: false, set: { winnerId: "a", decidedBy: "time_limit" } });
  });
  it("per_match: current set leader + equal sets → that side wins the match", () => {
    const rules = { ...DEFAULT_INDIVIDUAL_SCORING, timeLimitSeconds: 600 };
    const done = [{ player1Score: 11, player2Score: 3, winnerId: "a" }];
    const ex = simulateTimeExpiry(done, { player1: 2, player2: 6 }, rules, ["a", "b"]);
    expect(ex.matchOver).toBe(true);
    expect(matchWinnerByRules([...done, ex.set], rules)).toBe(2);
  });
  it("tie → golden goal next_point: the first point decides (a foul too)", () => {
    const rules = { ...DEFAULT_TEAM_SCORING, timeLimitSeconds: 1800 };
    // rng: 0.9 → 반칙, 0.2 → 1쪽이 점수
    const ex = simulateTimeExpiry([], { player1: 20, player2: 20 }, rules, ["t1", "t2"], seq(0.9, 0.2));
    expect(ex).toMatchObject({ golden: true, matchOver: true, set: { player1Score: 21, player2Score: 20, winnerId: "t1", decidedBy: "golden_goal" } });
    expect(ex.goldenPoints).toHaveLength(1);
  });
  it("tie → golden goal goal_only: fouls add points until a goal decides", () => {
    const rules = { ...DEFAULT_TEAM_SCORING, timeLimitSeconds: 1800, goldenGoalMode: "goal_only" as const };
    // 반칙(2쪽 점수) → 골(1쪽)
    const ex = simulateTimeExpiry([], { player1: 7, player2: 7 }, rules, ["t1", "t2"], seq(0.9, 0.8, 0.1, 0.2));
    expect(ex.goldenPoints.map(g => g.goal)).toEqual([false, true]);
    expect(ex.set).toMatchObject({ player1Score: 9, player2Score: 8, winnerId: "t1", decidedWinner: 1 });
  });
});
