import { describe, it, expect } from "vitest";
import { rankingConfigUpdate } from "./tournament-update";
import { resolveCompetitionRules } from "../shared/rules/competitionRules";

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
