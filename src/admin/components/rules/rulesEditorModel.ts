/**
 * 대회 규칙 편집기(CompetitionRulesEditor)의 순수 로직 (M0b).
 *
 * 편집 대상은 "부분 규칙 층"이다: tournaments/{tid}/rules(대회 전체)와 stages[i].rules(스테이지 덮어쓰기).
 * 화면에는 resolveCompetitionRules로 계산한 유효 값을 보여 준다. 그래서 화면에 보이는 값이 곧 경기 생성·점수·순위가 쓰는 값이다.
 *
 * - Firebase는 null을 저장하지 못한다(키 삭제). 그래서 "상위 값을 끄는" 값은 표식으로 저장한다:
 *   walkover.setScore 0 = 세트 목표 점수 사용, roundScoring.fromRound 0 = 라운드별 규칙 없음.
 * - 동률 결정(rules/tiebreakDecisions)은 동률 화면이 따로 쓰므로 편집기는 건드리지 않는다.
 */
import {
  resolveCompetitionRules,
  isObject,
  matchKindOf,
  toList,
  DEFAULT_COMPETITION_RULES,
  TIEBREAK_CRITERIA,
  RULES_PRESETS,
  type CompetitionRules,
  type CompetitionRulesInput,
  type ScoringRuleSet,
  type TiebreakCriterion,
  type TournamentLike,
} from '@shared/rules/competitionRules';
import { isByeMatch } from '@shared/rules/walkover';

/** 편집 범위: 대회 전체 또는 스테이지 ID */
export const TOURNAMENT_SCOPE = '__tournament__';

export interface RulesDraft {
  tournament: CompetitionRulesInput;
  /** 스테이지 ID → 그 스테이지의 덮어쓰기 */
  stages: Record<string, CompetitionRulesInput>;
}

/** 편집기가 다루는 규칙 항목 (CompetitionRules 안의 점 경로) */
export const RULE_FIELD_PATHS = [
  'scoring.individual.winScore',
  'scoring.individual.setsToWin',
  'scoring.individual.maxSets',
  'scoring.individual.minLead',
  'scoring.team.winScore',
  'scoring.team.setsToWin',
  'scoring.team.maxSets',
  'scoring.team.minLead',
  'roundScoring',
  'standingsPoints.win',
  'standingsPoints.draw',
  'standingsPoints.loss',
  'standingsPoints.walkoverWin',
  'standingsPoints.forfeitLoss',
  'walkover.setScore',
  'walkover.countInStandings',
  'walkover.countInPlayerStats',
  'walkover.byeCountsAsWalkover',
  'retirement.mode',
  'tiebreak.criteria',
  'tiebreak.headToHeadMode',
  'tiebreak.unresolved',
  'finalRanking.thirdPlace',
  'finalRanking.fifthToEighth',
  'finalRanking.placementMatches',
  'finalRanking.lowerPlaces',
  'finalRanking.rankingUpTo',
  'qualification.perGroup',
  'qualification.wildcards',
  'qualification.avoidSameGroupFirstRound',
  'schedule.minRestMinutes',
] as const;

export type RuleFieldPath = (typeof RULE_FIELD_PATHS)[number];

/** 대회 전체에서만 정하는 항목 (프리셋) */
const LAYER_SECTIONS = [
  'presetId', 'scoring', 'roundScoring', 'standingsPoints', 'walkover', 'retirement',
  'tiebreak', 'finalRanking', 'qualification', 'schedule',
] as const;

/**
 * 스테이지 범위에서 실제로 쓰이는 항목 (경기 생성·순위 계산이 읽는 스테이지와 같게, docs/05 B15).
 * 목록의 접두사에 해당하는 항목은 적힌 스테이지 종류에서만 쓰인다(빈 목록 = 대회 전체에서만).
 * 목록에 없는 항목(점수·라운드별 세트 수·부전승 점수·경기 포기·휴식)은 모든 스테이지에서 쓰인다.
 * - 진출 인원·와일드카드: 예선 스테이지 규칙으로 진출자를 뽑는다
 * - 같은 조 회피: 본선 스테이지 규칙으로 1라운드를 배치한다
 * - 승점·동률·순위표 부전승 반영: 조별 순위표(예선, 순위결정전 리그)에서 쓴다
 * - 최종 순위·개인 전적 부전승 반영: 대회 전체 규칙으로 계산한다
 */
