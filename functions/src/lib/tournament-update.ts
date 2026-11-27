/**
 * update_tournament의 순위결정전 설정 → 다중 경로 업데이트 (M0g). 순수 함수.
 * 레거시 rankingMatchConfig와 규칙 층 rules/finalRanking/*를 함께 쓴다: rules.finalRanking이 레거시보다 우선하므로
 * 레거시만 바꾸면 이미 규칙 층에 값이 있는 대회는 바뀌지 않는다(감사 #8).
 */
import { isObject } from "../shared/rules/competitionRules";

export interface RankingParams {
  rankingUpTo?: unknown;
  thirdPlace?: unknown;
  fifthToEighth?: unknown;
  classificationGroups?: unknown;
}

/**
 * @param skipRulesPaths 같은 업데이트에 rules 객체 전체가 들어 있으면 rules/... 경로를 쓰지 않는다(조상·자손 경로 충돌)
 */
export function rankingConfigUpdate(cur: Record<string, unknown>, p: RankingParams, skipRulesPaths = false): Record<string, unknown> {
  const curCfg = isObject(cur.rankingMatchConfig) ? cur.rankingMatchConfig : {
    enabled: false, thirdPlace: false, fifthToEighth: false,
    fifthToEighthFormat: "simple", classificationGroups: false, classificationGroupSize: 4,
  };
  const cfg: Record<string, unknown> = { ...curCfg };
  const out: Record<string, unknown> = {};
  const rule = (k: string, v: unknown) => { if (!skipRulesPaths) out[`rules/finalRanking/${k}`] = v; };
  if (typeof p.thirdPlace === "boolean") {
    cfg.thirdPlace = p.thirdPlace;
    rule("thirdPlace", p.thirdPlace ? "match" : "joint");
  }
  if (typeof p.fifthToEighth === "boolean") {
    cfg.fifthToEighth = p.fifthToEighth;
    const fmt = typeof cfg.fifthToEighthFormat === "string" && ["simple", "full", "round_robin"].includes(cfg.fifthToEighthFormat) ? cfg.fifthToEighthFormat : "simple";
    rule("fifthToEighthMatches", p.fifthToEighth ? fmt : "none");
    if (p.fifthToEighth) rule("placementMatches", true);
  }
  if (typeof p.classificationGroups === "boolean") {
    cfg.classificationGroups = p.classificationGroups;
    rule("classificationGroups", p.classificationGroups);
  }
  if (typeof p.rankingUpTo === "number" && Number.isFinite(p.rankingUpTo) && p.rankingUpTo >= 0) {
    cfg.rankingUpTo = p.rankingUpTo;
    rule("rankingUpTo", p.rankingUpTo);
  }
  cfg.enabled = !!(cfg.thirdPlace || cfg.fifthToEighth || cfg.classificationGroups || (typeof cfg.rankingUpTo === "number" && cfg.rankingUpTo > 0));
  out.rankingMatchConfig = cfg;
  return out;
}
