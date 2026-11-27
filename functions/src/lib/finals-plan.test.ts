import { describe, it, expect } from "vitest";
import { planFinals, isPlanError, type FinalsPlan } from "./finals-plan";
import { tiebreakDecisionKey } from "../shared/rules/competitionRules";

type Data = Record<string, unknown>;

const win = (g: string, a: string, b: string, winner = a, extra: Data = {}): Data => ({
  tournamentId: "t", type: "individual", status: "completed", groupId: g, stageId: "q",
  player1Id: a, player2Id: b, player1Name: a.toUpperCase(), player2Name: b.toUpperCase(), winnerId: winner,
  sets: winner === a ? [{ player1Score: 11, player2Score: 4 }, { player1Score: 11, player2Score: 4 }] : [{ player1Score: 4, player2Score: 11 }, { player1Score: 4, player2Score: 11 }],
  ...extra,
});

/** 조마다 3명 풀리그, 1 > 2 > 3 */
function groups(letters: string[]): Record<string, Data> {
  const out: Record<string, Data> = {};
  for (const g of letters) {
    const [p1, p2, p3] = [1, 2, 3].map(i => `${g.toLowerCase()}${i}`);
    out[`${g}1`] = win(g, p1, p2);
    out[`${g}2`] = win(g, p1, p3);
    out[`${g}3`] = win(g, p2, p3);
  }
  return out;
}

const tour = (extra: Data = {}): Data => ({
  name: "T", status: "in_progress", type: "individual",
  stages: [{ id: "q", type: "qualifying" }, { id: "f", type: "finals" }],
  ...extra,
});

let k = 0;
const deps = () => ({ makeKey: () => `k${k++}`, now: 1000 });

function plan(t: Data, ms: Record<string, Data>, input = {}): FinalsPlan {
  const p = planFinals("t", t, ms, input, deps());
  if (isPlanError(p)) throw new Error(p.error);
  return p;
}

describe("planFinals guards", () => {
  it("refuses when finals already exist (idempotent)", () => {
    const ms = { ...groups(["A", "B"]), x: { stageId: "f_3rd", status: "pending" } };
    const p = planFinals("t", tour(), ms, {}, deps());
    expect(isPlanError(p) && p.code).toBe("finals_exist");
  });
  it("refuses without qualifying matches", () => {
    expect((planFinals("t", tour(), {}, {}, deps()) as { code: string }).code).toBe("no_qualifying");
  });
  it("refuses when qualifying is incomplete unless force", () => {
    const ms = groups(["A", "B"]);
    ms.A1 = { ...ms.A1, status: "pending", winnerId: null };
    const p = planFinals("t", tour(), ms, {}, deps());
    expect(isPlanError(p) && p.code === "qualifying_incomplete" && p.incompleteCount).toBe(1);
    expect(isPlanError(planFinals("t", tour(), ms, { force: true }, deps()))).toBe(false);
  });
  it("refuses with fewer than 2 qualifiers", () => {
    const ms = { a: win("A", "a1", "a2") };
    const p = planFinals("t", tour(), ms, { advancePerGroup: 1 }, deps());
    expect(isPlanError(p) && p.code).toBe("not_enough_qualifiers");
  });
  it("refuses with tie info at the cutoff, then honors a recorded admin decision", () => {
    // A조 순환 동률 (a1>a2>a3>a1, 같은 점수)
    const ms: Record<string, Data> = {
      ...groups(["B"]),
      x: win("A", "a1", "a2"), y: win("A", "a2", "a3"), z: win("A", "a3", "a1"),
    };
    const p = planFinals("t", tour(), ms, { advancePerGroup: 1 }, deps());
    expect(isPlanError(p) && p.code).toBe("unresolved_tie");
    if (isPlanError(p) && p.code === "unresolved_tie") {
      expect(p.ties[0]).toMatchObject({ scope: "A", fromRank: 1, toRank: 3 });
      expect(p.ties[0].participants.map(x => x.id).sort()).toEqual(["a1", "a2", "a3"]);
    }
    const key = tiebreakDecisionKey("A", ["a1", "a2", "a3"]);
    const ok = plan(tour({ rules: { tiebreakDecisions: { [key]: { ids: ["a3", "a1", "a2"], scope: "A" } } } }), ms, { advancePerGroup: 1 });
    expect(ok.qualifiers.map(q => q.id)).toEqual(["a3", "b1"]);
    // 시뮬레이션: 추첨 후 결정을 기록
    const sim = plan(tour(), ms, { advancePerGroup: 1, resolveTiesByLot: true, lotSeed: "s" });
    expect(Object.keys(sim.decisions)).toEqual([key]);
    expect(sim.qualifiers).toHaveLength(2);
  });
});