const FIELD_STAGE_USE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['standingsPoints', ['qualifying', 'ranking_match']],
  ['tiebreak', ['qualifying', 'ranking_match']],
  ['walkover.countInStandings', ['qualifying', 'ranking_match']],
  ['walkover.countInPlayerStats', []],
  ['finalRanking', []],
  ['qualification.perGroup', ['qualifying']],
  ['qualification.wildcards', ['qualifying']],
  ['qualification.avoidSameGroupFirstRound', ['finals']],
];

/** 이 항목이 그 종류의 스테이지에서 쓰이는가. 스테이지 종류를 모르면 쓰인다고 본다. */
export function fieldUsedAtStage(path: string, stageType: unknown): boolean {
  if (typeof stageType !== 'string' || !stageType) return true;
  const rule = FIELD_STAGE_USE.find(([prefix]) => path === prefix || path.startsWith(`${prefix}.`));
  return !rule || rule[1].includes(stageType);
}

// ===== 경로 도우미 =====

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (!isObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function hasPath(obj: unknown, path: string): boolean {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length; i++) {
    if (!isObject(cur) || !(parts[i] in cur)) return false;
    cur = cur[parts[i]];
  }
  return cur !== undefined;
}

/** 불변 설정: 중간 객체를 새로 만든다 */
export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const src = obj as Record<string, unknown>;
  if (rest.length === 0) return { ...src, [head]: value } as T;
  const child = isObject(src[head]) ? (src[head] as Record<string, unknown>) : {};
  return { ...src, [head]: setPath(child, rest.join('.'), value) } as T;
}

/** 불변 삭제: 비게 된 중간 객체도 지운다 */
export function deletePath<T extends object>(obj: T, path: string): T {
  const [head, ...rest] = path.split('.');
  const src = obj as Record<string, unknown>;
  if (!(head in src)) return obj;
  const out: Record<string, unknown> = { ...src };
  if (rest.length === 0) {
    delete out[head];
    return out as T;
  }
  if (!isObject(src[head])) return obj;
  const child = deletePath(src[head] as Record<string, unknown>, rest.join('.'));
  if (Object.keys(child).length === 0) delete out[head];
  else out[head] = child;
  return out as T;
}

function clone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v; // NaN(빈 입력)도 그대로 둔다
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 유효 값 → 층에 저장할 값 (null은 Firebase에 못 쓰므로 표식으로 바꾼다) */
export function toLayerValue(path: string, value: unknown): unknown {
  if (path === 'walkover.setScore' && value === null) return 0;
  if (path === 'roundScoring' && value === null) return { fromRound: 0 };
  return clone(value);
}

// ===== 초안 =====

export function emptyDraft(presetId?: string): RulesDraft {
  return { tournament: presetId ? { presetId } : {}, stages: {} };
}

interface StageLike {
  id?: unknown;
  rules?: unknown;
  [k: string]: unknown;
}

function stagesOf(t: TournamentLike | null | undefined): StageLike[] {
  return toList<unknown>(t?.stages).filter(isObject) as StageLike[];
}

/** 저장된 대회에서 편집 초안을 만든다 (동률 결정은 빼고) */
export function draftFromTournament(t: TournamentLike | null | undefined): RulesDraft {
  const tournament: CompetitionRulesInput = {};
  if (isObject(t?.rules)) {
    for (const [k, v] of Object.entries(t!.rules as Record<string, unknown>)) {
      if (k === 'tiebreakDecisions') continue;
      (tournament as Record<string, unknown>)[k] = clone(v);
    }
  }
  const stages: Record<string, CompetitionRulesInput> = {};
  for (const s of stagesOf(t)) {
    if (typeof s.id === 'string' && isObject(s.rules) && Object.keys(s.rules).length > 0) {
      stages[s.id] = clone(s.rules) as CompetitionRulesInput;
    }
  }
  return { tournament, stages };
}

