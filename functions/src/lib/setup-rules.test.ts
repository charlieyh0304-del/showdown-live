import { describe, it, expect } from "vitest";
import { buildSetupRules } from "./setup-rules";
import { resolveCompetitionRules, resolveMatchScoring } from "../shared/rules/competitionRules";
import { servesPerTurnOf } from "../shared/rules/serve";

/** setup_full이 저장하는 대회 노드 모양 */
function tourFrom(r: ReturnType<typeof buildSetupRules>, type = "individual") {
  return {
    type,
    rules: r.tournamentRules,
    stages: [{ id: "q", type: "qualifying" }, { id: "f", type: "finals", ...(r.finalsStageRules ? { rules: r.finalsStageRules } : {}) }],
  };
}

describe("buildSetupRules: finals scoring is saved where the resolver reads it", () => {
  it("finals with more sets than the qualifying round", () => {
    const r = buildSetupRules({ isTeam: false, qualifying: { winScore: 11, setsToWin: 2 }, finals: { setsToWin: 3 } });
    const t = tourFrom(r);
    expect(resolveMatchScoring({ type: "individual", stageId: "q" }, t)).toMatchObject({ setsToWin: 2, maxSets: 3 });
    expect(resolveMatchScoring({ type: "individual", stageId: "f", roundLabel: "8강" }, t)).toMatchObject({ setsToWin: 3, maxSets: 5 });
    expect(resolveMatchScoring({ type: "individual", stageId: "f_3rd" }, t).setsToWin).toBe(3);
  });
  it("round override, placement scoring, deuce off and team serves", () => {
    const r = buildSetupRules({
      isTeam: true, qualifying: { winScore: 21, setsToWin: 1, minLead: 1 }, servesPerTurn: 2,
      roundOverride: { fromRound: 2, setsToWin: 2 }, placement: { setsToWin: 2 },
      thirdPlace: true, fifthToEighth: true, fifthToEighthFormat: "full", classificationGroups: true, classificationGroupSize: 4, rankingUpTo: 8,
      minRestMinutes: 45,
    });
    const t = tourFrom(r, "team");
    const final = resolveMatchScoring({ type: "team", stageId: "f", roundLabel: "결승" }, t);
    expect(final).toMatchObject({ winScore: 21, setsToWin: 2, minLead: 1 });
    expect(servesPerTurnOf(final, "team")).toBe(2);
    expect(resolveMatchScoring({ type: "team", stageId: "f_5to8", roundLabel: "5/6위 결정전" }, t).setsToWin).toBe(2);
    const rules = resolveCompetitionRules(t, "f");
    expect(rules.finalRanking).toMatchObject({ thirdPlace: "match", fifthToEighthMatches: "full", classificationGroups: true, classificationGroupSize: 4, rankingUpTo: 8, placementMatches: true });
    expect(rules.schedule.minRestMinutes).toBe(45);
  });
  it("defaults: individual 11 points best of 3, team 31 points single set; no undefined values (Firebase)", () => {
    const ind = buildSetupRules({ isTeam: false });
    expect(ind.defaults).toMatchObject({ winScore: 11, setsToWin: 2 });
    expect(buildSetupRules({ isTeam: true }).defaults).toMatchObject({ winScore: 31, setsToWin: 1 });
    expect(JSON.stringify(ind.tournamentRules)).not.toContain("null");
    const hasUndefined = (v: unknown): boolean => v === undefined || (!!v && typeof v === "object" && Object.values(v).some(hasUndefined));
    expect(hasUndefined(buildSetupRules({ isTeam: false, advancePerGroup: 2, thirdPlace: false }).tournamentRules)).toBe(false);
  });
});
