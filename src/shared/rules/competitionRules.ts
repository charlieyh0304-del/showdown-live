/**
 * 대회 규칙 단일 설정원 (M0c).
 *
 * 대회마다(그리고 스테이지마다) 모든 경기 규칙을 바꿀 수 있다. 내장 값은 기본값과 프리셋일 뿐이다.
 * 생성·시드·점수/승자 판정·부전승·진출·순위·동률·진출자 선정·최종 순위·통계·관전 표시가
 * 모두 resolveCompetitionRules / resolveMatchScoring을 거쳐 같은 규칙을 읽는다.
 *
 * 저장 위치
 * - tournaments/{tid}/rules            : 대회 규칙(부분 값, 없는 항목은 아래 우선순위로 채움)
 * - tournaments/{tid}/stages[i].rules  : 스테이지 덮어쓰기(부분 값)
 * - tournaments/{tid}/rules/tiebreakDecisions/{key} : 관리자가 기록한 동률 결정
 *
 * 우선순위(낮음 → 높음)
 *   기본값 → 프리셋(rules.presetId) → 레거시 대회 필드(gameConfig, teamMatchSettings, scoringRules,
 *   rankingMatchConfig, finalsConfig, tiebreakerRules) → tournament.rules → 레거시 stage.scoringRules → stage.rules
 * 경기 점수 규칙은 그 위에 match.appliedScoringRules가 최우선이다.
 * 본선 토너먼트 경기는 라운드별 규칙(roundScoring, 예: 4강부터 5세트)이 스테이지 점수 규칙 위에 덮인다.
 * (= 기존 advancement.ts resolveScoringRules 순서: match → stage → tournament → 팀 31점 → gameConfig → 기본)
 *
 * 순수 모듈. functions/src/shared/rules/는 이 폴더의 사본이다(scripts/sync-shared-rules.mjs로 복사,
 * 사본이 다르면 테스트가 실패한다). 다른 앱 코드를 import하지 않는다.
 */

export type MatchKind = 'individual' | 'team';

export interface ScoringRuleSet {
  /** 세트를 따는 점수 (개인 11, 팀 31) */
  winScore: number;
  /** 이겨야 하는 세트 수 (3세트제 = 2) */
  setsToWin: number;
  maxSets: number;
  /** 최소 점수 차 (2점차 = 2, 2점차 없음 = 1) */
  minLead: number;
  /** 이 점수에 도달하면 1점 차로도 세트 종료 */
  deuceCap?: number;
  /**
   * 시간 제한(초). 없으면 제한 없음. 시계는 워밍업·사이드 체인지·타임아웃(선수·심판·의료) 동안 멈추고
   * 랠리 시간은 센다(shared/rules/timeLimit.ts). IBSA 승인 대회에서는 쓰지 않는다(ibsaSanctioned 경고).
   */
  timeLimitSeconds?: number;
  /** 시간 제한 단위: per_set = 세트마다 시계를 새로 잰다, per_match = 경기 전체 (없으면 per_match) */
  timeLimitUnit?: TimeLimitUnit;
  /**
   * 시간이 끝났을 때 동점이면 골든골. next_point = 다음 1점(반칙 포함)을 얻은 쪽이 승리(IBSA, 기본),
   * goal_only = 실제 골(2점)만 승부를 낸다(반칙 점수는 들어가지만 끝내지 않는다).
   */
  goldenGoalMode?: GoldenGoalMode;
  /** 한 사람(팀)이 연속으로 넣는 서브 수. 없으면 개인 2, 단체 3 (serve.ts servesPerTurnOf) */
  servesPerTurn?: number;
  /**
   * 사이드 체인지 점수: 결정 세트(단판 포함)에서 한쪽이 이 점수에 닿으면 코트를 바꾼다.
   * 결정 세트가 아닌 세트는 세트가 끝난 뒤 바꾼다(IBSA). 없으면 ceil(목표 점수 / 2): 11→6, 21→11, 31→16.
   */
  sideChangeAt?: number;
  /** 단체전 코트에 서는 선수 수. 없으면 3 */
  playersOnCourt?: number;
  /**
   * 단체전 서브 순서. "A1"은 그 세트에 먼저 서브하는 팀의 1번 선수, "B2"는 상대 팀 2번 선수.
   * 없으면 playersOnCourt로 A1,B1,A2,B2,A3,B3… (serve.ts serveRotationOf)
   */
  serveRotation?: string[];
}

/**
 * 0이나 null로 상위 값을 끌 수 있는 선택 숫자 필드 (Firebase는 null을 저장하지 못하므로 0이 "끔/기본값" 표식).
 * 듀스 캡·시간 제한은 '없음', 사이드 체인지 점수·서브 수·코트 위 선수 수는 '기본값(자동)'이 된다.
 */
export const CLEARABLE_SCORING_FIELDS = ['deuceCap', 'timeLimitSeconds', 'sideChangeAt', 'servesPerTurn', 'playersOnCourt'] as const;

export type TimeLimitUnit = 'per_set' | 'per_match';
export const TIME_LIMIT_UNITS: readonly TimeLimitUnit[] = ['per_set', 'per_match'];
export type GoldenGoalMode = 'next_point' | 'goal_only';
export const GOLDEN_GOAL_MODES: readonly GoldenGoalMode[] = ['next_point', 'goal_only'];

/** 선택지 필드 (시간 제한 단위·골든골 방식). 잘못된 값·빈 값("")·null은 상위 값을 지운다(= 기본값). */
const ENUM_SCORING_FIELDS: ReadonlyArray<readonly [keyof ScoringRuleSet, readonly string[]]> = [
  ['timeLimitUnit', TIME_LIMIT_UNITS],
  ['goldenGoalMode', GOLDEN_GOAL_MODES],
];