/** 초안을 대회에 얹은 결과 (저장 전 미리보기용). 동률 결정은 원래 것을 유지한다. */
export function withDraft<T extends TournamentLike>(t: T, draft: RulesDraft): T {
  const orig = isObject(t.rules) ? (t.rules as Record<string, unknown>) : {};
  const rules: Record<string, unknown> = { ...draft.tournament };
  if (orig.tiebreakDecisions) rules.tiebreakDecisions = orig.tiebreakDecisions;
  const stages = stagesOf(t).map(s => {
    const { rules: _old, ...rest } = s;
    void _old;
    const layer = typeof s.id === 'string' ? draft.stages[s.id] : undefined;
    return layer ? { ...rest, rules: layer } : rest;
  });
  return t.stages === undefined ? { ...t, rules } : { ...t, rules, stages };
}

export function layerOf(draft: RulesDraft, scope: string): CompetitionRulesInput {
  return scope === TOURNAMENT_SCOPE ? draft.tournament : (draft.stages[scope] ?? {});
}

function withLayer(draft: RulesDraft, scope: string, layer: CompetitionRulesInput): RulesDraft {
  if (scope === TOURNAMENT_SCOPE) return { ...draft, tournament: layer };
  const stages = { ...draft.stages };
  if (Object.keys(layer).length === 0) delete stages[scope];
  else stages[scope] = layer;
  return { ...draft, stages };
}

/** 범위의 유효 규칙 */
export function effectiveRules(t: TournamentLike, draft: RulesDraft, scope: string): CompetitionRules {
  return resolveCompetitionRules(withDraft(t, draft), scope === TOURNAMENT_SCOPE ? undefined : scope);
}

/** 화면 표시 값: 이 범위 층에 입력한 원래 값(잘못된 값 포함)이 있으면 그것, 없으면 유효 값 */
export function displayValue(t: TournamentLike, draft: RulesDraft, scope: string, path: string): unknown {
  const layer = layerOf(draft, scope);
  if (hasPath(layer, path)) {
    const raw = getPath(layer, path);
    if (path === 'walkover.setScore' && raw === 0) return null;
    if (path === 'roundScoring' && isObject(raw) && raw.fromRound === 0) return null;
    return raw;
  }
  return getPath(effectiveRules(t, draft, scope), path);
}

/** 값 설정 */
export function setFieldValue(draft: RulesDraft, scope: string, path: string, value: unknown): RulesDraft {
  return withLayer(draft, scope, setPath(layerOf(draft, scope), path, toLayerValue(path, value)));
}

/** 여러 값을 한 번에 설정 (예: 세트 수 = setsToWin + maxSets) */
export function setFieldValues(draft: RulesDraft, scope: string, values: Record<string, unknown>): RulesDraft {
  let out = draft;
  for (const [path, v] of Object.entries(values)) out = setFieldValue(out, scope, path, v);
  return out;
}

/** 키 순서와 상관없이 비교한다 (Firebase는 배열을 숫자 키 객체로 돌려줄 수 있어 배열도 목록으로 본다) */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (isObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = stable(v[k]);
    return out;
  }
  return v ?? null;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/** 이 스테이지에서 대회 전체 값과 다른 항목 */
export function overriddenPaths(t: TournamentLike, draft: RulesDraft, stageId: string): RuleFieldPath[] {
  if (stageId === TOURNAMENT_SCOPE) return [];
  const base = effectiveRules(t, draft, TOURNAMENT_SCOPE);
  const eff = effectiveRules(t, draft, stageId);
  return RULE_FIELD_PATHS.filter(p => !same(getPath(eff, p), getPath(base, p)));
}

