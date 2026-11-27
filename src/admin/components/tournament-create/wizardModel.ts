/**
 * 대회 생성 마법사의 상태·리듀서·저장 문서 변환 (순수 모듈, M0b).
 *
 * 원칙: 마법사에서 관리자가 본 값이 그대로 저장되고, 경기 생성·점수·순위가 그 값을 쓴다(docs/05 B15).
 * - buildTournamentFromWizard가 저장 문서를 만드는 유일한 곳이다. 미리보기도 이 결과에서 읽는다.
 * - 경기 규칙(동률·부전승·순위·휴식 등)은 '경기 규칙' 단계의 규칙 초안(rulesDraft)으로 tournament.rules와
 *   stages[i].rules에 저장된다. 이전 단계에서 정한 세트 수·진출 인원·3/4위전은 레거시 필드로도 함께 적어
 *   (규칙 단일 설정원의 유효 값과 같게) 옛 화면·시뮬레이션이 같은 값을 읽게 한다.
 */
import { WIZARD_PRESETS } from '@shared/constants/presets';
import { buildStagesFromWizard, calculateWildcard, mapToLegacyFormat } from '@shared/utils/tournament';
import { resolveCompetitionRules } from '@shared/rules/competitionRules';
import { clearDraftPaths, emptyDraft, legacyRuleFields, withDraft, type RulesDraft } from '../rules/rulesEditorModel';
import type {
  BracketFormatType,
  MatchRules,
  RankingMatchConfig,
  ScoringRules,
  TeamRules,
  Tournament,
  TournamentStage,
  TournamentType,
  StageType,
} from '@shared/types';

// ===== 단계 =====

export const WIZARD_STEP = { basicInfo: 1, participants: 2, format: 3, rules: 4, preview: 5 } as const;
export const WIZARD_TOTAL_STEPS = 5;

/** 마법사의 규칙 편집기가 쓰는 스테이지 자리 표시 ID (저장할 때 실제 ID로 바뀐다) */
export const WIZARD_STAGE_KEYS: Record<StageType, string> = {
  qualifying: 'qualifying',
  finals: 'finals',
  ranking_match: 'ranking_match',
};

// ===== 상태 =====

export interface WizardState {
  step: number;
  // Step 1
  name: string;
  date: string;
  endDate: string;
  scheduleDates: string[];
  type: TournamentType;
  presetId: string | null;
  // Step 2
  tournamentMode: 'full_league_all' | 'group_tournament' | 'direct_tournament' | 'manual';
  participantCount: number;
  participantNames: string[];
  hasGroupStage: boolean;
  groupCount: number;
  teamSize: number;
  // 예선
  qualifyingFormat: 'round_robin' | 'group_round_robin';
  qualifyingScoringRules: ScoringRules;
  qualifyingMatchRules: MatchRules;
  advanceCount: number;
  advancePerGroup: number;
  // 본선
  hasFinalsStage: boolean;
  finalsFormat: 'single_elimination' | 'double_elimination' | 'round_robin';
  finalsStartRound: number;
  finalsScoringRules: ScoringRules;
  finalsMatchRules: MatchRules;
  /** 본선 점수 규칙이 예선과 같은가 (리듀서가 두 값을 비교해 유지한다) */
  sameRulesAsQualifying: boolean;
  bracketArrangement: 'cross_group' | 'sequential' | 'custom';
  avoidSameGroup: boolean;
  thirdPlaceMatch: boolean;
  hasRankingMatch: boolean;
  rankingMatch: RankingMatchConfig;
  // 순위결정전
  fifthToEighth: boolean;
  fifthToEighthFormat: 'simple' | 'full' | 'round_robin';
  classificationGroups: boolean;
  classificationGroupSize: number;
  rankingUpTo: number;
  // 라운드별 세트 수 오버라이드
  hasRoundScoringOverride: boolean;
  roundOverrideFromRound: number;
  roundOverrideSetsToWin: number;
  roundOverrideMaxSets: number;
  // 커스텀 대진
  customPairings: Array<{ position: number; slot1: string; slot2: string }>;
  // 공통
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules: TeamRules;
  formatType: BracketFormatType;
  useCustomRules: boolean;
  startingRound: number;
  seedMethod: 'ranking' | 'manual' | 'custom';
  hasThirdPlaceMatch: boolean;
  // 경기 규칙 단계
  rulesDraft: RulesDraft;
  /** 관리자가 규칙을 확인했다고 표시했는가 (확인 전에는 미리보기로 넘어가지 않는다) */
  rulesConfirmed: boolean;
}

