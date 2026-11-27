/**
 * setup_full_tournament / create_* 입력 → 대회 규칙 층(tournament.rules, 본선 stage.rules) (M0g).
 *
 * 규칙은 resolveCompetitionRules가 읽는 곳에 저장한다:
 * - 예선(대회 전체) 점수: rules.scoring.{kind}
 * - 본선 점수(예선과 다를 때): 본선 스테이지 rules.scoring.{kind}  (finalsConfig.scoringRules는 아무도 읽지 않았다)
 * - 라운드별 세트 수: rules.roundScoring
 * - 순위결정전 점수: rules.placementScoring
 * - 진출·최종 순위·휴식: rules.qualification / finalRanking / schedule
 * - 시간 제한·골든골(M0f): rules.scoring.{kind}.timeLimitSeconds/timeLimitUnit/goldenGoalMode, 본선만 다르면 본선 스테이지,
 *   IBSA 승인 대회 표시: rules.ibsaSanctioned
 * Firebase는 undefined를 저장하지 못하므로 값이 없는 항목은 넣지 않는다.
 * 순수 함수 (Firebase 의존 없음).
 */
import {
  DEFAULT_INDIVIDUAL_SCORING,
  DEFAULT_TEAM_SCORING,
  FIFTH_TO_EIGHTH_FORMATS,
  type CompetitionRulesInput,
  type FifthToEighthFormat,
  type ScoringRuleSet,
} from "../shared/rules/competitionRules";

export interface SetupRulesInput {
  isTeam: boolean;
  isFullLeague?: boolean;
  qualifying?: { winScore?: unknown; setsToWin?: unknown; minLead?: unknown };
  finals?: { winScore?: unknown; setsToWin?: unknown };
  servesPerTurn?: unknown;
  sideChangeAt?: unknown;
  playersOnCourt?: unknown;
  advancePerGroup?: unknown;
  wildcards?: unknown;
  avoidSameGroup?: unknown;
  thirdPlace?: unknown;
  fifthToEighth?: unknown;
  fifthToEighthFormat?: unknown;
  classificationGroups?: unknown;
  classificationGroupSize?: unknown;
  rankingUpTo?: unknown;
  roundOverride?: { fromRound: unknown; setsToWin: unknown };
  placement?: { setsToWin?: unknown; winScore?: unknown };
  minRestMinutes?: unknown;
  /** 시간 제한(분). 0/없음 = 없음 */
  timeLimitMinutes?: unknown;
  /** 본선 시간 제한(분). 예선과 다를 때 (0 = 본선은 시간 제한 없음) */
  finalsTimeLimitMinutes?: unknown;
  timeLimitUnit?: unknown;
  goldenGoalMode?: unknown;
  ibsaSanctioned?: unknown;
}

export interface SetupRules {
  /** 그 종목의 기본 점수 규칙 */
  defaults: ScoringRuleSet;
  tournamentRules: CompetitionRulesInput;
  /** 본선 스테이지 덮어쓰기 (예선과 같으면 null) */
  finalsStageRules: CompetitionRulesInput | null;
}

const pos = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const nonNeg = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