/**
 * 스테이지 항목을 대회 전체 값으로 되돌린다.
 * 스테이지 층에서 지운 뒤에도 (레거시 stage.scoringRules 때문에) 다르면 대회 값을 명시적으로 적는다.
 */
export function resetStagePaths(t: TournamentLike, draft: RulesDraft, stageId: string, paths: readonly string[]): RulesDraft {
  if (stageId === TOURNAMENT_SCOPE) return draft;
  let layer = layerOf(draft, stageId);
  for (const p of paths) layer = deletePath(layer, p);
  let out = withLayer(draft, stageId, layer);
  const base = effectiveRules(t, out, TOURNAMENT_SCOPE);
  const eff = effectiveRules(t, out, stageId);
  const still = paths.filter(p => !same(getPath(eff, p), getPath(base, p)));
  if (still.length > 0) {
    const values: Record<string, unknown> = {};
    for (const p of still) values[p] = getPath(base, p);
    out = setFieldValues(out, stageId, values);
  }
  return out;
}

/** 값의 끝 경로 (배열은 값 하나로 본다) */
function leafPaths(obj: unknown, prefix = ''): string[] {
  if (!isObject(obj)) return prefix ? [prefix] : [];
  return Object.entries(obj).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

/** 어느 프리셋이든 정하는 항목 (프리셋을 바꾸면 이 항목은 모두 새 프리셋 값 또는 기본값이 된다) */
function presetPaths(): string[] {
  const out = new Set<string>();
  for (const p of Object.values(RULES_PRESETS)) for (const path of leafPaths(p.rules)) out.add(path);
  return [...out];
}

/**
 * 프리셋으로 대회 전체 값을 채운다: 대회 전체 층을 프리셋 값으로 바꾼다(이전의 대회 전체 편집은 지운다).
 * 프리셋이 정하는 항목(동률 기준, 3위·5~8위 결정 방식 등)은 값을 직접 적는다. 그래야 대회 구조의
 * 레거시 값(rankingMatchConfig.thirdPlace 등)보다 우선해 고른 프리셋이 실제로 적용된다.
 * 어떤 프리셋에는 있고 고른 프리셋에는 없는 항목은 기본값으로 적는다(프리셋을 바꿔도 이전 프리셋 값이 남지 않게).
 * 스테이지 덮어쓰기와 프리셋이 정하지 않는 대회 구조 값(세트 수, 진출 인원)은 그대로 둔다.
 */
export function applyPreset(draft: RulesDraft, presetId: string): RulesDraft {
  const preset = RULES_PRESETS[presetId];
  if (!preset) return draft;
  let layer: CompetitionRulesInput = { presetId };
  for (const path of presetPaths()) {
    const v = hasPath(preset.rules, path) ? getPath(preset.rules, path) : getPath(DEFAULT_COMPETITION_RULES, path);
    if (v !== undefined) layer = setPath(layer, path, clone(v));
  }
  return { ...draft, tournament: layer };
}

/**
 * 초안의 모든 층(대회 전체 + 스테이지)에서 경로를 지운다.
 * 마법사 앞 단계에서 같은 값을 다시 고르면(예: 3/4위전 켜기) 그 값이 적용되도록 규칙 단계의 편집을 지우는 데 쓴다.
 */
export function clearDraftPaths(draft: RulesDraft, paths: readonly string[]): RulesDraft {
  let tournament = draft.tournament;
  for (const p of paths) tournament = deletePath(tournament, p);
  const stages: Record<string, CompetitionRulesInput> = {};
  for (const [id, layer] of Object.entries(draft.stages)) {
    let l = layer;
    for (const p of paths) l = deletePath(l, p);
    if (Object.keys(l).length > 0) stages[id] = l;
  }
  return { tournament, stages };
}

// ===== 동률 기준 목록 =====

/** 목록에서 index 항목을 delta만큼 옮긴다. 범위를 벗어나면 원래 목록 그대로. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item);
  return out;
}

export function removeItem<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** 아직 목록에 없는 동률 기준 */
export function availableCriteria(list: readonly TiebreakCriterion[]): TiebreakCriterion[] {
  return TIEBREAK_CRITERIA.filter(c => !list.includes(c));
}

export function addCriterion(list: readonly TiebreakCriterion[], c: TiebreakCriterion): TiebreakCriterion[] {
  return list.includes(c) ? [...list] : [...list, c];
}

// ===== 검증 =====

export type RuleIssueCode =
  | 'required'
  | 'integer'
  | 'min'
  | 'max'
  | 'bestOfOdd'
  | 'tiebreakEmpty'
  | 'roundFrom'
  | 'lotSeedMissing'
  | 'confirmRequired';

export interface RuleIssue {
  scope: string;
  path: string;
  code: RuleIssueCode;
  params?: Record<string, number | string>;
}

interface NumberConstraint { min: number; max?: number; integer: boolean }

const NUMBER_CONSTRAINTS: Record<string, NumberConstraint> = {
  'scoring.individual.winScore': { min: 1, max: 99, integer: true },
  'scoring.individual.setsToWin': { min: 1, max: 9, integer: true },
  'scoring.individual.maxSets': { min: 1, max: 17, integer: true },
  'scoring.individual.minLead': { min: 1, max: 9, integer: true },
  'scoring.team.winScore': { min: 1, max: 99, integer: true },
  'scoring.team.setsToWin': { min: 1, max: 9, integer: true },
  'scoring.team.maxSets': { min: 1, max: 17, integer: true },
  'scoring.team.minLead': { min: 1, max: 9, integer: true },
  'standingsPoints.win': { min: -99, max: 99, integer: false },
  'standingsPoints.draw': { min: -99, max: 99, integer: false },
  'standingsPoints.loss': { min: -99, max: 99, integer: false },
  'standingsPoints.walkoverWin': { min: -99, max: 99, integer: false },
  'standingsPoints.forfeitLoss': { min: -99, max: 99, integer: false },
  'walkover.setScore': { min: 0, max: 99, integer: true },
  'finalRanking.rankingUpTo': { min: 0, max: 512, integer: true },
  'qualification.perGroup': { min: 1, max: 64, integer: true },
  'qualification.wildcards': { min: 0, max: 64, integer: true },
  'schedule.minRestMinutes': { min: 0, max: 600, integer: true },
  'roundScoring.individual.setsToWin': { min: 1, max: 9, integer: true },
  'roundScoring.team.setsToWin': { min: 1, max: 9, integer: true },
};

function checkNumber(scope: string, path: string, raw: unknown, c: NumberConstraint, out: RuleIssue[]) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    out.push({ scope, path, code: 'required' });
    return;
  }
  if (c.integer && !Number.isInteger(raw)) out.push({ scope, path, code: 'integer' });
  else if (raw < c.min) out.push({ scope, path, code: 'min', params: { min: c.min } });
  else if (c.max !== undefined && raw > c.max) out.push({ scope, path, code: 'max', params: { max: c.max } });
}