function copyEnumFields(from: Record<string, unknown>, to: Partial<ScoringRuleSet>) {
  for (const [k, allowed] of ENUM_SCORING_FIELDS) {
    const v = from[k];
    if (typeof v === 'string' && allowed.includes(v)) (to as Record<string, unknown>)[k] = v;
  }
}

export type TiebreakCriterion =
  | 'points'            // 승점 (standingsPoints)
  | 'wins'              // 승수
  | 'head_to_head'      // 동률자끼리의 승점 (미니 테이블)
  | 'set_difference'
  | 'point_difference'
  | 'points_scored'
  | 'set_ratio'
  | 'point_ratio'
  | 'lot';              // 저장된 seed로 재현 가능한 추첨

export const TIEBREAK_CRITERIA: readonly TiebreakCriterion[] = [
  'points', 'wins', 'head_to_head', 'set_difference', 'point_difference', 'points_scored', 'set_ratio', 'point_ratio', 'lot',
];

export interface StandingsPoints {
  win: number;
  draw: number;
  loss: number;
  /** 부전승(기권승·BYE)의 승점 */
  walkoverWin: number;
  /** 부전패(기권·불참)의 승점 */
  forfeitLoss: number;
}

export interface WalkoverRules {
  /** 부전승 세트 점수. null(저장 값 0)이면 그 경기의 세트 목표 점수(개인 11, 팀 31)를 쓴다 → 11:0 × 이겨야 하는 세트 수 */
  setScore: number | null;
  /** 상대가 없는 BYE도 부전승(점수 기록 + 집계)으로 본다 */
  byeCountsAsWalkover: boolean;
  /** 부전승 경기를 순위표(승점·세트·점수)에 넣는다 */
  countInStandings: boolean;
  /** 부전승 경기를 선수 개인 전적/통계에 넣는다 */
  countInPlayerStats: boolean;
}

export type HeadToHeadMode = 'recursive' | 'single_pass';
export type UnresolvedTiePolicy = 'lot' | 'admin_decision' | 'playoff';

export interface TiebreakRules {
  criteria: TiebreakCriterion[];
  /**
   * recursive: 어떤 기준으로 동률 집단이 일부만 갈리면, 남은 작은 집단에 기준을 처음부터 다시 적용한다
   *            (상대 전적은 그 작은 집단끼리 다시 계산).
   * single_pass: 남은 집단에는 다음 기준부터 적용한다.
   */
  headToHeadMode: HeadToHeadMode;
  unresolved: UnresolvedTiePolicy;
  /** 'lot' 정책/기준에 쓰는 저장된 추첨 seed. 없으면 추첨하지 않고 미해결로 남긴다. */
  lotSeed?: string;
}

/** 관리자가 기록한 동률 결정. ids 순서가 곧 순위다. */
export interface TiebreakDecision {
  ids: string[];
  /** 결정 범위 (조 ID, 스테이지 ID 등). 없으면 모든 범위에서 쓴다. */
  scope?: string;
  decidedAt?: number;
  decidedBy?: string;
  note?: string;
}

export interface FinalRankingRules {
  /** match: 3/4위전 결과로 3·4위. joint: 4강 패자 공동 3위(3/4위전이 없을 때도 이렇게 된다). */
  thirdPlace: 'match' | 'joint';
  /** 5~8위(8강 패자): 공동 5위 또는 예선 성적순 */
  fifthToEighth: 'joint' | 'qualifying_record';
  /** 9위 이하(16강 이전 패자) */
  lowerPlaces: 'joint' | 'qualifying_record';
  /** 순위결정전(5/6위전 등)이 있으면 그 결과를 쓴다 */
  placementMatches: boolean;
  /** N위까지만 표시 (0 = 제한 없음) */
  rankingUpTo: number;
  /**
   * 5~8위 결정전 대진 (본선 생성기가 8강 패자로 만든다, docs/05 B4)
   * - none: 만들지 않음 (fifthToEighth 정책으로 순위)
   * - simple: 교차전 2경기 (승자 공동 5위, 패자 공동 7위)
   * - full: 교차전 2경기 → 5/6위전 + 7/8위전
   * - round_robin: 8강 패자 4명 풀리그 6경기
   */
  fifthToEighthMatches: FifthToEighthFormat;
  /** 예선 탈락자 순위 결정전 리그 (티어별 풀리그) */
  classificationGroups: boolean;
  /** 순위 결정전 리그 한 티어의 인원 */
  classificationGroupSize: number;
}

export type FifthToEighthFormat = 'none' | 'simple' | 'full' | 'round_robin';
export const FIFTH_TO_EIGHTH_FORMATS: readonly FifthToEighthFormat[] = ['none', 'simple', 'full', 'round_robin'];

export interface QualificationRules {
  /** 조당 진출 인원 */
  perGroup: number;
  /** 와일드카드(차순위 중 성적 상위) 인원. 명시적으로 설정할 때만 쓴다(자동 추가 없음). */
  wildcards: number;
  /** 본선 1라운드에서 같은 조끼리 만나지 않게 배치 */
  avoidSameGroupFirstRound: boolean;
}

/**
 * 라운드별 점수 규칙 (예: 4강부터 5세트제). 본선 토너먼트 경기에만 적용된다
 * (라운드 이름이 "N강"/"결승"/"3/4위"인 경기). fromRound는 그 라운드의 인원: 4 = 4강, 2 = 결승.
 * 3/4위 결정전은 결승과 같은 라운드(2)로 본다.
 */
export interface RoundScoringRule {
  fromRound: number;
  individual?: Partial<ScoringRuleSet>;
  team?: Partial<ScoringRuleSet>;
}

/**
 * 경기 포기(기권) 처리 (IBSA 구분)
 * - keep_played: 경기 포기 — 이미 얻은 점수·세트는 남기고, 진행 중 세트는 상대에게, 남은 세트는 0:목표 점수.
 * - as_walkover: 규정 불이행 패처럼 처리 — 얻은 점수를 지우고 모든 세트를 부전승 점수로 기록.
 * - as_recorded: 기록된 점수를 그대로 두고 기권한 쪽의 패로만 처리.
 */
