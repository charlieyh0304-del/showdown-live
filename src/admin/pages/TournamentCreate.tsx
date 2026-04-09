import { useState, useCallback, useReducer, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTournaments } from '@shared/hooks/useFirebase';
import { WIZARD_PRESETS } from '@shared/constants/presets';
import { buildStagesFromWizard, mapToLegacyFormat } from '@shared/utils/tournament';
import type { TournamentType, BracketFormatType, ScoringRules, MatchRules, TeamRules, TiebreakerRule, RankingMatchConfig } from '@shared/types';
import StepIndicator from '../components/tournament-create/StepIndicator';
import WizardStep4Finals from '../components/tournament-create/WizardStep4Finals';
import WizardStep5Preview from '../components/tournament-create/WizardStep5Preview';
import Step1BasicInfo from '../components/tournament-create/Step1BasicInfo';
import Step2Participants from '../components/tournament-create/Step2Participants';

// ===== Wizard State =====

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
  useTopSeed: boolean;
  seedCount: number;
  teamSize: number;
  // Step 3 (예선)
  qualifyingFormat: 'round_robin' | 'group_round_robin';
  qualifyingScoringRules: ScoringRules;
  qualifyingMatchRules: MatchRules;
  advanceCount: number;
  advancePerGroup: number;
  wildcardCount: number;
  tiebreakerRules: TiebreakerRule[];
  // Step 4 (본선)
  hasFinalsStage: boolean;
  finalsFormat: 'single_elimination' | 'double_elimination' | 'round_robin';
  finalsStartRound: number;
  finalsScoringRules: ScoringRules;
  finalsMatchRules: MatchRules;
  sameRulesAsQualifying: boolean;
  bracketArrangement: 'cross_group' | 'sequential' | 'custom';
  avoidSameGroup: boolean;
  thirdPlaceMatch: boolean;
  hasRankingMatch: boolean;
  rankingStartRank: number;
  rankingEndRank: number;
  rankingFormat: 'round_robin' | 'single_elimination';
  rankingMatch: RankingMatchConfig;
  // 순위결정전 (top-level로 분리)
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
  // Common
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules: TeamRules;
  formatType: BracketFormatType;
  useCustomRules: boolean;
  startingRound: number;
  seedMethod: 'ranking' | 'manual' | 'custom';
  hasThirdPlaceMatch: boolean;
}