/** 한 범위(대회 전체 또는 스테이지)의 입력 값과 유효 값을 검사한다 */
function validateScope(t: TournamentLike, draft: RulesDraft, scope: string): RuleIssue[] {
  const out: RuleIssue[] = [];
  const layer = layerOf(draft, scope);
  for (const [path, c] of Object.entries(NUMBER_CONSTRAINTS)) {
    if (hasPath(layer, path)) {
      checkNumber(scope, path, getPath(layer, path), c, out);
    }
  }
  const rawCriteria = getPath(layer, 'tiebreak.criteria');
  if (rawCriteria !== undefined && toList(rawCriteria).length === 0) out.push({ scope, path: 'tiebreak.criteria', code: 'tiebreakEmpty' });

  const rawRound = getPath(layer, 'roundScoring');
  if (isObject(rawRound) && rawRound.fromRound !== 0) {
    const f = rawRound.fromRound;
    if (typeof f !== 'number' || f < 2 || !Number.isInteger(f) || (f & (f - 1)) !== 0) {
      out.push({ scope, path: 'roundScoring', code: 'roundFrom' });
    }
  }

  // 유효 값 조합 검사: 경기 세트 수는 홀수(1·3·5…)여야 하고, 이겨야 하는 세트 수 = (세트 수 + 1) / 2
  if (out.length === 0) {
    const eff = effectiveRules(t, draft, scope);
    for (const kind of ['individual', 'team'] as const) {
      const s = eff.scoring[kind];
      if (s.maxSets % 2 !== 1 || s.maxSets !== s.setsToWin * 2 - 1) {
        out.push({ scope, path: `scoring.${kind}.maxSets`, code: 'bestOfOdd' });
      }
    }
    if (eff.tiebreak.criteria.length === 0) out.push({ scope, path: 'tiebreak.criteria', code: 'tiebreakEmpty' });
  }
  return out;
}