export type RetirementMode = 'keep_played' | 'as_walkover' | 'as_recorded';

export interface RetirementRules {
  mode: RetirementMode;
}

export interface ScheduleRules {
  /** 선수 최소 휴식(분). 앞 경기 *종료*부터 다음 경기 *시작*까지로 잰다(시작~시작 아님, docs/05 B6). */
  minRestMinutes: number;
}

/** 순위결정전(5~8위전, 순위 결정전 리그 등. 3/4위전 제외) 점수 규칙. 비면 그 경기의 스테이지 규칙을 쓴다. */
export interface PlacementScoringRule {
  individual?: Partial<ScoringRuleSet>;
  team?: Partial<ScoringRuleSet>;
}

export interface CompetitionRules {
  presetId: string;
  scoring: Record<MatchKind, ScoringRuleSet>;
  /** 라운드별 점수 규칙. null이면 없음. */
  roundScoring: RoundScoringRule | null;
  /** 순위결정전 점수 규칙. null이면 없음. */
  placementScoring: PlacementScoringRule | null;
  standingsPoints: StandingsPoints;
  walkover: WalkoverRules;
  tiebreak: TiebreakRules;
  finalRanking: FinalRankingRules;
  qualification: QualificationRules;
  retirement: RetirementRules;
  schedule: ScheduleRules;
  /** IBSA 승인 대회. 승인 대회에서는 시간 제한 경기가 금지되므로 편집기가 경고한다(막지는 않는다). */
  ibsaSanctioned: boolean;
  tiebreakDecisions: Record<string, TiebreakDecision>;
}

/** DB에 저장하는 부분 규칙 (tournament.rules, stage.rules) */
export interface CompetitionRulesInput {
  presetId?: string;
  scoring?: { individual?: Partial<ScoringRuleSet>; team?: Partial<ScoringRuleSet> };
  /** fromRound 0 = 상위 단계의 라운드별 규칙을 끈다 (Firebase는 null을 저장하지 못하므로) */
  roundScoring?: RoundScoringRule;
  placementScoring?: PlacementScoringRule;
  standingsPoints?: Partial<StandingsPoints>;
  walkover?: Partial<WalkoverRules>;
  tiebreak?: Partial<TiebreakRules>;
  finalRanking?: Partial<FinalRankingRules>;
  qualification?: Partial<QualificationRules>;
  retirement?: Partial<RetirementRules>;
  schedule?: Partial<ScheduleRules>;
  ibsaSanctioned?: boolean;
  tiebreakDecisions?: Record<string, TiebreakDecision>;
}

/** 대회 노드 중 규칙에 관련된 필드 (클라이언트 Tournament와 서버 원시 데이터 모두 받는다) */
export interface TournamentLike {
  type?: unknown;
  gameConfig?: unknown;
  teamMatchSettings?: unknown;
  scoringRules?: unknown;
  stages?: unknown;
  rules?: unknown;
  rankingMatchConfig?: unknown;
  finalsConfig?: unknown;
  qualifyingConfig?: unknown;
  tiebreakerRules?: unknown;
  /** 레거시 단체전 설정 (teamSize = 코트 위 선수 수) */
  teamRules?: unknown;
}

export interface MatchScoringLike {
  type?: unknown;
  stageId?: unknown;
  appliedScoringRules?: unknown;
  /** 라운드 이름 ("8강", "4강", "결승", "3/4위 결정전"): 라운드별 점수 규칙에 쓴다 */
  roundLabel?: unknown;
  bracketRound?: unknown;
}

// ===== 기본값 =====

export const DEFAULT_INDIVIDUAL_SCORING: ScoringRuleSet = { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2 };
export const DEFAULT_TEAM_SCORING: ScoringRuleSet = { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2 };

/**
 * 기본 동률 순서: 승점 → 상대 전적 → 세트 득실 → 점수 득실 → 득점 → 미해결(관리자 결정).
 * [확인 필요] IBSA Showdown 원문(현행 가이드라인) 확인 전 잠정안이다(docs/05 D2). 소유자 확인 후 바꾼다.
 */
export const DEFAULT_TIEBREAK_CRITERIA: TiebreakCriterion[] = ['points', 'head_to_head', 'set_difference', 'point_difference', 'points_scored'];

export const DEFAULT_COMPETITION_RULES: CompetitionRules = {
  presetId: 'ibsa',
  scoring: { individual: DEFAULT_INDIVIDUAL_SCORING, team: DEFAULT_TEAM_SCORING },
  roundScoring: null,
  placementScoring: null,
  standingsPoints: { win: 1, draw: 0, loss: 0, walkoverWin: 1, forfeitLoss: 0 },
  walkover: { setScore: null, byeCountsAsWalkover: true, countInStandings: true, countInPlayerStats: true },
  tiebreak: { criteria: DEFAULT_TIEBREAK_CRITERIA, headToHeadMode: 'recursive', unresolved: 'admin_decision' },
  finalRanking: {
    thirdPlace: 'match', fifthToEighth: 'joint', lowerPlaces: 'joint', placementMatches: true, rankingUpTo: 0,
    fifthToEighthMatches: 'none', classificationGroups: false, classificationGroupSize: 4,
  },
  qualification: { perGroup: 2, wildcards: 0, avoidSameGroupFirstRound: true },
  retirement: { mode: 'keep_played' },
  schedule: { minRestMinutes: 30 },
  ibsaSanctioned: false,
  tiebreakDecisions: {},
};

export interface RulesPreset {
  id: string;
  /** i18n 키 (common.competitionRules.presets.{id}) */
  labelKey: string;
  rules: CompetitionRulesInput;
}

