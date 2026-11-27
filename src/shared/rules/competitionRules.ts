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
  timeLimitSeconds?: number;
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
  /** 부전승 세트 점수. null이면 그 경기의 세트 목표 점수(개인 11, 팀 31)를 쓴다 → 11:0 × 이겨야 하는 세트 수 */
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
}

export interface QualificationRules {
  /** 조당 진출 인원 */
  perGroup: number;
  /** 와일드카드(차순위 중 성적 상위) 인원. 명시적으로 설정할 때만 쓴다(자동 추가 없음). */
  wildcards: number;
  /** 본선 1라운드에서 같은 조끼리 만나지 않게 배치 */
  avoidSameGroupFirstRound: boolean;
}

export interface CompetitionRules {
  presetId: string;
  scoring: Record<MatchKind, ScoringRuleSet>;
  standingsPoints: StandingsPoints;
  walkover: WalkoverRules;
  tiebreak: TiebreakRules;
  finalRanking: FinalRankingRules;
  qualification: QualificationRules;
  tiebreakDecisions: Record<string, TiebreakDecision>;
}

/** DB에 저장하는 부분 규칙 (tournament.rules, stage.rules) */
export interface CompetitionRulesInput {
  presetId?: string;
  scoring?: { individual?: Partial<ScoringRuleSet>; team?: Partial<ScoringRuleSet> };
  standingsPoints?: Partial<StandingsPoints>;
  walkover?: Partial<WalkoverRules>;
  tiebreak?: Partial<TiebreakRules>;
  finalRanking?: Partial<FinalRankingRules>;
  qualification?: Partial<QualificationRules>;
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
}

export interface MatchScoringLike {
  type?: unknown;
  stageId?: unknown;
  appliedScoringRules?: unknown;
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
  standingsPoints: { win: 1, draw: 0, loss: 0, walkoverWin: 1, forfeitLoss: 0 },
  walkover: { setScore: null, byeCountsAsWalkover: true, countInStandings: true, countInPlayerStats: true },
  tiebreak: { criteria: DEFAULT_TIEBREAK_CRITERIA, headToHeadMode: 'recursive', unresolved: 'admin_decision' },
  finalRanking: { thirdPlace: 'match', fifthToEighth: 'joint', lowerPlaces: 'joint', placementMatches: true, rankingUpTo: 0 },
  qualification: { perGroup: 2, wildcards: 0, avoidSameGroupFirstRound: true },
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
};

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
    minLead: posNum(obj.minLead) ?? 2,
  };
  const deuceCap = posNum(obj.deuceCap);
  if (deuceCap) out.deuceCap = deuceCap;
  const tl = posNum(obj.timeLimitSeconds);
  if (tl) out.timeLimitSeconds = tl;
  return out;
}

function mergeScoringPartial(base: ScoringRuleSet, part: unknown): ScoringRuleSet {
  if (!isObject(part)) return base;
  const p = stripUndefined(part);
  // 세트 수만 바꾸면 최대 세트 수도 따라 바꾼다 (3선승이면 최대 5세트)
  const merged: Record<string, unknown> = { ...base, ...p };
  if (p.setsToWin !== undefined && p.maxSets === undefined) delete merged.maxSets;
  const full = scoringFrom(merged);
  return full ?? base;
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

/** 레거시 TiebreakerRule[](위저드/챗봇) → 기준 목록. 승점이 항상 첫 기준이다. */
export function criteriaFromLegacy(v: unknown): TiebreakCriterion[] | null {
  const map: Record<string, TiebreakCriterion> = {
    head_to_head: 'head_to_head', set_difference: 'set_difference', point_difference: 'point_difference', points_for: 'points_scored',
  };
  const list = toList<unknown>(v).map(x => (typeof x === 'string' ? map[x] : undefined)).filter((x): x is TiebreakCriterion => !!x);
  if (list.length === 0) return null;
  return ['points', ...new Set(list)];
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
    tiebreakDecisions: { ...base.tiebreakDecisions },
  };
  if (typeof layer.presetId === 'string') out.presetId = layer.presetId;
  if (isObject(layer.scoring)) {
    out.scoring.individual = mergeScoringPartial(out.scoring.individual, layer.scoring.individual);
    out.scoring.team = mergeScoringPartial(out.scoring.team, layer.scoring.team);
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
    if (w.setScore === null) out.walkover.setScore = null;
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
  }
  if (isObject(layer.qualification)) {
    const q = layer.qualification;
    const per = posNum(q.perGroup);
    if (per) out.qualification.perGroup = per;
    const wc = finiteNum(q.wildcards);
    if (wc !== undefined && wc >= 0) out.qualification.wildcards = Math.floor(wc);
    out.qualification.avoidSameGroupFirstRound = pickBool(q.avoidSameGroupFirstRound, out.qualification.avoidSameGroupFirstRound);
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

  const rmc = isObject(t.rankingMatchConfig) ? t.rankingMatchConfig : null;
  if (rmc) {
    layer.finalRanking = {};
    if (typeof rmc.thirdPlace === 'boolean') layer.finalRanking.thirdPlace = rmc.thirdPlace ? 'match' : 'joint';
    const upTo = finiteNum(rmc.rankingUpTo);
    if (upTo !== undefined && upTo >= 0) layer.finalRanking.rankingUpTo = upTo;
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
    const sr = scoringFrom(stage.scoringRules);
    if (sr) rules = applyRulesLayer(rules, { scoring: { individual: sr, team: sr } });
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
  return resolveCompetitionRules(tournament, match.stageId).scoring[matchKindOf(match.type)];
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

/** 세트 목록으로 경기 승자 (규칙 기준). 판정 불가면 null. */
export function matchWinnerByRules(sets: ReadonlyArray<{ player1Score?: unknown; player2Score?: unknown }>, rules: ScoringRuleSet): 1 | 2 | null {
  let w1 = 0;
  let w2 = 0;
  for (const s of sets) {
    const w = setWinnerByRules(finiteNum(s.player1Score) ?? 0, finiteNum(s.player2Score) ?? 0, rules);
    if (w === 1) w1++;
    else if (w === 2) w2++;
  }
  if (w1 >= rules.setsToWin && w1 > w2) return 1;
  if (w2 >= rules.setsToWin && w2 > w1) return 2;
  return null;
}

/** 동률 결정 저장 키 (범위 + 정렬된 ID). Firebase 키에 쓸 수 없는 문자는 바꾼다. */
export function tiebreakDecisionKey(scope: string, ids: readonly string[]): string {
  const raw = `${scope || 'all'}__${[...ids].sort().join('_')}`;
  return raw.replace(/[.#$/[\]]/g, '-');
}