/** 초안 전체 검사 (대회 전체 + 덮어쓰기가 있는 스테이지). 문제 없으면 빈 배열. */
export function validateDraft(t: TournamentLike, draft: RulesDraft): RuleIssue[] {
  const issues = validateScope(t, draft, TOURNAMENT_SCOPE);
  for (const s of stagesOf(t)) {
    if (typeof s.id === 'string' && draft.stages[s.id]) issues.push(...validateScope(t, draft, s.id));
  }
  return issues;
}

// ===== 변경 영향 =====

export type RulesChangeImpact = 'none' | 'started' | 'finals';

interface MatchLikeForImpact {
  status?: unknown;
  stageId?: unknown;
  bye?: unknown;
  isBye?: unknown;
}

/**
 * 규칙을 바꾸면 무엇이 다시 계산되는가.
 * - finals: 본선(또는 순위결정전) 경기가 이미 만들어졌다 → 진출자 선정이 바뀌어도 대진은 그대로라 강한 경고 + 확인
 * - started: 경기가 시작되었거나 끝났다 → 순위표·진출 계산이 다시 된다
 */
export function rulesChangeImpact(t: TournamentLike, matches: ReadonlyArray<MatchLikeForImpact>): RulesChangeImpact {
  const laterStageIds = stagesOf(t)
    .filter(s => s.type === 'finals' || s.type === 'ranking_match')
    .map(s => s.id)
    .filter((id): id is string => typeof id === 'string' && !!id);
  const inLater = (sid: unknown) => typeof sid === 'string' && laterStageIds.some(id => sid === id || sid.startsWith(`${id}_`));
  if (matches.some(m => inLater(m.stageId))) return 'finals';
  if (matches.some(m => (m.status === 'in_progress' || m.status === 'completed') && !isByeMatch(m))) return 'started';
  return 'none';
}

// ===== 저장 =====

function cleanLayer(v: unknown): unknown {
  if (!isObject(v)) return v === undefined ? null : v;
  return Object.keys(v).length > 0 ? clone(v) : null;
}

function sameLayer(a: unknown, b: unknown): boolean {
  return same(cleanLayer(a), cleanLayer(b));
}

/** stages를 [저장 키, 스테이지]로 (Firebase는 배열을 숫자 키 객체로 돌려줄 수 있다) */
function stageEntries(t: TournamentLike): [string, StageLike & { id: string }][] {
  const raw = t.stages;
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((s, i) => [String(i), s])
    : isObject(raw) ? Object.entries(raw) : [];
  return entries.filter((e): e is [string, StageLike & { id: string }] => isObject(e[1]) && typeof e[1].id === 'string');
}

/**
 * 3방향 병합: 편집을 시작한 초안(base)에서 바뀐 섹션·스테이지 층만 편집 값(edit)을 쓰고,
 * 나머지는 지금 저장된 값(saved)을 쓴다. 편집하는 동안 다른 관리자·챗봇이 바꾼 섹션을 되돌리지 않기 위해서다.
 */