export function buildSetupRules(input: SetupRulesInput): SetupRules {
  const kind = input.isTeam ? "team" : "individual";
  const defaults = input.isTeam ? DEFAULT_TEAM_SCORING : DEFAULT_INDIVIDUAL_SCORING;
  const winScore = pos(input.qualifying?.winScore) ?? defaults.winScore;
  const setsToWin = pos(input.qualifying?.setsToWin) ?? defaults.setsToWin;
  const minLead = pos(input.qualifying?.minLead) ?? defaults.minLead;
  const scoring: Partial<ScoringRuleSet> = { winScore, setsToWin, maxSets: setsToWin * 2 - 1, minLead };
  const serves = pos(input.servesPerTurn);
  if (serves) scoring.servesPerTurn = serves;
  const side = pos(input.sideChangeAt);
  if (side) scoring.sideChangeAt = side;
  const onCourt = pos(input.playersOnCourt);
  if (onCourt && input.isTeam) scoring.playersOnCourt = onCourt;
  const timeMin = pos(input.timeLimitMinutes);
  if (timeMin) scoring.timeLimitSeconds = Math.round(timeMin * 60);
  if (input.timeLimitUnit === "per_set" || input.timeLimitUnit === "per_match") scoring.timeLimitUnit = input.timeLimitUnit;
  if (input.goldenGoalMode === "next_point" || input.goldenGoalMode === "goal_only") scoring.goldenGoalMode = input.goldenGoalMode;

  const rules: CompetitionRulesInput = { scoring: { [kind]: scoring } };
  if (typeof input.ibsaSanctioned === "boolean") rules.ibsaSanctioned = input.ibsaSanctioned;

  if (!input.isFullLeague) {
    rules.qualification = {};
    const per = pos(input.advancePerGroup);
    if (per) rules.qualification.perGroup = per;
    const wc = nonNeg(input.wildcards);
    if (wc !== undefined) rules.qualification.wildcards = wc;
    if (typeof input.avoidSameGroup === "boolean") rules.qualification.avoidSameGroupFirstRound = input.avoidSameGroup;
  }

  const fr: NonNullable<CompetitionRulesInput["finalRanking"]> = {};
  if (typeof input.thirdPlace === "boolean") fr.thirdPlace = input.thirdPlace && !input.isFullLeague ? "match" : "joint";
  if (input.fifthToEighth === true && !input.isFullLeague) {
    const fmt = typeof input.fifthToEighthFormat === "string" && (FIFTH_TO_EIGHTH_FORMATS as readonly string[]).includes(input.fifthToEighthFormat) && input.fifthToEighthFormat !== "none"
      ? input.fifthToEighthFormat as FifthToEighthFormat : "simple";
    fr.fifthToEighthMatches = fmt;
    fr.placementMatches = true;
  } else if (input.fifthToEighth === false || input.isFullLeague) {
    fr.fifthToEighthMatches = "none";
  }
  if (typeof input.classificationGroups === "boolean") {
    fr.classificationGroups = input.classificationGroups && !input.isFullLeague;
    if (fr.classificationGroups) fr.placementMatches = true;
  }
  const groupSize = pos(input.classificationGroupSize);
  if (groupSize) fr.classificationGroupSize = groupSize;
  const upTo = nonNeg(input.rankingUpTo);
  if (upTo !== undefined) fr.rankingUpTo = upTo;
  if (Object.keys(fr).length > 0) rules.finalRanking = fr;

  const from = pos(input.roundOverride?.fromRound);
  const roundSets = pos(input.roundOverride?.setsToWin);
  if (!input.isFullLeague && from && roundSets) {
    rules.roundScoring = { fromRound: from, [kind]: { setsToWin: roundSets, maxSets: roundSets * 2 - 1 } };
  }

  const pSets = pos(input.placement?.setsToWin);
  const pWin = pos(input.placement?.winScore);
  if (pSets || pWin) {
    rules.placementScoring = { [kind]: { ...(pSets ? { setsToWin: pSets, maxSets: pSets * 2 - 1 } : {}), ...(pWin ? { winScore: pWin } : {}) } };
  }

  const rest = nonNeg(input.minRestMinutes);
  if (rest !== undefined) rules.schedule = { minRestMinutes: rest };

  let finalsStageRules: CompetitionRulesInput | null = null;
  const fSets = pos(input.finals?.setsToWin);
  const fWin = pos(input.finals?.winScore);
  if (!input.isFullLeague && ((fSets && fSets !== setsToWin) || (fWin && fWin !== winScore))) {
    const fs = fSets ?? setsToWin;
    finalsStageRules = { scoring: { [kind]: { winScore: fWin ?? winScore, setsToWin: fs, maxSets: fs * 2 - 1 } } };
  }
  // 본선 시간 제한이 예선과 다르면 본선 스테이지에 (0 = 본선은 시간 제한 없음)
  const fTime = nonNeg(input.finalsTimeLimitMinutes);
  if (!input.isFullLeague && fTime !== undefined && Math.round(fTime * 60) !== (scoring.timeLimitSeconds ?? 0)) {
    const fs = finalsStageRules ?? { scoring: { [kind]: {} } };
    const part = { ...(fs.scoring?.[kind] ?? {}), timeLimitSeconds: Math.round(fTime * 60) };
    finalsStageRules = { ...fs, scoring: { ...fs.scoring, [kind]: part } };
  }
  return { defaults, tournamentRules: rules, finalsStageRules };
}
