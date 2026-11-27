import { describe, it, expect } from "vitest";
import { defaultMatchType, planMatchUpdate } from "./match-update";

const m = { type: "individual", status: "pending", player1Id: "a", player2Id: "b", sets: [] };

describe("defaultMatchType", () => {
  it("follows the tournament type", () => {
    expect(defaultMatchType("team", undefined, false)).toBe("team");
    expect(defaultMatchType("randomTeamLeague", undefined, false)).toBe("team");
    expect(defaultMatchType("individual", undefined, false)).toBe("individual");
    expect(defaultMatchType("individual", undefined, true)).toBe("team");
    expect(defaultMatchType("team", "individual", false)).toBe("individual");
  });
});

describe("planMatchUpdate", () => {
  it("rejects a winner that is not a participant", () => {
    expect(planMatchUpdate(m, {}, { winnerId: "x" })).toHaveProperty("error");
  });
  it("rejects a winnerId that contradicts the set scores (rules decide the winner)", () => {
    const sets = [{ player1Score: 11, player2Score: 5 }, { player1Score: 11, player2Score: 7 }];
    expect(planMatchUpdate(m, {}, { status: "completed", sets, winnerId: "b" })).toHaveProperty("error");
    expect(planMatchUpdate(m, {}, { status: "completed", sets, winnerId: "a" })).toEqual({ updates: { status: "completed", sets, winnerId: "a" } });
  });
  it("fills the winner from the sets when completing without winnerId", () => {
    const sets = [{ player1Score: 5, player2Score: 11 }, { player1Score: 7, player2Score: 11 }];
    expect(planMatchUpdate(m, {}, { status: "completed", sets })).toMatchObject({ updates: { winnerId: "b" } });
  });
  it("walkover writes the flags and the rule walkover sets (11:0 x sets to win; team 31:0)", () => {
    const r = planMatchUpdate(m, { rules: { scoring: { individual: { setsToWin: 3 } } } }, { walkover: true, winnerId: "b", walkoverReason: "불참" });
    expect(r).toMatchObject({ updates: { status: "completed", winnerId: "b", walkover: true, walkoverReason: "불참" } });
    expect(("updates" in r) && (r.updates.sets as Array<{ player2Score: number }>).map(s => s.player2Score)).toEqual([11, 11, 11]);
    const team = planMatchUpdate({ type: "team", team1Id: "t1", team2Id: "t2" }, { type: "team" }, { walkover: true, winnerId: "t1" });
    expect(("updates" in team) && (team.updates.sets as Array<{ player1Score: number }>).map(s => s.player1Score)).toEqual([31]);
    expect(planMatchUpdate(m, {}, { walkover: true })).toHaveProperty("error");
  });
});
