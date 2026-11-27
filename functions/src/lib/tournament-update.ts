/**
 * update_tournament의 순위결정전 설정 → 다중 경로 업데이트 (M0g). 순수 함수.
 * 레거시 rankingMatchConfig와 규칙 층 rules/finalRanking/*를 함께 쓴다: rules.finalRanking이 레거시보다 우선하므로
 * 레거시만 바꾸면 이미 규칙 층에 값이 있는 대회는 바뀌지 않는다(감사 #8).
 */
import { isObject, isTeamType } from "../shared/rules/competitionRules";

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

export interface TimeLimitParams {
  /** 시간 제한(분). 0 = 끔 */
  timeLimitMinutes?: unknown;
  timeLimitUnit?: unknown;
  goldenGoalMode?: unknown;
  ibsaSanctioned?: unknown;
  /** 이 스테이지에만 (없으면 대회 전체) */
  stageId?: unknown;
}

/**
 * update_tournament의 시간 제한·골든골·IBSA 승인 설정 → 다중 경로 업데이트 (M0f). 순수 함수.
 * 규칙 층(rules/scoring/{종목} 또는 stages/{키}/rules/scoring/{종목})에 쓴다. resolveMatchScoring이 그대로 읽는다.
 * 분은 초로 바꿔 저장하고(0 = 시간 제한 없음, 상위 값을 끈다), 잘못된 값은 오류로 돌려준다.
 */
export function timeLimitRuleUpdate(cur: Record<string, unknown>, p: TimeLimitParams, skipRulesPaths = false): { updates: Record<string, unknown> } | { error: string } {
  const out: Record<string, unknown> = {};
  const kind = isTeamType(cur.type) ? "team" : "individual";
  let base = "rules/scoring/" + kind;
  if (typeof p.stageId === "string" && p.stageId) {
    const raw = cur.stages;
    const entries: [string, unknown][] = Array.isArray(raw) ? raw.map((s, i) => [String(i), s]) : isObject(raw) ? Object.entries(raw) : [];
    const hit = entries.find(([, s]) => isObject(s) && s.id === p.stageId);
    if (!hit) return { error: `스테이지 ${p.stageId}를 찾을 수 없습니다.` };
    base = `stages/${hit[0]}/rules/scoring/${kind}`;
  }
  if (p.timeLimitMinutes !== undefined) {
    const m = p.timeLimitMinutes;
    if (typeof m !== "number" || !Number.isFinite(m) || m < 0 || m > 240) return { error: "timeLimitMinutes는 0~240 사이 숫자여야 합니다 (0 = 시간 제한 없음)." };
    out[`${base}/timeLimitSeconds`] = Math.round(m * 60);
  }
  if (p.timeLimitUnit !== undefined) {
    if (p.timeLimitUnit !== "per_set" && p.timeLimitUnit !== "per_match") return { error: "timeLimitUnit은 per_set 또는 per_match입니다." };
    out[`${base}/timeLimitUnit`] = p.timeLimitUnit;
  }
  if (p.goldenGoalMode !== undefined) {
    if (p.goldenGoalMode !== "next_point" && p.goldenGoalMode !== "goal_only") return { error: "goldenGoalMode는 next_point 또는 goal_only입니다." };
    out[`${base}/goldenGoalMode`] = p.goldenGoalMode;
  }
  if (p.ibsaSanctioned !== undefined) {
    if (typeof p.ibsaSanctioned !== "boolean") return { error: "ibsaSanctioned는 true/false입니다." };
    out["rules/ibsaSanctioned"] = p.ibsaSanctioned;
  }
  if (skipRulesPaths) for (const k of Object.keys(out)) if (k.startsWith("rules/")) delete out[k];
  return { updates: out };
}