export type Action =
  | { type: 'SET_FIELD'; field: string; value: unknown }
  | { type: 'APPLY_PRESET'; presetId: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GO_TO_STEP'; step: number }
  | { type: 'ADD_SCHEDULE_DATE'; date: string }
  | { type: 'REMOVE_SCHEDULE_DATE'; date: string }
  | { type: 'SET_RULES_DRAFT'; draft: RulesDraft };

const INDIVIDUAL_SCORING: ScoringRules = { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2, deuceEnabled: true };
const TEAM_SCORING: ScoringRules = { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: true };

const DEFAULT_MATCH_RULES: MatchRules = { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 };

const DEFAULT_TEAM_RULES: TeamRules = {
  teamSize: 3,
  rotationEnabled: true,
  rotationInterval: 6,
  maxReserves: 1,
  genderRatio: { male: 2, female: 1 },
};

/** 기기 현지 날짜 YYYY-MM-DD (toISOString은 UTC라 한국 오전 9시 전에는 어제가 된다) */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function createDefaultState(today: string = localDateString()): WizardState {
  return {
    step: 1,
    name: '',
    date: today,
    endDate: '',
    scheduleDates: [],
    type: 'individual',
    presetId: null,
    tournamentMode: 'direct_tournament',
    participantCount: 8,
    participantNames: [],
    hasGroupStage: false,
    groupCount: 2,
    teamSize: 3,
    qualifyingFormat: 'round_robin',
    qualifyingScoringRules: { ...INDIVIDUAL_SCORING },
    qualifyingMatchRules: { ...DEFAULT_MATCH_RULES },
    advanceCount: 8,
    advancePerGroup: 2,
    hasFinalsStage: true,
    finalsFormat: 'single_elimination',
    finalsStartRound: 8,
    finalsScoringRules: { ...INDIVIDUAL_SCORING },
    finalsMatchRules: { ...DEFAULT_MATCH_RULES },
    sameRulesAsQualifying: true,
    bracketArrangement: 'cross_group',
    avoidSameGroup: true,
    thirdPlaceMatch: true,
    hasRankingMatch: false,
    rankingMatch: { enabled: false, thirdPlace: true, fifthToEighth: false, fifthToEighthFormat: 'simple', classificationGroups: false, classificationGroupSize: 4 },
    fifthToEighth: false,
    fifthToEighthFormat: 'simple',
    classificationGroups: false,
    classificationGroupSize: 4,
    rankingUpTo: 0,
    hasRoundScoringOverride: false,
    roundOverrideFromRound: 4,
    roundOverrideSetsToWin: 3,
    roundOverrideMaxSets: 5,
    customPairings: [],
    scoringRules: { ...INDIVIDUAL_SCORING },
    matchRules: { ...DEFAULT_MATCH_RULES },
    teamRules: { ...DEFAULT_TEAM_RULES },
    formatType: 'single_elimination',
    useCustomRules: false,
    startingRound: 8,
    seedMethod: 'ranking',
    hasThirdPlaceMatch: true,
    rulesDraft: emptyDraft('ibsa'),
    rulesConfirmed: false,
  };
}

// ===== 계산 도우미 =====

export function isTeamWizard(state: Pick<WizardState, 'type'>): boolean {
  return state.type === 'team' || state.type === 'randomTeamLeague';
}

/** 실제 경기 단위 수 (랜덤 팀 리그는 팀 수) */
export function effectiveParticipantCount(state: Pick<WizardState, 'type' | 'participantCount' | 'teamSize'>): number {
  return state.type === 'randomTeamLeague'
    ? Math.floor(state.participantCount / Math.max(1, state.teamSize))
    : state.participantCount;
}

function nextPow2(n: number): number {
  let s = 1;
  while (s < n) s *= 2;
  return s;
}

const START_ROUNDS = [4, 8, 16, 32, 64] as const;

/**
 * 고를 수 있는 본선 시작 라운드.
 * - 조별 예선: 조 진출 인원 이상, 와일드카드로 채울 수 있는 인원(전체 인원) 이하
 * - 바로 본선: 참가 인원이 들어가는 대진 크기 이하
 */
export function validStartRounds(state: Pick<WizardState, 'hasGroupStage' | 'advancePerGroup' | 'groupCount' | 'type' | 'participantCount' | 'teamSize'>): number[] {
  const n = effectiveParticipantCount(state);
  if (state.hasGroupStage) {
    const direct = state.advancePerGroup * state.groupCount;
    const opts = START_ROUNDS.filter(v => v >= direct && v <= Math.max(n, nextPow2(direct)));
    return opts.length > 0 ? [...opts] : [nextPow2(Math.max(2, direct))];
  }
  const max = nextPow2(Math.max(2, n));
  const opts = START_ROUNDS.filter(v => v <= max);
  return opts.length > 0 ? [...opts] : [4];
}

/** 현재 시작 라운드가 고를 수 없는 값이면 가장 가까운 값으로 바꾼다 */
function clampStartRound(state: WizardState): number {
  const opts = validStartRounds(state);
  if (opts.includes(state.finalsStartRound)) return state.finalsStartRound;
  if (state.hasGroupStage) return opts[0];
  return opts.filter(v => v <= state.finalsStartRound).pop() ?? opts[0];
}

/** 라운드별 세트 수를 시작할 수 있는 라운드 (본선 시작 라운드보다 뒤: 4강 = 4, 결승 = 2) */
export function overrideRoundOptions(startRound: number): number[] {
  const out: number[] = [];
  for (let r = Math.floor(startRound / 2); r >= 2; r = Math.floor(r / 2)) out.push(r);
  return out;
}

/** 저장·표시에 쓰는 라운드별 세트 수 시작 라운드 (고를 수 없는 값이면 첫 선택지) */
export function effectiveOverrideFromRound(state: Pick<WizardState, 'finalsStartRound' | 'roundOverrideFromRound'>): number | null {
  const opts = overrideRoundOptions(state.finalsStartRound);
  if (opts.length === 0) return null;
  return opts.includes(state.roundOverrideFromRound) ? state.roundOverrideFromRound : opts[0];
}

export function nearestBracketRoundKey(count: number): string {
  if (count >= 32) return 'admin.tournamentCreate.finals.round32';
  if (count >= 16) return 'admin.tournamentCreate.finals.round16';
  if (count >= 8) return 'admin.tournamentCreate.finals.round8';
  if (count >= 4) return 'admin.tournamentCreate.finals.round4';
  return 'admin.tournamentCreate.finals.final';
}

/** 조별 예선의 와일드카드 수: 본선 시작 라운드 - 조당 진출 × 조 수 (위저드가 보여 주는 값) */
export function wizardWildcardCount(state: Pick<WizardState, 'hasGroupStage' | 'finalsStartRound' | 'advancePerGroup' | 'groupCount'>): number {
  if (!state.hasGroupStage) return 0;
  return calculateWildcard(state.finalsStartRound || 0, state.advancePerGroup, state.groupCount).wildcardCount;
}

function sameScoring(a: ScoringRules, b: ScoringRules): boolean {
  return a.winScore === b.winScore && a.setsToWin === b.setsToWin && a.maxSets === b.maxSets
    && a.minLead === b.minLead && (a.timeLimitSeconds ?? 0) === (b.timeLimitSeconds ?? 0);
}

function buildRankingMatch(next: WizardState): RankingMatchConfig {
  return {
    enabled: next.hasRankingMatch,
    thirdPlace: next.thirdPlaceMatch,
    fifthToEighth: next.fifthToEighth,
    fifthToEighthFormat: next.fifthToEighthFormat,
    classificationGroups: next.classificationGroups,
    classificationGroupSize: next.classificationGroupSize,
  };
}

/**
 * 앞 단계의 설정 → 같은 값을 정하는 규칙 경로. 앞 단계에서 이 설정을 다시 바꾸면 규칙 단계의 편집을 지워
 * 마지막으로 고른 값이 저장되게 한다(앞 단계 값이 화면에 보이는데 무시되는 일이 없게).
 */
const FIELD_RULE_PATHS: Record<string, readonly string[]> = {
  type: ['scoring', 'roundScoring'],
  qualifyingScoringRules: ['scoring'],
  finalsScoringRules: ['scoring'],
  thirdPlaceMatch: ['finalRanking.thirdPlace'],
  rankingUpTo: ['finalRanking.rankingUpTo'],
  hasRankingMatch: ['finalRanking.rankingUpTo', 'finalRanking.placementMatches', 'finalRanking.fifthToEighth'],
  fifthToEighth: ['finalRanking.placementMatches', 'finalRanking.fifthToEighth'],
  classificationGroups: ['finalRanking.placementMatches', 'finalRanking.fifthToEighth'],
  advancePerGroup: ['qualification.perGroup', 'qualification.wildcards'],
  groupCount: ['qualification.perGroup', 'qualification.wildcards'],
  finalsStartRound: ['qualification.wildcards'],
  tournamentMode: ['qualification.perGroup', 'qualification.wildcards'],
  avoidSameGroup: ['qualification.avoidSameGroupFirstRound'],
  hasRoundScoringOverride: ['roundScoring'],
  roundOverrideFromRound: ['roundScoring'],
  roundOverrideSetsToWin: ['roundScoring'],
};

// ===== 리듀서 =====

export function wizardReducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'SET_FIELD': {
      const next = { ...state, [action.field]: action.value } as WizardState;
      const clearPaths = FIELD_RULE_PATHS[action.field];
      if (clearPaths) {
        next.rulesDraft = clearDraftPaths(next.rulesDraft, clearPaths);
        // 경기 규칙에 영향을 주는 설정을 바꿨으니 규칙을 다시 확인해야 한다
        next.rulesConfirmed = false;
      }
      if (action.field === 'tournamentMode') {
        const mode = action.value as WizardState['tournamentMode'];
        if (mode === 'full_league_all') {
          next.hasGroupStage = false;
          next.hasFinalsStage = false;
          next.formatType = 'round_robin';
          next.finalsFormat = 'round_robin';
        } else if (mode === 'group_tournament') {
          next.hasGroupStage = true;
          next.hasFinalsStage = true;
          next.qualifyingFormat = next.groupCount > 1 ? 'group_round_robin' : 'round_robin';
          // 조별 예선 뒤 본선 리그는 아직 생성기가 없다: 토너먼트로 둔다
          if (next.finalsFormat !== 'single_elimination') next.finalsFormat = 'single_elimination';
          next.formatType = 'single_elimination';
        } else if (mode === 'direct_tournament') {
          next.hasGroupStage = false;
          next.hasFinalsStage = true;
          if (next.finalsFormat !== 'single_elimination') next.finalsFormat = 'single_elimination';
          next.formatType = 'single_elimination';
        } else if (mode === 'manual') {
          next.hasGroupStage = false;
          next.hasFinalsStage = false;
          next.formatType = 'manual';
        }
      }
      if (action.field === 'hasGroupStage') {
        if (next.tournamentMode !== 'manual') {
          next.hasFinalsStage = action.value as boolean;
        }
        next.qualifyingFormat = next.groupCount > 1 ? 'group_round_robin' : 'round_robin';
      }
      if (action.field === 'groupCount') {
        next.qualifyingFormat = (action.value as number) > 1 ? 'group_round_robin' : 'round_robin';
      }
      if (action.field === 'thirdPlaceMatch') {
        next.hasThirdPlaceMatch = next.thirdPlaceMatch;
      }
      if (action.field === 'type') {
        const t = action.value as TournamentType;
        const base = t === 'team' || t === 'randomTeamLeague' ? TEAM_SCORING : INDIVIDUAL_SCORING;
        next.qualifyingScoringRules = { ...base };
        next.finalsScoringRules = { ...base };
        next.scoringRules = { ...base };
        if (t === 'randomTeamLeague') next.teamSize = 3;
        next.presetId = null;
      }
      if (action.field === 'teamSize') {
        // 성별 비율이 팀 인원을 넘지 않게 맞춘다 (여자 = 팀 인원 - 남자)
        const size = action.value as number;
        const male = Math.min(size, next.teamRules.genderRatio?.male ?? Math.ceil(size / 2));
        next.teamRules = { ...next.teamRules, teamSize: size, genderRatio: { male, female: size - male } };
      }
      if (action.field === 'teamRules') {
        next.teamRules = { ...next.teamRules, teamSize: next.teamSize };
      }
      if (action.field === 'finalsFormat') {
        if (next.tournamentMode !== 'manual') {
          next.formatType = action.value as BracketFormatType;
        }
        // 예선 없는 리그 = 풀리그 하나(본선 스테이지 없음)
        next.hasFinalsStage = !(action.value === 'round_robin' && !next.hasGroupStage);
      }
      if (action.field === 'qualifyingScoringRules' && state.sameRulesAsQualifying) {
        // "본선도 같은 규칙"이면 본선을 따라 바꾼다
        next.finalsScoringRules = { ...(action.value as ScoringRules) };
      }
      // 두 점수 규칙이 같은지 다시 판단한다 (본선만 바꾸면 '다름'이 된다: B15 결승 best-of 폐기)
      next.sameRulesAsQualifying = sameScoring(next.qualifyingScoringRules, next.finalsScoringRules);

      // 조 진출 인원과 본선 시작 라운드
      if (next.hasGroupStage && next.tournamentMode === 'manual' && next.hasFinalsStage) {
        next.finalsStartRound = Math.max(4, nextPow2(next.advancePerGroup * next.groupCount));
      }
      if (next.hasFinalsStage) next.finalsStartRound = clampStartRound(next);
      next.startingRound = next.finalsStartRound;
      next.advanceCount = next.hasGroupStage
        ? next.advancePerGroup * next.groupCount + wizardWildcardCount(next)
        : effectiveParticipantCount(next);
      next.rankingMatch = buildRankingMatch(next);
      return next;
    }
    case 'APPLY_PRESET': {
      const preset = WIZARD_PRESETS.find(p => p.id === action.presetId);
      if (!preset) return state;
      const hasGroup = preset.hasQualifying ?? false;
      const hasFinals = preset.hasFinalsStage ?? hasGroup;
      const groupCount = preset.qualifyingConfig?.groupCount ?? state.groupCount;
      const startRound = preset.finalsConfig?.startingRound ?? state.finalsStartRound;
      const thirdPlace = preset.rankingMatch?.thirdPlace ?? state.thirdPlaceMatch;
      const next: WizardState = {
        ...state,
        presetId: action.presetId,
        type: preset.type,
        tournamentMode: hasGroup ? 'group_tournament' : hasFinals ? 'direct_tournament' : 'full_league_all',
        qualifyingScoringRules: { ...preset.scoringRules },
        finalsScoringRules: { ...preset.scoringRules },
        scoringRules: { ...preset.scoringRules },
        sameRulesAsQualifying: true,
        hasGroupStage: hasGroup,
        hasFinalsStage: hasFinals,
        groupCount,
        qualifyingFormat: groupCount > 1 ? 'group_round_robin' : 'round_robin',
        finalsFormat: hasFinals ? 'single_elimination' : 'round_robin',
        finalsStartRound: startRound,
        seedMethod: (preset.finalsConfig?.seedMethod as WizardState['seedMethod']) ?? 'ranking',
        thirdPlaceMatch: thirdPlace,
        hasThirdPlaceMatch: thirdPlace,
        hasRankingMatch: preset.rankingMatch?.enabled ?? false,
        fifthToEighth: preset.rankingMatch?.fifthToEighth ?? false,
        fifthToEighthFormat: preset.rankingMatch?.fifthToEighthFormat ?? 'simple',
        classificationGroups: preset.rankingMatch?.classificationGroups ?? false,
        classificationGroupSize: preset.rankingMatch?.classificationGroupSize ?? 4,
        teamSize: preset.teamRules?.teamSize ?? state.teamSize,
        teamRules: { ...state.teamRules, ...(preset.teamRules ?? {}) },
        formatType: preset.formatType,
      };
      if (next.hasFinalsStage) next.finalsStartRound = clampStartRound(next);
      next.startingRound = next.finalsStartRound;
      next.advanceCount = next.hasGroupStage
        ? next.advancePerGroup * next.groupCount + wizardWildcardCount(next)
        : effectiveParticipantCount(next);
      next.rankingMatch = buildRankingMatch(next);
      return next;
    }
    case 'NEXT_STEP': {
      let step = Math.min(WIZARD_TOTAL_STEPS, state.step + 1);
      // 풀리그·수동 모드는 형식 단계가 없다
      if (state.step === WIZARD_STEP.participants && step === WIZARD_STEP.format && skipsFormatStep(state)) step = WIZARD_STEP.rules;
      return { ...state, step };
    }
    case 'PREV_STEP': {
      let step = Math.max(1, state.step - 1);
      if (state.step === WIZARD_STEP.rules && step === WIZARD_STEP.format && skipsFormatStep(state)) step = WIZARD_STEP.participants;
      return { ...state, step };
    }
    case 'GO_TO_STEP':
      return { ...state, step: Math.max(1, Math.min(WIZARD_TOTAL_STEPS, action.step)) };
    case 'ADD_SCHEDULE_DATE': {
      if (state.scheduleDates.includes(action.date)) return state;
      return { ...state, scheduleDates: [...state.scheduleDates, action.date].sort() };
    }
    case 'REMOVE_SCHEDULE_DATE':
      return { ...state, scheduleDates: state.scheduleDates.filter(d => d !== action.date) };
    case 'SET_RULES_DRAFT':
      // 규칙을 바꾸면 다시 확인해야 한다
      return { ...state, rulesDraft: action.draft, rulesConfirmed: false };
    default:
      return state;
  }
}