export function mergeDrafts(saved: RulesDraft, base: RulesDraft, edit: RulesDraft): RulesDraft {
  const tournament: Record<string, unknown> = { ...(saved.tournament as Record<string, unknown>) };
  const e = edit.tournament as Record<string, unknown>;
  const b = base.tournament as Record<string, unknown>;
  for (const k of LAYER_SECTIONS) {
    if (sameLayer(e[k], b[k])) continue;
    if (e[k] === undefined) delete tournament[k];
    else tournament[k] = clone(e[k]);
  }
  const stages: Record<string, CompetitionRulesInput> = {};
  const ids = new Set([...Object.keys(saved.stages), ...Object.keys(base.stages), ...Object.keys(edit.stages)]);
  for (const sid of ids) {
    const v = sameLayer(edit.stages[sid], base.stages[sid]) ? saved.stages[sid] : edit.stages[sid];
    if (v && Object.keys(v).length > 0) stages[sid] = clone(v);
  }
  return { tournament: tournament as CompetitionRulesInput, stages };
}

/** rules/<섹션>과 stages/<키>/rules 중 저장된 값과 다른 것만 */
function rulesPayload(t: TournamentLike, next: RulesDraft): Record<string, unknown> {
  const saved = draftFromTournament(t).tournament as Record<string, unknown>;
  const layer = next.tournament as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const k of LAYER_SECTIONS) {
    if (!sameLayer(layer[k], saved[k])) payload[`rules/${k}`] = cleanLayer(layer[k]);
  }
  for (const [key, s] of stageEntries(t)) {
    const nextLayer = cleanLayer(next.stages[s.id]);
    const prev = isObject(s.rules) && Object.keys(s.rules).length > 0 ? s.rules : null;
    if (!same(prev, nextLayer)) payload[`stages/${key}/rules`] = nextLayer;
  }
  return payload;
}

function nextPow2(n: number): number {
  let s = 1;
  while (s < n) s *= 2;
  return s;
}

function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * 유효 규칙 → 레거시 필드 값 ('/'로 이은 경로 → 값, null = 삭제).
 * 관전 화면·챗봇 시뮬레이션·경기 수 추정 등이 아직 레거시 필드(gameConfig, scoringRules, teamMatchSettings,
 * finalsConfig, rankingMatchConfig, stage.advanceCount)를 직접 읽으므로 규칙을 저장할 때 같은 값으로 맞춘다.
 * 마법사 저장과 대회 상세 '경기 규칙' 탭이 이 함수를 함께 쓴다.
 * 레거시 층은 규칙 층보다 아래라서 유효 값을 다시 적어도 그 단계의 유효 규칙은 바뀌지 않는다.
 * 진출 인원·와일드카드는 예선 스테이지, 같은 조 회피·3/4위전은 본선 스테이지 규칙에서 읽는다(생성기와 같게).
 * finalsConfig.roundScoringOverride는 맞추지 않는다(규칙 층의 roundScoring이 우선한다.
 * functions simulate.ts는 아직 이 필드를 직접 읽는다).
 */