export type Action =
  | { type: 'SET_FIELD'; field: string; value: unknown }
  | { type: 'APPLY_PRESET'; presetId: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GO_TO_STEP'; step: number }
  | { type: 'ADD_SCHEDULE_DATE'; date: string }
  | { type: 'REMOVE_SCHEDULE_DATE'; date: string };

const DEFAULT_SCORING: ScoringRules = {
  winScore: 11,
  setsToWin: 2,
  maxSets: 3,
  minLead: 2,
  deuceEnabled: true,
};

const DEFAULT_MATCH_RULES: MatchRules = {
  timeoutsPerPlayer: 1,
  timeoutDurationSeconds: 60,
};

const DEFAULT_TEAM_RULES: TeamRules = {
  teamSize: 3,
  rotationEnabled: true,
  rotationInterval: 6,
  maxReserves: 1,
  genderRatio: { male: 2, female: 1 },
};

const defaultState: WizardState = {
  step: 1,
  name: '',
  date: new Date().toISOString().split('T')[0],
  endDate: '',
  scheduleDates: [],
  type: 'individual',
  presetId: null,
  tournamentMode: 'direct_tournament',
  participantCount: 8,
  participantNames: [],
  hasGroupStage: false,
  groupCount: 2,
  useTopSeed: false,
  seedCount: 4,
  teamSize: 3,
  qualifyingFormat: 'round_robin',
  qualifyingScoringRules: { ...DEFAULT_SCORING },
  qualifyingMatchRules: { ...DEFAULT_MATCH_RULES },
  advanceCount: 8,
  advancePerGroup: 2,
  wildcardCount: 0,
  tiebreakerRules: ['head_to_head', 'set_difference', 'point_difference', 'points_for'],
  hasFinalsStage: false,
  finalsFormat: 'single_elimination',
  finalsStartRound: 8,
  finalsScoringRules: { ...DEFAULT_SCORING },
  finalsMatchRules: { ...DEFAULT_MATCH_RULES },
  sameRulesAsQualifying: true,
  bracketArrangement: 'cross_group',
  avoidSameGroup: true,
  thirdPlaceMatch: true,
  hasRankingMatch: false,
  rankingStartRank: 5,
  rankingEndRank: 8,
  rankingFormat: 'single_elimination',
  rankingMatch: { enabled: false, thirdPlace: true, fifthToEighth: false, fifthToEighthFormat: 'simple' as const, classificationGroups: false, classificationGroupSize: 4 },
  fifthToEighth: false,
  fifthToEighthFormat: 'simple' as const,
  classificationGroups: false,
  classificationGroupSize: 4,
  rankingUpTo: 0,
  hasRoundScoringOverride: false,
  roundOverrideFromRound: 4,
  roundOverrideSetsToWin: 3,
  roundOverrideMaxSets: 5,
  customPairings: [],
  scoringRules: { ...DEFAULT_SCORING },
  matchRules: { ...DEFAULT_MATCH_RULES },
  teamRules: { ...DEFAULT_TEAM_RULES },
  formatType: 'round_robin',
  useCustomRules: false,
  startingRound: 8,
  seedMethod: 'ranking',
  hasThirdPlaceMatch: true,
};

function getNextStep(current: number, _hasGroupStage: boolean): number {
  return Math.min(4, current + 1);
}

function getPrevStep(current: number, _hasGroupStage: boolean): number {
  return Math.max(1, current - 1);
}

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'SET_FIELD': {
      const next = { ...state, [action.field]: action.value };
      // Sync derived fields for tournamentMode
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
        } else if (mode === 'direct_tournament') {
          next.hasGroupStage = false;
          next.hasFinalsStage = true;
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
        if (action.value && next.tournamentMode === 'manual') {
          next.advanceCount = next.advancePerGroup * next.groupCount;
        }
      }
      if (action.field === 'groupCount') {
        next.qualifyingFormat = (action.value as number) > 1 ? 'group_round_robin' : 'round_robin';
        next.advanceCount = next.advancePerGroup * (action.value as number);
      }
      if (action.field === 'advancePerGroup') {
        next.advanceCount = (action.value as number) * next.groupCount;
      }
      if (action.field === 'thirdPlaceMatch') {
        next.hasThirdPlaceMatch = next.thirdPlaceMatch;
      }
      if (action.field === 'type') {
        const t = action.value as TournamentType;
        if (t === 'team' || t === 'randomTeamLeague') {
          next.qualifyingScoringRules = { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: true };
          next.finalsScoringRules = { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: true };
          next.teamSize = t === 'randomTeamLeague' ? 3 : next.teamSize;
        } else {
          next.qualifyingScoringRules = { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2, deuceEnabled: true };
          next.finalsScoringRules = { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2, deuceEnabled: true };
        }
        next.presetId = null;
      }
      if (action.field === 'finalsFormat') {
        if (next.tournamentMode !== 'manual') {
          next.formatType = action.value as BracketFormatType;
        }
        // round_robin without group stage = simple full league, no finals stage needed
        if (action.value === 'round_robin' && !next.hasGroupStage) {
          next.hasFinalsStage = false;
        } else {
          next.hasFinalsStage = true;
        }
      }
      if (action.field === 'finalsStartRound') {
        next.startingRound = action.value as number;
      }
      // manual 모드: 본선 시작 라운드 자동 계산
      if (next.tournamentMode === 'manual' && next.hasFinalsStage && next.hasGroupStage) {
        let sr = 4;
        while (sr < next.advanceCount) sr *= 2;
        next.finalsStartRound = sr;
        next.startingRound = sr;
      }
      // rankingMatch 조립 (항상 실행)
      next.rankingMatch = {
        enabled: next.hasRankingMatch,
        thirdPlace: next.thirdPlaceMatch,
        fifthToEighth: next.fifthToEighth,
        fifthToEighthFormat: next.fifthToEighthFormat,
        classificationGroups: next.classificationGroups,
        classificationGroupSize: next.classificationGroupSize,
      };
      return next;
    }
    case 'APPLY_PRESET': {
      const preset = WIZARD_PRESETS.find(p => p.id === action.presetId);
      if (!preset) return state;
      const hasGroup = preset.hasQualifying ?? false;
      const groupCount = preset.qualifyingConfig?.groupCount ?? state.groupCount;
      const advanceCount = preset.finalsConfig?.advanceCount ?? state.advanceCount;
      const startRound = preset.finalsConfig?.startingRound ?? state.finalsStartRound;
      const thirdPlace = preset.rankingMatch?.thirdPlace ?? state.thirdPlaceMatch;
      const rankingEnabled = preset.rankingMatch?.enabled ?? false;
      return {
        ...state,
        presetId: action.presetId,
        type: preset.type,
        qualifyingScoringRules: { ...preset.scoringRules },
        finalsScoringRules: { ...preset.scoringRules },
        scoringRules: { ...preset.scoringRules },
        hasGroupStage: hasGroup,
        hasFinalsStage: preset.hasFinalsStage ?? hasGroup,
        groupCount,
        qualifyingFormat: groupCount > 1 ? 'group_round_robin' : 'round_robin',
        advanceCount,
        finalsFormat: preset.formatType === 'round_robin' && !hasGroup ? 'round_robin' : (preset.hasFinalsStage ? (preset.finalsConfig?.format ?? 'single_elimination') : state.finalsFormat),
        finalsStartRound: startRound,
        startingRound: startRound,
        seedMethod: (preset.finalsConfig?.seedMethod as 'ranking' | 'manual' | 'custom') ?? 'ranking',
        thirdPlaceMatch: thirdPlace,
        hasThirdPlaceMatch: thirdPlace,
        hasRankingMatch: rankingEnabled,
        fifthToEighth: preset.rankingMatch?.fifthToEighth ?? false,
        fifthToEighthFormat: preset.rankingMatch?.fifthToEighthFormat ?? 'simple',
        classificationGroups: preset.rankingMatch?.classificationGroups ?? false,
        classificationGroupSize: preset.rankingMatch?.classificationGroupSize ?? 4,
        rankingMatch: {
          enabled: rankingEnabled,
          thirdPlace,
          fifthToEighth: preset.rankingMatch?.fifthToEighth ?? false,
          fifthToEighthFormat: preset.rankingMatch?.fifthToEighthFormat ?? 'simple',
          classificationGroups: preset.rankingMatch?.classificationGroups ?? false,
          classificationGroupSize: preset.rankingMatch?.classificationGroupSize ?? 4,
        },
        teamSize: preset.teamRules?.teamSize ?? state.teamSize,
        teamRules: preset.teamRules ?? state.teamRules,
        formatType: preset.formatType,
      };
    }
    case 'NEXT_STEP': {
      const nextStep = getNextStep(state.step, state.hasGroupStage);
      const next = { ...state, step: nextStep };
      // Skip step 3 for full league all mode (no format selection needed)
      if (state.step === 2 && nextStep === 3 && (state.tournamentMode === 'full_league_all' || state.tournamentMode === 'manual')) {
        next.step = 4;
      }
      return next;
    }
    case 'PREV_STEP': {
      const prevStep = getPrevStep(state.step, state.hasGroupStage);
      const next = { ...state, step: prevStep };
      if (state.step === 4 && prevStep === 3 && (state.tournamentMode === 'full_league_all' || state.tournamentMode === 'manual')) {
        next.step = 2;
      }
      return next;
    }
    case 'GO_TO_STEP':
      return { ...state, step: Math.max(1, Math.min(4, action.step)) };
    case 'ADD_SCHEDULE_DATE': {
      if (state.scheduleDates.includes(action.date)) return state;
      return { ...state, scheduleDates: [...state.scheduleDates, action.date].sort() };
    }
    case 'REMOVE_SCHEDULE_DATE':
      return { ...state, scheduleDates: state.scheduleDates.filter(d => d !== action.date) };
    default:
      return state;
  }
}