export function skipsFormatStep(state: Pick<WizardState, 'tournamentMode'>): boolean {
  return state.tournamentMode === 'full_league_all' || state.tournamentMode === 'manual';
}

// ===== 저장 문서 =====

export type NewTournament = Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'>;

export interface BuildOptions {
  now?: number;
  /** 스테이지 ID (기본: stage_{type}_{now}). 마법사의 규칙 편집기는 WIZARD_STAGE_KEYS를 쓴다. */
  stageIds?: Partial<Record<StageType, string>>;
  /** false면 경기 규칙 단계의 초안을 넣지 않는다 (규칙 편집기의 바탕 문서) */
  includeRules?: boolean;
}

function stripUndefinedDeep<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 모든 스테이지 ID를 저장 ID로 바꾼 규칙 초안 */
function draftForStages(draft: RulesDraft, stages: TournamentStage[]): RulesDraft {
  const out: RulesDraft = { tournament: draft.tournament, stages: {} };
  for (const s of stages) {
    const key = s.type ? WIZARD_STAGE_KEYS[s.type] : undefined;
    const layer = key ? draft.stages[key] : undefined;
    if (layer && Object.keys(layer).length > 0) out.stages[s.id] = layer;
  }
  return out;
}

/**
 * 마법사 상태 → 저장할 대회 문서. 미리보기와 저장이 모두 이 함수를 쓴다.
 */