export function legacyRuleFields(t: TournamentLike): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const kind = matchKindOf(t.type);
  const leaves = (prefix: string, r: ScoringRuleSet, keys: readonly (keyof ScoringRuleSet)[] = ['winScore', 'setsToWin', 'maxSets', 'minLead']) => {
    for (const k of keys) out[`${prefix}/${k}`] = r[k] ?? null;
  };
  const tr = resolveCompetitionRules(t);
  leaves('gameConfig', tr.scoring[kind], ['winScore', 'setsToWin']);
  if (isObject(t.scoringRules)) leaves('scoringRules', tr.scoring[kind]);
  if (kind === 'team') leaves('teamMatchSettings', tr.scoring.team, ['winScore', 'setsToWin', 'minLead']);

  const stages = stageEntries(t);
  for (const [key, s] of stages) {
    if (isObject(s.scoringRules)) leaves(`stages/${key}/scoringRules`, resolveCompetitionRules(t, s.id).scoring[kind]);
  }
  const qual = stages.find(([, s]) => s.type === 'qualifying');
  const fin = stages.find(([, s]) => s.type === 'finals');
  const qc = isObject(t.qualifyingConfig) ? t.qualifyingConfig : null;
  if (qc && qual && isObject(qc.scoringRules)) leaves('qualifyingConfig/scoringRules', resolveCompetitionRules(t, qual[1].id).scoring[kind]);
  const fc = isObject(t.finalsConfig) ? t.finalsConfig : null;
  if (fc && fin) {
    const fr = resolveCompetitionRules(t, fin[1].id);
    if (isObject(fc.scoringRules)) leaves('finalsConfig/scoringRules', fr.scoring[kind]);
    if (qual) {
      const q = resolveCompetitionRules(t, qual[1].id).qualification;
      const groups = positive(qc?.groupCount) ?? positive(qual[1].groupCount) ?? 1;
      const advance = q.perGroup * groups + q.wildcards;
      out['finalsConfig/advancePerGroup'] = q.perGroup;
      out['finalsConfig/wildcardCount'] = q.wildcards > 0 ? q.wildcards : null;
      out['finalsConfig/avoidSameGroup'] = fr.qualification.avoidSameGroupFirstRound;
      out['finalsConfig/advanceCount'] = advance;
      out[`stages/${fin[0]}/advanceCount`] = advance;
      const start = positive(fc.startingRound);
      if (!start || start < advance) out['finalsConfig/startingRound'] = Math.max(4, nextPow2(advance));
    }
  }
  if (isObject(t.rankingMatchConfig)) {
    if (fin) out['rankingMatchConfig/thirdPlace'] = resolveCompetitionRules(t, fin[1].id).finalRanking.thirdPlace === 'match';
    const upTo = tr.finalRanking.rankingUpTo;
    out['rankingMatchConfig/rankingUpTo'] = upTo > 0 ? upTo : null;
  }
  return out;
}

/**
 * updateTournament에 넘길 다중 경로 업데이트. rules/tiebreakDecisions와 규칙과 무관한 필드는 건드리지 않는다.
 * - base(편집을 시작한 초안)를 주면 3방향 병합으로, 편집 중 바꾼 섹션·스테이지 층만 쓴다(다른 사람의 동시 변경 보존).
 * - 저장된 값과 다른 섹션만 쓰고, 지운 항목은 null(= Firebase에서 삭제)로 보낸다.
 * - 규칙이 바뀌면 레거시 필드도 유효 값으로 맞춘다(legacyRuleFields).
 */
export function buildRulesWritePayload(t: TournamentLike, draft: RulesDraft, base?: RulesDraft): Record<string, unknown> {
  const next = base ? mergeDrafts(draftFromTournament(t), base, draft) : draft;
  const payload = rulesPayload(t, next);
  if (Object.keys(payload).length === 0) return payload;
  for (const [path, v] of Object.entries(legacyRuleFields(withDraft(t, next)))) {
    if (!same(v, getPath(t, path.split('/').join('.')))) payload[path] = v;
  }
  return payload;
}

/** 초안이 저장된 값과 다른가 (base를 주면 편집을 시작한 뒤 바꾼 것만 본다) */
export function isDraftDirty(t: TournamentLike, draft: RulesDraft, base?: RulesDraft): boolean {
  const next = base ? mergeDrafts(draftFromTournament(t), base, draft) : draft;
  return Object.keys(rulesPayload(t, next)).length > 0;
}

/** 편집을 시작한 뒤 저장된 규칙이 (다른 관리자·챗봇 때문에) 바뀌었는가 */
export function savedChangedSince(t: TournamentLike, base: RulesDraft): boolean {
  const saved = draftFromTournament(t);
  return !same(saved.tournament, base.tournament) || !same(saved.stages, base.stages);
}

/** 필드 DOM id */
export function fieldDomId(prefix: string, path: string): string {
  return `${prefix}-${path.replace(/\./g, '-')}`;
}