export const RULES_PRESETS: Record<string, RulesPreset> = {
  ibsa: { id: 'ibsa', labelKey: 'common.competitionRules.presets.ibsa', rules: {} },
  simple: {
    id: 'simple',
    labelKey: 'common.competitionRules.presets.simple',
    rules: {
      tiebreak: { criteria: ['points', 'set_difference', 'point_difference'], headToHeadMode: 'single_pass', unresolved: 'admin_decision' },
      finalRanking: { thirdPlace: 'joint', fifthToEighth: 'joint', lowerPlaces: 'joint', placementMatches: false },
    },
  },
  // 빈 설정에서 시작: 프리셋 값 없이 기본값만 채운 상태에서 관리자가 모든 항목을 직접 정한다
  custom: { id: 'custom', labelKey: 'common.competitionRules.presets.custom', rules: {} },
};

/** 화면에 보여 줄 프리셋 순서 */
export const RULES_PRESET_ORDER: readonly string[] = ['ibsa', 'simple', 'custom'];

// ===== 접근자 =====

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Firebase는 배열을 숫자 키 객체로 돌려줄 수 있다 */
export function toList<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (isObject(v)) return Object.values(v) as T[];
  return [];
}

function posNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function isTeamType(type: unknown): boolean {
  return type === 'team' || type === 'randomTeamLeague';
}

export function matchKindOf(type: unknown): MatchKind {
  return isTeamType(type) ? 'team' : 'individual';
}

/**
 * 저장된 점수 규칙(ScoringRules/GameConfig/TeamMatchSettings/부분 ScoringRuleSet)을 정규화한다.
 * setsToWin·winScore가 없으면 null(이 단계는 건너뜀).
 */
export function scoringFrom(obj: unknown): ScoringRuleSet | null {
  if (!isObject(obj)) return null;
  const setsToWin = posNum(obj.setsToWin);
  const winScore = posNum(obj.winScore);
  if (!setsToWin || !winScore) return null;
  const out: ScoringRuleSet = {
    winScore,
    setsToWin,
    maxSets: posNum(obj.maxSets) ?? setsToWin * 2 - 1,
    // 레거시 deuceEnabled: false = 2점 차 없음 (minLead가 따로 없을 때만)
    minLead: posNum(obj.minLead) ?? (obj.deuceEnabled === false ? 1 : 2),
  };
  for (const k of CLEARABLE_SCORING_FIELDS) {
    const n = posNum(obj[k]);
    if (n !== undefined) out[k] = n;
  }
  const rotation = rotationFrom(obj.serveRotation);
  if (rotation) out.serveRotation = rotation;
  copyEnumFields(obj, out);
  return out;
}

/** 서브 순서 목록 정규화: "A1"/"B2" 형식 토큰만 남긴다(대문자). 비면 null. */
export function rotationFrom(v: unknown): string[] | null {
  const list = toList<unknown>(v)
    .map(x => (typeof x === 'string' ? x.trim().toUpperCase() : ''))
    .filter(x => /^[AB][1-9]$/.test(x));
  return list.length > 0 ? list : null;
}

/**
 * 부분 점수 규칙을 한 겹 덮는다.
 * 0 또는 null인 선택 필드(CLEARABLE_SCORING_FIELDS)는 상위 값을 지운다(= 없음/기본값).
 * 빈 서브 순서("")도 상위 값을 지운다(= 기본 순서).
 */
