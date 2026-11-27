import { describe, it, expect } from "vitest";
import { rankingConfigUpdate, timeLimitRuleUpdate } from "./tournament-update";
import { resolveCompetitionRules, resolveMatchScoring } from "../shared/rules/competitionRules";

describe("rankingConfigUpdate writes rules.finalRanking too (rules override legacy)", () => {
  it("third place off reaches the resolver even when rules.finalRanking already says match", () => {
    const cur = { rules: { finalRanking: { thirdPlace: "match" } }, rankingMatchConfig: { thirdPlace: true } };
    const up = rankingConfigUpdate(cur, { thirdPlace: false, fifthToEighth: true, rankingUpTo: 8 });
    expect(up["rules/finalRanking/thirdPlace"]).toBe("joint");
    expect(up["rules/finalRanking/fifthToEighthMatches"]).toBe("simple");
    expect(up["rules/finalRanking/rankingUpTo"]).toBe(8);
    // 적용 결과
    const next = { ...cur, rules: { finalRanking: { ...cur.rules.finalRanking, thirdPlace: up["rules/finalRanking/thirdPlace"], fifthToEighthMatches: up["rules/finalRanking/fifthToEighthMatches"] } }, rankingMatchConfig: up.rankingMatchConfig };
    expect(resolveCompetitionRules(next).finalRanking).toMatchObject({ thirdPlace: "joint", fifthToEighthMatches: "simple" });
  });
  it("skips rules paths when the same update carries a whole rules object", () => {
    expect(Object.keys(rankingConfigUpdate({}, { thirdPlace: true }, true))).toEqual(["rankingMatchConfig"]);
  });
});

describe("timeLimitRuleUpdate (M0f: time limit settable through the rules layer)", () => {
  it("writes the tournament scoring layer in seconds and the resolver reads it", () => {
    const cur = { type: "individual", rules: {} };
    const r = timeLimitRuleUpdate(cur, { timeLimitMinutes: 30, timeLimitUnit: "per_set", goldenGoalMode: "goal_only", ibsaSanctioned: false });
    expect("updates" in r && r.updates).toEqual({
      "rules/scoring/individual/timeLimitSeconds": 1800,
      "rules/scoring/individual/timeLimitUnit": "per_set",
      "rules/scoring/individual/goldenGoalMode": "goal_only",
      "rules/ibsaSanctioned": false,
    });
    const next = { type: "individual", rules: { scoring: { individual: { timeLimitSeconds: 1800, timeLimitUnit: "per_set", goldenGoalMode: "goal_only" } } } };
    expect(resolveMatchScoring({ type: "individual" }, next)).toMatchObject({ timeLimitSeconds: 1800, timeLimitUnit: "per_set", goldenGoalMode: "goal_only" });
  });
  it("stage scope by stage id (team), 0 turns it off for that stage", () => {
    const cur = { type: "team", stages: [{ id: "q" }, { id: "f" }] };
    const r = timeLimitRuleUpdate(cur, { timeLimitMinutes: 0, stageId: "f" });
    expect("updates" in r && r.updates).toEqual({ "stages/1/rules/scoring/team/timeLimitSeconds": 0 });
  });
  it("rejects bad values and unknown stages", () => {
    expect("error" in timeLimitRuleUpdate({}, { timeLimitMinutes: -1 })).toBe(true);
    expect("error" in timeLimitRuleUpdate({}, { timeLimitUnit: "weird" })).toBe(true);
    expect("error" in timeLimitRuleUpdate({}, { goldenGoalMode: 1 })).toBe(true);
    expect("error" in timeLimitRuleUpdate({ stages: [] }, { stageId: "x", timeLimitMinutes: 5 })).toBe(true);
  });
});