export function buildTournamentFromWizard(state: WizardState, opts: BuildOptions = {}): NewTournament {
  const now = opts.now ?? Date.now();
  const includeRules = opts.includeRules !== false;
  const isTeam = isTeamWizard(state);
  const manualNoStages = state.tournamentMode === 'manual' && !state.hasGroupStage && !state.hasFinalsStage;
  const hasGroup = !manualNoStages && state.hasGroupStage;
  const hasFinals = !manualNoStages && state.hasFinalsStage;

  // 대회 전체 점수 규칙: 예선이 있으면 예선, 바로 본선이면 본선, 리그만 있으면 예선(=리그) 규칙
  const qual = state.qualifyingScoringRules;
  const finals = state.finalsScoringRules;
  const primary = hasGroup ? qual : hasFinals ? finals : qual;

  // 순위결정전: 형식 단계의 '순위결정전' 스위치가 꺼져 있으면 숨은 하위 설정도 끈다 (수동 모드는 스위치 없이 바로 설정)
  const rankingOn = state.tournamentMode === 'manual' || state.hasRankingMatch;
  const classificationGroups = rankingOn && state.classificationGroups;
  const stateRankingUpTo = rankingOn ? Math.max(0, state.rankingUpTo || 0) : 0;
  const stateWildcards = wizardWildcardCount({ ...state, hasGroupStage: hasGroup });

  // 경기 규칙 단계의 값 중 대회 구조(진출 인원, 3/4위전·5~8위 결정전, 순위 표시 범위)를 바꾸는 값은
  // 스테이지를 만들기 전에 읽는다. 읽는 스테이지는 경기 생성과 같다: 진출 인원·와일드카드는 예선,
  // 같은 조 회피·3/4위전은 본선, 순위결정전 결과 사용·순위 표시 범위는 대회 전체 규칙.
  const draftIn = includeRules ? state.rulesDraft : emptyDraft();
  const structureDoc = {
    type: state.type,
    rules: draftIn.tournament,
    rankingMatchConfig: {
      thirdPlace: hasFinals && state.thirdPlaceMatch,
      fifthToEighth: rankingOn && state.fifthToEighth,
      ...(stateRankingUpTo > 0 ? { rankingUpTo: stateRankingUpTo } : {}),
    },
    ...(hasFinals ? {
      finalsConfig: {
        ...(hasGroup ? { advancePerGroup: state.advancePerGroup } : {}),
        ...(stateWildcards > 0 ? { wildcardCount: stateWildcards } : {}),
        avoidSameGroup: hasGroup ? state.avoidSameGroup : false,
      },
    } : {}),
    stages: (['qualifying', 'finals'] as const).map(type => ({ id: WIZARD_STAGE_KEYS[type], type, rules: draftIn.stages[WIZARD_STAGE_KEYS[type]] })),
  };
  const tournamentRules = resolveCompetitionRules(structureDoc);
  const qualRules = resolveCompetitionRules(structureDoc, WIZARD_STAGE_KEYS.qualifying);
  const finalsRules = resolveCompetitionRules(structureDoc, WIZARD_STAGE_KEYS.finals);

  // 5~8위 결정전: 규칙에서 순위결정전 결과를 쓰지 않기로 했으면(예: '간단' 프리셋) 경기를 만들지 않는다
  const fifthToEighth = rankingOn && state.fifthToEighth && tournamentRules.finalRanking.placementMatches;
  const rankingUpTo = tournamentRules.finalRanking.rankingUpTo;
  const rankingMatch: RankingMatchConfig = {
    enabled: fifthToEighth || classificationGroups || rankingUpTo > 0,
    thirdPlace: hasFinals && finalsRules.finalRanking.thirdPlace === 'match',
    fifthToEighth,
    fifthToEighthFormat: state.fifthToEighthFormat,
    classificationGroups,
    classificationGroupSize: state.classificationGroupSize,
    ...(rankingUpTo > 0 ? { rankingUpTo } : {}),
  };

  const perGroup = hasGroup ? qualRules.qualification.perGroup : state.advancePerGroup;
  const wildcards = hasGroup ? qualRules.qualification.wildcards : 0;
  const directAdvance = hasGroup ? perGroup * state.groupCount : effectiveParticipantCount(state);
  const advanceCount = hasGroup ? directAdvance + wildcards : directAdvance;
  // 진출 인원이 시작 라운드보다 많아지면(규칙 단계에서 조당 진출을 늘린 경우) 대진을 키운다
  const startingRound = hasGroup && state.finalsStartRound < advanceCount ? Math.max(4, nextPow2(advanceCount)) : state.finalsStartRound;

  // 예선·본선 규칙이 대회 전체와 같으면 스테이지에 따로 적지 않는다(규칙 편집기에서 대회 값이 그대로 적용되게)
  const stageScoring = (r: ScoringRules) => (sameScoring(r, primary) ? null : r);
  const stages = manualNoStages ? [] : buildStagesFromWizard({
    hasGroupStage: hasGroup,
    groupCount: state.groupCount,
    qualifyingFormat: state.qualifyingFormat,
    qualifyingScoringRules: hasGroup ? stageScoring(qual) : null,
    qualifyingMatchRules: state.qualifyingMatchRules,
    hasFinalsStage: hasFinals,
    advanceCount,
    finalsScoringRules: hasFinals ? stageScoring(finals) : null,
    finalsMatchRules: state.finalsMatchRules,
    rankingMatch,
    now,
    stageIds: opts.stageIds,
  });

  const overrideFrom = hasFinals && state.hasRoundScoringOverride ? effectiveOverrideFromRound(state) : null;

  const doc: NewTournament = {
    name: state.name.trim(),
    date: state.date,
    ...(state.endDate ? { endDate: state.endDate } : {}),
    ...(state.scheduleDates.length > 0 ? { scheduleDates: state.scheduleDates } : {}),
    type: state.type,
    format: mapToLegacyFormat(hasGroup, hasFinals),
    status: 'draft',
    gameConfig: { winScore: primary.winScore, setsToWin: primary.setsToWin },
    ...(isTeam ? {
      teamMatchSettings: { winScore: primary.winScore, setsToWin: primary.setsToWin, minLead: primary.minLead },
      teamRules: {
        teamSize: state.teamSize,
        maxReserves: state.teamRules.maxReserves ?? 1,
        genderRatio: state.teamRules.genderRatio ?? { male: Math.ceil(state.teamSize / 2), female: Math.floor(state.teamSize / 2) },
        rotationEnabled: state.teamRules.rotationEnabled,
        ...(state.teamRules.rotationInterval !== undefined ? { rotationInterval: state.teamRules.rotationInterval } : {}),
      },
    } : {}),
    formatType: manualNoStages || state.tournamentMode === 'manual'
      ? 'manual'
      : hasGroup ? 'group_knockout' : hasFinals ? 'single_elimination' : 'round_robin',
    scoringRules: { ...primary },
    matchRules: hasGroup || !hasFinals ? state.qualifyingMatchRules : state.finalsMatchRules,
    ...(stages.length > 0 ? { stages } : {}),
    ...(hasGroup ? {
      qualifyingConfig: { format: state.qualifyingFormat, groupCount: state.groupCount, scoringRules: { ...qual } },
    } : {}),
    ...(hasFinals ? {
      finalsConfig: {
        format: 'single_elimination' as const,
        advanceCount,
        startingRound,
        seedMethod: state.tournamentMode === 'manual' ? 'manual' as const : (state.bracketArrangement === 'custom' ? 'custom' as const : state.seedMethod),
        ...(hasGroup ? { advancePerGroup: perGroup } : {}),
        // 와일드카드는 명시적일 때만 쓴다(자동 추가 없음): 위저드가 보여 준 값(본선 시작 라운드 - 조당 진출 × 조 수)
        // 또는 규칙 단계에서 예선에 정한 값
        ...(wildcards > 0 ? { wildcardCount: wildcards } : {}),
        avoidSameGroup: hasGroup ? finalsRules.qualification.avoidSameGroupFirstRound : false,
        bracketArrangement: state.bracketArrangement,
        scoringRules: { ...finals },
        ...(overrideFrom ? {
          roundScoringOverride: {
            fromRound: overrideFrom,
            scoringRules: { ...finals, setsToWin: state.roundOverrideSetsToWin, maxSets: state.roundOverrideSetsToWin * 2 - 1 },
          },
        } : {}),
        ...(state.bracketArrangement === 'custom' && state.customPairings.length > 0 ? { customBracketPairings: state.customPairings } : {}),
      },
    } : {}),
    rankingMatchConfig: rankingMatch,
  };

  if (!includeRules) return stripUndefinedDeep(doc);

  // 경기 규칙 단계의 초안을 얹고, 겹치는 레거시 필드(점수 규칙 등)를 유효 값으로 맞춘다 (대회 상세 '경기 규칙' 탭과 같은 함수)
  const draft = draftForStages(state.rulesDraft, stages);
  const withRules = stripUndefinedDeep(withDraft(doc as NewTournament & { stages?: TournamentStage[] }, draft) as NewTournament);
  for (const [path, value] of Object.entries(legacyRuleFields(withRules))) assignPath(withRules, path.split('/'), value);
  return withRules;
}

/** 경로에 값을 쓴다 (null = 삭제). 배열(stages)은 인덱스로 찾아간다. 새로 복제한 문서에만 쓴다. */
function assignPath(target: unknown, keys: string[], value: unknown): void {
  let cur = target as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) {
    const next = cur[k];
    if (!next || typeof next !== 'object') {
      if (value === null) return;
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === null) delete cur[last];
  else cur[last] = value;
}