describe("planFinals bracket", () => {
  it("cross-group seeding (A1-B2, B1-A2), BYEs as 11:0 walkovers, all rounds linked", () => {
    const p = plan(tour(), groups(["A", "B", "C"]));
    const r1 = p.matches.filter(m => m.match.round === 1).sort((a, b) => (a.match.bracketPosition as number) - (b.match.bracketPosition as number));
    expect(r1).toHaveLength(4); // 6명 → 8강
    const byes = r1.filter(m => m.match.isBye);
    expect(byes).toHaveLength(2);
    // BYE는 1·2번 시드(조 1위)가 받는다
    expect(byes.map(b => b.match.winnerId).sort()).toEqual(["a1", "b1"]);
    for (const b of byes) {
      expect(b.match).toMatchObject({ status: "completed", walkover: true, walkoverReason: "bye" });
      expect(b.match.bye).toBeUndefined();
      expect((b.match.sets as Data[]).map(s => [s.player1Score, s.player2Score])).toEqual([[11, 0], [11, 0]]);
    }
    for (const m of r1.filter(x => !x.match.isBye)) {
      expect(String(m.match.player1Id)[0]).not.toBe(String(m.match.player2Id)[0]); // 같은 조 1라운드 없음
    }
    const ids = r1.flatMap(m => [m.match.player1Id, m.match.player2Id]).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    const final = p.matches.find(m => m.match.roundLabel === "결승")!;
    expect(final.match.sourceMatch1).toBeTruthy();
    expect(p.matches.find(m => m.match.roundLabel === "3/4위 결정전")?.match.sourceType).toBe("loser");
    // 미정 슬롯: 빈 ID + '미정'
    expect(final.match).toMatchObject({ player1Id: "", player1Name: "미정" });
  });
  it("no automatic wildcards (14 → 16 only when configured)", () => {
    const p = plan(tour(), groups(["A", "B", "C"]), {});
    expect(p.qualifiers).toHaveLength(6);
    const ms = groups(["A", "B", "C"]);
    const close = (m: Data, p: number): Data => ({ ...m, sets: [{ player1Score: 11, player2Score: p }, { player1Score: 11, player2Score: p }] });
    ms.B2 = close(ms.B2, 9); ms.B3 = close(ms.B3, 9); ms.C2 = close(ms.C2, 7);
    const wc = plan(tour({ finalsConfig: { wildcardCount: 2 } }), ms);
    expect(wc.qualifiers).toHaveLength(8);
    expect(wc.qualifiers.filter(q => q.wildcard).map(q => q.id)).toEqual(["b3", "c3"]);
  });
  it("third-place match follows rules.finalRanking.thirdPlace (explicit input still overrides)", () => {
    const third = (p: FinalsPlan) => p.matches.some(m => m.match.roundLabel === "3/4위 결정전");
    expect(third(plan(tour(), groups(["A", "B"])))).toBe(true);
    expect(third(plan(tour({ rules: { finalRanking: { thirdPlace: "joint" } } }), groups(["A", "B"])))).toBe(false);
    expect(third(plan(tour({ rankingMatchConfig: { thirdPlace: false } }), groups(["A", "B"])))).toBe(false);
    expect(third(plan(tour({ stages: [{ id: "q", type: "qualifying" }, { id: "f", type: "finals", rules: { finalRanking: { thirdPlace: "joint" } } }] }), groups(["A", "B"])))).toBe(false);
    expect(third(plan(tour({ rules: { finalRanking: { thirdPlace: "joint" } } }), groups(["A", "B"]), { includeThirdPlace: true }))).toBe(true);
  });
  it("legacy perGroup from advanceCount / group count when advancePerGroup is missing", () => {
    expect(plan(tour({ finalsConfig: { advanceCount: 2 }, qualifyingConfig: { groupCount: 2 } }), groups(["A", "B"])).qualifiers).toHaveLength(2);
  });
  it("stage-level perGroup override on the qualifying stage", () => {
    expect(plan(tour({ stages: [{ id: "q", type: "qualifying", rules: { qualification: { perGroup: 1 } } }, { id: "f", type: "finals" }] }), groups(["A", "B"])).qualifiers).toHaveLength(2);
  });
  it("reads perGroup from tournament rules", () => {
    expect(plan(tour({ rules: { qualification: { perGroup: 1 } } }), groups(["A", "B"])).qualifiers).toHaveLength(2);
  });
  it("randomTeamLeague finals matches use type 'team' and team fields", () => {
    const ms: Record<string, Data> = {};
    for (const [key, m] of Object.entries(groups(["A", "B"]))) {
      ms[key] = { ...m, type: "team", team1Id: m.player1Id, team2Id: m.player2Id, team1Name: m.player1Name, team2Name: m.player2Name, sets: [{ player1Score: m.winnerId === m.player1Id ? 31 : 10, player2Score: m.winnerId === m.player1Id ? 10 : 31 }] };
    }
    const p = planFinals("t", tour({ type: "randomTeamLeague" }), ms, {}, { ...deps(), teams: { a1: { memberIds: ["x"], memberNames: ["X"] } } });
    if (isPlanError(p)) throw new Error(p.error);
    expect(p.matches.every(m => m.match.type === "team")).toBe(true);
    const withA1 = p.matches.find(m => m.match.team1Id === "a1" || m.match.team2Id === "a1")!;
    expect(withA1.match.team1Id === "a1" ? withA1.match.team1 : withA1.match.team2).toMatchObject({ memberIds: ["x"] });
  });
  it("team walkover BYE is 31:0", () => {
    const ms: Record<string, Data> = {};
    for (const [key, m] of Object.entries(groups(["A", "B", "C"]))) ms[key] = { ...m, type: "team", team1Id: m.player1Id, team2Id: m.player2Id };
    const p = plan(tour({ type: "team" }), ms);
    const bye = p.matches.find(m => m.match.isBye && m.match.winnerId)!;
    expect((bye.match.sets as Data[]).map(s => (s.player1Score as number) + (s.player2Score as number))).toEqual([31]);
  });
});