function mergeScoringPartial(base: ScoringRuleSet, part: unknown): ScoringRuleSet {
  if (!isObject(part)) return base;
  const p = stripUndefined(part);
  // 세트 수만 바꾸면 최대 세트 수도 따라 바꾼다 (3선승이면 최대 5세트)
  const merged: Record<string, unknown> = { ...base, ...p };
  if (p.setsToWin !== undefined && p.maxSets === undefined) delete merged.maxSets;
  // 목표 점수만 바꾸면 상위의 사이드 체인지 점수는 버린다 (= 새 목표 점수의 절반).
  // 예: 예선 21점·체인지 11점 → 본선 31점이면 16점에서 바꾼다 (11점 상속 X)
  if (posNum(p.winScore) !== undefined && posNum(p.winScore) !== base.winScore && !('sideChangeAt' in part)) delete merged.sideChangeAt;
  // 레거시 deuceEnabled: false이고 2점 차(minLead)를 따로 정하지 않았으면 2점 차 없음
  if (p.minLead === undefined && part.deuceEnabled === false) delete merged.minLead;
  for (const k of CLEARABLE_SCORING_FIELDS) if (k in part && (part[k] === null || part[k] === 0)) delete merged[k];
  // 서브 순서: 빈 값("" 표식, null, 빈 목록)은 상위 값을 지운다 (= 기본 순서)
  if ('serveRotation' in part && !rotationFrom(part.serveRotation)) delete merged.serveRotation;
  // 선택지 필드: 잘못된 값·빈 값은 상위 값을 지운다 (= 기본값)
  for (const [k, allowed] of ENUM_SCORING_FIELDS) {
    if (k in part && !(typeof part[k] === 'string' && allowed.includes(part[k] as string))) delete merged[k];
  }
  const full = scoringFrom(merged);
  return full ?? base;
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/** 라운드별 규칙의 부분 점수 규칙: 양수 숫자 필드만 남긴다. 비면 null. */
function cleanScoringPartial(v: unknown): Partial<ScoringRuleSet> | null {
  if (!isObject(v)) return null;
  const out: Partial<ScoringRuleSet> = {};
  for (const k of ['winScore', 'setsToWin', 'maxSets', 'minLead'] as const) {
    const n = posNum(v[k]);
    if (n !== undefined) out[k] = n;
  }
  // 끌 수 있는 필드는 0도 남긴다(상위 값을 지우는 표식)
  for (const k of CLEARABLE_SCORING_FIELDS) {
    const n = finiteNum(v[k]);
    if (n !== undefined && n >= 0) out[k] = n;
  }
  const rotation = rotationFrom(v.serveRotation);
  if (rotation) out.serveRotation = rotation;
  copyEnumFields(v, out);
  return Object.keys(out).length > 0 ? out : null;
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function normalizeCriteria(v: unknown): TiebreakCriterion[] | null {
  const list = toList<unknown>(v).filter((c): c is TiebreakCriterion => typeof c === 'string' && (TIEBREAK_CRITERIA as readonly string[]).includes(c));
  if (list.length === 0) return null;
  return [...new Set(list)];
}

/**
 * 레거시 TiebreakerRule[](위저드/챗봇) → 기준 목록. 승점이 항상 첫 기준이다.
 * 레거시 이름(points_for)과 규칙 기준 이름(TIEBREAK_CRITERIA: wins, set_ratio, lot 등)을 모두 받는다.
 */
export function criteriaFromLegacy(v: unknown): TiebreakCriterion[] | null {
  const map: Record<string, TiebreakCriterion> = { points_for: 'points_scored' };
  const list = toList<unknown>(v)
    .map(x => (typeof x !== 'string' ? undefined : map[x] ?? ((TIEBREAK_CRITERIA as readonly string[]).includes(x) ? x as TiebreakCriterion : undefined)))
    .filter((x): x is TiebreakCriterion => !!x);
  if (list.length === 0) return null;
  return [...new Set<TiebreakCriterion>(['points', ...list])];
}

/** 부분 규칙 한 겹을 덮어쓴다 (원본 불변) */
export function applyRulesLayer(base: CompetitionRules, layer: unknown): CompetitionRules {
  if (!isObject(layer)) return base;
  const out: CompetitionRules = {
    ...base,
    scoring: { ...base.scoring },
    standingsPoints: { ...base.standingsPoints },
    walkover: { ...base.walkover },
    tiebreak: { ...base.tiebreak },
    finalRanking: { ...base.finalRanking },
    qualification: { ...base.qualification },
    retirement: { ...base.retirement },
    schedule: { ...base.schedule },
    tiebreakDecisions: { ...base.tiebreakDecisions },
  };
  if (typeof layer.presetId === 'string') out.presetId = layer.presetId;
  out.ibsaSanctioned = pickBool(layer.ibsaSanctioned, out.ibsaSanctioned);
  if (isObject(layer.scoring)) {
    out.scoring.individual = mergeScoringPartial(out.scoring.individual, layer.scoring.individual);
    out.scoring.team = mergeScoringPartial(out.scoring.team, layer.scoring.team);
  }
  if (isObject(layer.roundScoring)) {
    const rs = layer.roundScoring;
    const from = finiteNum(rs.fromRound);
    if (from === 0) out.roundScoring = null;
    else if (from !== undefined && from >= 2 && isPowerOfTwo(from)) {
      const rule: RoundScoringRule = { fromRound: from };
      const ind = cleanScoringPartial(rs.individual);
      const team = cleanScoringPartial(rs.team);
      if (ind) rule.individual = ind;
      if (team) rule.team = team;
      out.roundScoring = rule;
    }
  }
  if (isObject(layer.placementScoring)) {
    const ps = layer.placementScoring;
    const ind = cleanScoringPartial(ps.individual);
    const team = cleanScoringPartial(ps.team);
    const prev = out.placementScoring ?? {};
    const next: PlacementScoringRule = {
      ...(ind || prev.individual ? { individual: { ...prev.individual, ...ind } } : {}),
      ...(team || prev.team ? { team: { ...prev.team, ...team } } : {}),
    };
    out.placementScoring = next.individual || next.team ? next : null;
  }
  if (isObject(layer.standingsPoints)) {
    const sp = layer.standingsPoints;
    for (const k of ['win', 'draw', 'loss', 'walkoverWin', 'forfeitLoss'] as const) {
      const n = finiteNum(sp[k]);
      if (n !== undefined) out.standingsPoints[k] = n;
    }
  }
  if (isObject(layer.walkover)) {
    const w = layer.walkover;
    // 0 = 세트 목표 점수 사용 (Firebase는 null을 저장하지 못하므로 스테이지에서 상위 값을 끌 때 쓴다)
    if (w.setScore === null || w.setScore === 0) out.walkover.setScore = null;
    else if (posNum(w.setScore) !== undefined) out.walkover.setScore = posNum(w.setScore)!;
    out.walkover.byeCountsAsWalkover = pickBool(w.byeCountsAsWalkover, out.walkover.byeCountsAsWalkover);
    out.walkover.countInStandings = pickBool(w.countInStandings, out.walkover.countInStandings);
    out.walkover.countInPlayerStats = pickBool(w.countInPlayerStats, out.walkover.countInPlayerStats);
  }
  if (isObject(layer.tiebreak)) {
    const tb = layer.tiebreak;
    const criteria = normalizeCriteria(tb.criteria);
    if (criteria) out.tiebreak.criteria = criteria;
    out.tiebreak.headToHeadMode = pickEnum(tb.headToHeadMode, ['recursive', 'single_pass'] as const, out.tiebreak.headToHeadMode);
    out.tiebreak.unresolved = pickEnum(tb.unresolved, ['lot', 'admin_decision', 'playoff'] as const, out.tiebreak.unresolved);
    if (typeof tb.lotSeed === 'string' && tb.lotSeed) out.tiebreak.lotSeed = tb.lotSeed;
  }
  if (isObject(layer.finalRanking)) {
    const fr = layer.finalRanking;
    out.finalRanking.thirdPlace = pickEnum(fr.thirdPlace, ['match', 'joint'] as const, out.finalRanking.thirdPlace);
    out.finalRanking.fifthToEighth = pickEnum(fr.fifthToEighth, ['joint', 'qualifying_record'] as const, out.finalRanking.fifthToEighth);
    out.finalRanking.lowerPlaces = pickEnum(fr.lowerPlaces, ['joint', 'qualifying_record'] as const, out.finalRanking.lowerPlaces);
    out.finalRanking.placementMatches = pickBool(fr.placementMatches, out.finalRanking.placementMatches);
    const upTo = finiteNum(fr.rankingUpTo);
    if (upTo !== undefined && upTo >= 0) out.finalRanking.rankingUpTo = upTo;
    out.finalRanking.fifthToEighthMatches = pickEnum(fr.fifthToEighthMatches, FIFTH_TO_EIGHTH_FORMATS, out.finalRanking.fifthToEighthMatches);
    out.finalRanking.classificationGroups = pickBool(fr.classificationGroups, out.finalRanking.classificationGroups);
    const groupSize = posNum(fr.classificationGroupSize);
    if (groupSize && groupSize >= 2) out.finalRanking.classificationGroupSize = Math.floor(groupSize);
  }
  if (isObject(layer.qualification)) {
    const q = layer.qualification;
    const per = posNum(q.perGroup);
    if (per) out.qualification.perGroup = per;
    const wc = finiteNum(q.wildcards);
    if (wc !== undefined && wc >= 0) out.qualification.wildcards = Math.floor(wc);
    out.qualification.avoidSameGroupFirstRound = pickBool(q.avoidSameGroupFirstRound, out.qualification.avoidSameGroupFirstRound);
  }
  if (isObject(layer.retirement)) {
    out.retirement.mode = pickEnum(layer.retirement.mode, ['keep_played', 'as_walkover', 'as_recorded'] as const, out.retirement.mode);
  }
  if (isObject(layer.schedule)) {
    const rest = finiteNum(layer.schedule.minRestMinutes);
    if (rest !== undefined && rest >= 0) out.schedule.minRestMinutes = rest;
  }
  if (isObject(layer.tiebreakDecisions)) {
    for (const [key, d] of Object.entries(layer.tiebreakDecisions)) {
      if (!isObject(d)) continue;
      const ids = toList<unknown>(d.ids).filter((x): x is string => typeof x === 'string' && !!x);
      if (ids.length < 2) continue;
      out.tiebreakDecisions[key] = {
        ids,
        ...(typeof d.scope === 'string' && d.scope ? { scope: d.scope } : {}),
        ...(typeof d.decidedAt === 'number' ? { decidedAt: d.decidedAt } : {}),
        ...(typeof d.decidedBy === 'string' ? { decidedBy: d.decidedBy } : {}),
        ...(typeof d.note === 'string' ? { note: d.note } : {}),
      };
    }
  }
  return out;
}

/** 레거시 rankingMatchConfig의 순위결정전 점수 → 부분 점수 규칙 */
function scoringPartialFromLegacyRanking(rmc: Record<string, unknown>): Partial<ScoringRuleSet> | null {
  const out: Partial<ScoringRuleSet> = { ...(cleanScoringPartial(rmc.scoringRules) ?? {}) };
  const sets = posNum(rmc.rankingSetsToWin);
  const win = posNum(rmc.rankingWinScore);
  if (sets) { out.setsToWin = sets; delete out.maxSets; }
  if (win) out.winScore = win;
  return Object.keys(out).length > 0 ? out : null;
}

/** 레거시 대회 필드를 규칙 한 겹으로 바꾼다 */
function legacyTournamentLayer(t: TournamentLike): CompetitionRulesInput {
  const layer: CompetitionRulesInput = { scoring: {} };
  const gc = scoringFrom(t.gameConfig);
  const tms = scoringFrom(t.teamMatchSettings);
  const sr = scoringFrom(t.scoringRules);
  // 개인: gameConfig < scoringRules / 팀: teamMatchSettings(없으면 31점) < scoringRules
  const individual = sr ?? gc;
  const team = sr ?? tms;
  if (individual) layer.scoring!.individual = individual;
  if (team) layer.scoring!.team = team;
  // 레거시 teamRules.teamSize = 단체전 코트 위 선수 수
  const teamSize = posNum(isObject(t.teamRules) ? t.teamRules.teamSize : undefined);
  if (teamSize) layer.scoring!.team = { ...(layer.scoring!.team ?? {}), playersOnCourt: teamSize };

  const rmc = isObject(t.rankingMatchConfig) ? t.rankingMatchConfig : null;
  if (rmc) {
    layer.finalRanking = {};
    if (typeof rmc.thirdPlace === 'boolean') layer.finalRanking.thirdPlace = rmc.thirdPlace ? 'match' : 'joint';
    // 5~8위 결정전을 만들기로 했으면 그 결과로 순위를 정한다 (프리셋의 '순위결정전 없음'보다 대회 구조가 우선)
    if (rmc.fifthToEighth === true) {
      layer.finalRanking.placementMatches = true;
      layer.finalRanking.fifthToEighthMatches = pickEnum(rmc.fifthToEighthFormat, ['simple', 'full', 'round_robin'] as const, 'simple');
    } else if (rmc.fifthToEighth === false) {
      layer.finalRanking.fifthToEighthMatches = 'none';
    }
    if (typeof rmc.classificationGroups === 'boolean') layer.finalRanking.classificationGroups = rmc.classificationGroups;
    const groupSize = posNum(rmc.classificationGroupSize);
    if (groupSize) layer.finalRanking.classificationGroupSize = groupSize;
    const upTo = finiteNum(rmc.rankingUpTo);
    if (upTo !== undefined && upTo >= 0) layer.finalRanking.rankingUpTo = upTo;
    // 순위결정전 점수 (rankingMatchConfig.scoringRules 또는 rankingSetsToWin/rankingWinScore)
    const rs = scoringPartialFromLegacyRanking(rmc);
    if (rs) layer.placementScoring = { individual: rs, team: rs };
  }
  const fc = isObject(t.finalsConfig) ? t.finalsConfig : null;
  if (fc) {
    layer.qualification = {};
    const per = posNum(fc.advancePerGroup);
    if (per) layer.qualification.perGroup = per;
    else {
      // 조당 진출 인원이 없는 옛 대회: 본선 총 진출 인원(advanceCount)을 조 수로 나눈다
      const total = posNum(fc.advanceCount);
      const qc = isObject(t.qualifyingConfig) ? t.qualifyingConfig : null;
      const groups = posNum(qc?.groupCount) ?? 1;
      if (total) layer.qualification.perGroup = groups > 1 ? Math.max(1, Math.floor(total / groups)) : total;
    }
    const wc = finiteNum(fc.wildcardCount);
    if (wc !== undefined && wc >= 0) layer.qualification.wildcards = wc;
    if (typeof fc.avoidSameGroup === 'boolean') layer.qualification.avoidSameGroupFirstRound = fc.avoidSameGroup;
    // 위저드·챗봇의 라운드별 세트 수 (finalsConfig.roundScoringOverride = { fromRound, scoringRules }).
    // 세트 수만 바꾸는 설정이다: 목표 점수 등 나머지는 그 경기의 규칙을 따른다.
    const rso = isObject(fc.roundScoringOverride) ? fc.roundScoringOverride : null;
    const rsoFrom = posNum(rso?.fromRound);
    const rsoRules = cleanScoringPartial(rso?.scoringRules);
    if (rsoFrom && rsoRules?.setsToWin) {
      const part: Partial<ScoringRuleSet> = { setsToWin: rsoRules.setsToWin };
      if (rsoRules.maxSets) part.maxSets = rsoRules.maxSets;
      layer.roundScoring = { fromRound: rsoFrom, individual: part, team: part };
    }
  }
  const legacyCriteria = criteriaFromLegacy(t.tiebreakerRules);
  if (legacyCriteria) layer.tiebreak = { criteria: legacyCriteria };
  return layer;
}

/** 스테이지 ID로 스테이지를 찾는다. 정확히 없으면 접두사 스테이지(예: "{finals}_3rd" → finals)를 쓴다. */
export function findStage(t: TournamentLike | null | undefined, stageId: unknown): Record<string, unknown> | null {
  if (!t || typeof stageId !== 'string' || !stageId) return null;
  const stages = toList<unknown>(t.stages).filter(isObject);
  const exact = stages.find(s => s.id === stageId);
  if (exact) return exact;
  let best: Record<string, unknown> | null = null;
  for (const s of stages) {
    const id = typeof s.id === 'string' ? s.id : '';
    if (id && stageId.startsWith(`${id}_`) && (!best || id.length > String(best.id).length)) best = s;
  }
  return best;
}

/**
 * 대회(와 선택적 스테이지)의 유효 규칙. 항상 완전한 규칙 객체를 돌려준다.
 * 순위는 저장하지 않고 이 규칙으로 계산하므로, 규칙을 바꾸면 화면의 순위가 바로 다시 계산된다.
 */
export function resolveCompetitionRules(tournament: TournamentLike | null | undefined, stageId?: unknown): CompetitionRules {
  let rules = DEFAULT_COMPETITION_RULES;
  const t = tournament || {};
  const tRules = isObject(t.rules) ? t.rules : null;
  const presetId = tRules && typeof tRules.presetId === 'string' ? tRules.presetId : null;
  if (presetId && RULES_PRESETS[presetId]) {
    rules = applyRulesLayer(rules, RULES_PRESETS[presetId].rules);
    rules = { ...rules, presetId };
  }
  rules = applyRulesLayer(rules, legacyTournamentLayer(t));
  if (tRules) rules = applyRulesLayer(rules, tRules);
  const stage = findStage(t, stageId);
  if (stage) {
    // 레거시 stage.scoringRules: 목표 점수·세트 수가 있을 때만 쓴다. 원래 값을 넘겨 0/null(끔)도 반영한다.
    if (scoringFrom(stage.scoringRules)) rules = applyRulesLayer(rules, { scoring: { individual: stage.scoringRules, team: stage.scoringRules } });
    if (isObject(stage.rules)) rules = applyRulesLayer(rules, stage.rules);
  }
  return rules;
}

/**
 * 경기 하나의 유효 점수 규칙.
 * match.appliedScoringRules → stage(rules.scoring / scoringRules) → tournament(rules.scoring / scoringRules)
 * → 팀이면 teamMatchSettings 또는 31점 1게임 / 개인이면 gameConfig → 11점 3세트 2선승
 */
export function resolveMatchScoring(match: MatchScoringLike, tournament: TournamentLike | null | undefined): ScoringRuleSet {
  const applied = scoringFrom(match.appliedScoringRules);
  if (applied) return applied;
  const rules = resolveCompetitionRules(tournament, match.stageId);
  const kind = matchKindOf(match.type);
  const base = rules.scoring[kind];
  if (rules.placementScoring && isPlacementMatch(match)) {
    return mergeScoringPartial(base, rules.placementScoring[kind]);
  }
  const size = matchRoundSize(match);
  if (rules.roundScoring && size !== null && size <= rules.roundScoring.fromRound) {
    return mergeScoringPartial(base, rules.roundScoring[kind]);
  }
  return base;
}

/**
 * 순위결정전 경기인가 (3/4위전 제외: 3/4위전은 결승과 같은 라운드 규칙을 쓴다).
 * 본선 하위 스테이지(…_class…, …5to8, …9to16) 또는 "X/Y위 결정전"(X ≥ 5)·"N~M위 순위 결정전"·"N-M위 결정전" 라벨.
 */
export function isPlacementMatch(match: Pick<MatchScoringLike, 'stageId' | 'roundLabel' | 'bracketRound'>): boolean {
  const sid = typeof match.stageId === 'string' ? match.stageId : '';
  if (/_3rd$/.test(sid)) return false;
  if (/_class|5to8|9to16/.test(sid)) return true;
  for (const raw of [match.roundLabel, match.bracketRound]) {
    if (typeof raw !== 'string') continue;
    const label = raw.trim();
    const pair = /^(\d+)\s*\/\s*(\d+)\s*위/.exec(label);
    if (pair && Number(pair[1]) >= 5) return true;
    if (/^\d+\s*[-~]\s*\d+\s*위\s*(순위\s*)?(결정전|교차전)/.test(label)) return true;
  }
  return false;
}

/**
 * 본선 토너먼트 경기의 라운드 인원 (8강 = 8, 4강 = 4, 결승 = 2, 3/4위 결정전 = 2).
 * 리그·순위결정전 리그 등 토너먼트 라운드가 아니면 null.
 */
export function matchRoundSize(match: Pick<MatchScoringLike, 'roundLabel' | 'bracketRound'>): number | null {
  for (const raw of [match.bracketRound, match.roundLabel]) {
    if (typeof raw !== 'string') continue;
    const label = raw.trim();
    if (label === '결승') return 2;
    if (label.startsWith('3/4위')) return 2;
    const m = /^(\d+)강$/.exec(label);
    if (m) return Number(m[1]);
  }
  return null;
}

/** 세트 승자 (규칙의 목표 점수·점수 차·듀스 캡). 0:0 등 끝나지 않은 세트는 null. */
export function setWinnerByRules(p1: number, p2: number, rules: ScoringRuleSet): 1 | 2 | null {
  if (rules.deuceCap && (p1 >= rules.deuceCap || p2 >= rules.deuceCap)) {
    if (p1 > p2) return 1;
    if (p2 > p1) return 2;
    return null;
  }
  if (p1 >= rules.winScore && p1 - p2 >= rules.minLead) return 1;
  if (p2 >= rules.winScore && p2 - p1 >= rules.minLead) return 2;
  return null;
}

/**
 * 세트 결과 한 줄. decidedBy가 있으면 시간 제한으로 끝난 세트다(shared/rules/timeLimit.ts):
 * - decidedBy 'time_limit' | 'golden_goal': 점수와 상관없이 끝난 세트. decidedWinner(1|2)가 있으면 그 쪽, 없으면 점수가 높은 쪽.
 *   (골만 인정하는 골든골은 골 넣은 쪽이 점수로 뒤지거나 같을 수 있어 decidedWinner를 적는다.) 동점이면 승자 없음.
 * - matchTimeUp: 경기 전체 시간(per_match)이 이 세트에서 끝났다 → 경기가 이 세트로 끝난다.
 */
export interface SetResultLike {
  player1Score?: unknown;
  player2Score?: unknown;
  decidedBy?: unknown;
  decidedWinner?: unknown;
  matchTimeUp?: unknown;
}

export type SetDecidedBy = 'time_limit' | 'golden_goal';

export function isTimeDecidedSet(s: SetResultLike | null | undefined): boolean {
  return !!s && (s.decidedBy === 'time_limit' || s.decidedBy === 'golden_goal');
}

/** 세트 승자: 시간 제한으로 끝난 세트면 그 결과, 아니면 setWinnerByRules (목표 점수·점수 차·듀스 캡) */
export function setWinnerOf(s: SetResultLike | null | undefined, rules: ScoringRuleSet): 1 | 2 | null {
  if (!s) return null;
  const p1 = finiteNum(s.player1Score) ?? 0;
  const p2 = finiteNum(s.player2Score) ?? 0;
  if (isTimeDecidedSet(s)) {
    if (s.decidedWinner === 1 || s.decidedWinner === 2) return s.decidedWinner;
    return p1 > p2 ? 1 : p2 > p1 ? 2 : null;
  }
  return setWinnerByRules(p1, p2, rules);
}

/**
 * 세트 목록으로 경기 승자 (규칙 기준). 판정 불가면 null.
 * 경기 전체 시간 제한이 끝난 세트(matchTimeUp)가 있으면: 세트 승수가 많은 쪽, 같으면 그 세트를 이긴 쪽
 * (= 그 세트 점수가 앞선 쪽, 동점이었으면 골든골 승자). 그래도 없으면 null.
 */
export function matchWinnerByRules(sets: ReadonlyArray<SetResultLike>, rules: ScoringRuleSet): 1 | 2 | null {
  let w1 = 0;
  let w2 = 0;
  let timeUp: { winner: 1 | 2 | null } | null = null;
  for (const s of sets) {
    if (!s) continue;
    const w = setWinnerOf(s, rules);
    if (w === 1) w1++;
    else if (w === 2) w2++;
    if (s.matchTimeUp === true) timeUp = { winner: w };
  }
  if (w1 >= rules.setsToWin && w1 > w2) return 1;
  if (w2 >= rules.setsToWin && w2 > w1) return 2;
  if (timeUp) {
    if (w1 > w2) return 1;
    if (w2 > w1) return 2;
    return timeUp.winner;
  }
  return null;
}

/** 세트 목록의 양쪽 세트 승수 (규칙 기준: 끝나지 않은 세트는 세지 않는다. 시간 제한으로 끝난 세트는 센다) */
export function setWinsByRules(sets: ReadonlyArray<SetResultLike | null | undefined> | null | undefined, rules: ScoringRuleSet): { player1: number; player2: number } {
  let player1 = 0;
  let player2 = 0;
  for (const s of sets ?? []) {
    if (!s) continue;
    const w = setWinnerOf(s, rules);
    if (w === 1) player1++;
    else if (w === 2) player2++;
  }
  return { player1, player2 };
}

/** 동률 결정 저장 키 (범위 + 정렬된 ID). Firebase 키에 쓸 수 없는 문자는 바꾼다. */
export function tiebreakDecisionKey(scope: string, ids: readonly string[]): string {
  const raw = `${scope || 'all'}__${[...ids].sort().join('_')}`;
  return raw.replace(/[.#$/[\]]/g, '-');
}