export function nearestBracketRoundKey(count: number): string {
  if (count >= 32) return 'admin.tournamentCreate.finals.round32';
  if (count >= 16) return 'admin.tournamentCreate.finals.round16';
  if (count >= 8) return 'admin.tournamentCreate.finals.round8';
  if (count >= 4) return 'admin.tournamentCreate.finals.round4';
  return 'admin.tournamentCreate.finals.final';
}

// ===== Component =====

export default function TournamentCreate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addTournament } = useTournaments();
  const [state, dispatch] = useReducer(reducer, defaultState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const stepLabels = [t('admin.tournamentCreate.stepLabels.basicInfo'), t('admin.tournamentCreate.stepLabels.participants'), t('admin.tournamentCreate.stepLabels.format'), t('admin.tournamentCreate.stepLabels.preview')];
  const stepRef = useRef<HTMLDivElement>(null);

  const validateStep = useCallback((step: number): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (step === 1) {
      if (!state.name.trim()) {
        errors.name = t('admin.tournamentCreate.basicInfo.tournamentNameRequired');
      }
    }
    return errors;
  }, [state]);

  const tryAdvanceStep = useCallback((targetAction: Action) => {
    const errors = validateStep(state.step);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstErrorField = Object.keys(errors)[0];
      const el = document.getElementById(firstErrorField);
      el?.focus();
      return;
    }
    setFieldErrors({});
    dispatch(targetAction);
  }, [state.step, validateStep]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    stepRef.current?.focus();
  }, [state.step]);

  const handleSubmit = useCallback(async () => {
    if (!state.name.trim()) {
      setError(t('admin.tournamentCreate.basicInfo.tournamentNameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const isTeam = state.type === 'team' || state.type === 'randomTeamLeague';

      // 완전 수동 모드 (스테이지 없음): 참가자만 등록, 대진표/스케줄 없음
      if (state.tournamentMode === 'manual' && !state.hasGroupStage && !state.hasFinalsStage) {
        const id = await addTournament({
          name: state.name.trim(),
          date: state.date,
          ...(state.endDate ? { endDate: state.endDate } : {}),
          ...(state.scheduleDates.length > 0 ? { scheduleDates: state.scheduleDates } : {}),
          type: state.type,
          format: 'full_league',
          status: 'draft',
          gameConfig: {
            winScore: state.qualifyingScoringRules.winScore,
            setsToWin: state.qualifyingScoringRules.setsToWin,
          },
          ...(isTeam ? {
            teamMatchSettings: {
              winScore: state.qualifyingScoringRules.winScore,
              setsToWin: state.qualifyingScoringRules.setsToWin,
              minLead: state.qualifyingScoringRules.minLead,
            },
            teamRules: {
              teamSize: state.teamSize,
              rotationEnabled: state.teamRules.rotationEnabled,
              rotationInterval: state.teamRules.rotationInterval,
              genderRatio: state.teamRules.genderRatio,
            },
          } : {}),
          formatType: 'manual',
          scoringRules: state.qualifyingScoringRules,
          matchRules: state.qualifyingMatchRules,
        });
        if (id) navigate(`/admin/tournament/${id}`);
        return;
      }

      const hasFinalsStage = state.hasFinalsStage;

      const stages = buildStagesFromWizard({
        hasGroupStage: state.hasGroupStage,
        groupCount: state.groupCount,
        qualifyingFormat: state.qualifyingFormat,
        qualifyingScoringRules: state.qualifyingScoringRules,
        qualifyingMatchRules: state.qualifyingMatchRules,
        hasFinalsStage,
        advanceCount: state.advanceCount,
        finalsScoringRules: state.sameRulesAsQualifying ? state.qualifyingScoringRules : state.finalsScoringRules,
        finalsMatchRules: state.finalsMatchRules,
        rankingMatch: state.rankingMatch,
      });

      const legacyFormat = mapToLegacyFormat(state.hasGroupStage, hasFinalsStage);

      const id = await addTournament({
        name: state.name.trim(),
        date: state.date,
        ...(state.endDate ? { endDate: state.endDate } : {}),
        ...(state.scheduleDates.length > 0 ? { scheduleDates: state.scheduleDates } : {}),
        type: state.type,
        format: legacyFormat,
        status: 'draft',
        gameConfig: {
          winScore: state.qualifyingScoringRules.winScore,
          setsToWin: state.qualifyingScoringRules.setsToWin,
        },
        ...(isTeam ? {
          teamMatchSettings: {
            winScore: state.qualifyingScoringRules.winScore,
            setsToWin: state.qualifyingScoringRules.setsToWin,
            minLead: state.qualifyingScoringRules.minLead,
          },
          teamRules: {
            teamSize: state.teamSize,
            maxReserves: state.teamRules.maxReserves,
            genderRatio: state.teamRules.genderRatio,
            rotationEnabled: state.teamRules.rotationEnabled,
            rotationInterval: state.teamRules.rotationInterval,
          },
        } : {}),
        formatType: state.tournamentMode === 'manual' ? 'manual' : (state.hasGroupStage ? 'group_knockout' : state.formatType),
        scoringRules: state.qualifyingScoringRules,
        matchRules: state.qualifyingMatchRules,
        ...(stages.length > 0 ? { stages } : {}),
        ...(state.hasGroupStage ? {
          qualifyingConfig: {
            format: state.qualifyingFormat,
            groupCount: state.groupCount,
            scoringRules: state.qualifyingScoringRules,
          },
        } : {}),
        ...(hasFinalsStage ? {
          finalsConfig: {
            format: state.finalsFormat as 'single_elimination' | 'double_elimination',
            advanceCount: state.advanceCount,
            startingRound: state.finalsStartRound,
            seedMethod: state.tournamentMode === 'manual' ? 'manual' : (state.bracketArrangement === 'custom' ? 'custom' : state.seedMethod),
            advancePerGroup: state.advancePerGroup,
            ...(state.wildcardCount && state.wildcardCount > 0 ? { wildcardCount: state.wildcardCount } : {}),
            avoidSameGroup: true,
            bracketArrangement: state.bracketArrangement,
            scoringRules: state.sameRulesAsQualifying ? state.qualifyingScoringRules : state.finalsScoringRules,
            ...(state.hasRoundScoringOverride && state.roundOverrideFromRound ? {
              roundScoringOverride: {
                fromRound: state.roundOverrideFromRound,
                scoringRules: {
                  ...state.finalsScoringRules,
                  setsToWin: state.roundOverrideSetsToWin,
                  maxSets: state.roundOverrideMaxSets,
                },
              },
            } : {}),
            ...(state.bracketArrangement === 'custom' && state.customPairings.length > 0 ? {
              customBracketPairings: state.customPairings,
            } : {}),
          },
        } : {}),
        // rankingMatchConfig 항상 저장 (일관성)
        rankingMatchConfig: {
          ...state.rankingMatch,
          enabled: state.rankingMatch.enabled || state.rankingUpTo > 0,
          ...(state.rankingUpTo > 0 ? { rankingUpTo: state.rankingUpTo } : {}),
        },
      });

      if (id) navigate(`/admin/tournament/${id}`);
    } catch (err) {
      console.error('대회 생성 오류:', err);
      setError(t('common.error.tournamentCreateFailed'));
    } finally {
      setSaving(false);
    }
  }, [state, addTournament, navigate]);

  const filteredPresets = WIZARD_PRESETS.filter(p => p.type === state.type);

  // Build Step 5 compatible state
  const step5State = {
    ...state,
    step: state.step as 1 | 2 | 3 | 4,
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6" ref={stepRef} tabIndex={-1} style={{ outline: 'none' }}>
      <h1 className="text-3xl font-bold text-yellow-400 text-center">{t('admin.tournamentCreate.title')}</h1>
      <StepIndicator currentStep={state.step} totalSteps={4} labels={stepLabels} />

      {/* Step 1: 기본 정보 */}
      {state.step === 1 && (
        <Step1BasicInfo
          state={state}
          dispatch={dispatch}
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          filteredPresets={filteredPresets}
          validateStep={validateStep}
          tryAdvanceStep={tryAdvanceStep}
        />
      )}

      {/* Step 2: 참가자 설정 */}
      {state.step === 2 && (
        <Step2Participants state={state} dispatch={dispatch} />
      )}

      {/* Step 3: 대회 형식 */}
      {state.step === 3 && (
        <WizardStep4Finals state={state} dispatch={dispatch} />
      )}

      {/* Step 4: 미리보기 */}
      {state.step === 4 && (
        <WizardStep5Preview state={step5State as any} dispatch={dispatch as any} onSubmit={handleSubmit} />
      )}

      {/* Navigation */}
      {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
      <div className="flex gap-4">
        {state.step > 1 && (
          <button
            className="btn btn-secondary flex-1"
            onClick={() => dispatch({ type: 'PREV_STEP' })}
            aria-label={t('common.back')}
          >
            {t('common.previous')}
          </button>
        )}
        {state.step < 4 ? (
          <button
            className="btn btn-primary flex-1"
            onClick={() => tryAdvanceStep({ type: 'NEXT_STEP' })}
            aria-label={t('common.next')}
          >
            {t('common.next')}
          </button>
        ) : (
          <button
            className="btn btn-success flex-1"
            onClick={handleSubmit}
            disabled={saving}
            aria-label={t('admin.preview.createTournament')}
          >
            {saving ? t('common.creating') : t('admin.preview.createTournament')}
          </button>
        )}
        <button className="btn btn-accent" onClick={() => navigate('/admin')} aria-label={t('common.cancel')}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
