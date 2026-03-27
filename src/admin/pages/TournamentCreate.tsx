import { useState, useCallback, useReducer, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTournaments } from '@shared/hooks/useFirebase';
import { WIZARD_PRESETS } from '@shared/constants/presets';
import { buildStagesFromWizard, mapToLegacyFormat } from '@shared/utils/tournament';
import type { TournamentType, BracketFormatType, ScoringRules, MatchRules, TeamRules, TiebreakerRule, RankingMatchConfig } from '@shared/types';
import StepIndicator from '../components/tournament-create/StepIndicator';
import NumberStepper from '../components/tournament-create/NumberStepper';
import WizardStep4Finals from '../components/tournament-create/WizardStep4Finals';
import WizardStep5Preview from '../components/tournament-create/WizardStep5Preview';

// ===== Wizard State =====

interface WizardState {
  step: number;
  // Step 1
  name: string;
  date: string;
  endDate: string;
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

type Action =
  | { type: 'SET_FIELD'; field: string; value: unknown }
  | { type: 'APPLY_PRESET'; presetId: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GO_TO_STEP'; step: number };

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
    default:
      return state;
  }
}

function nearestBracketRoundKey(count: number): string {
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
        ...(state.rankingMatch.enabled ? {
          rankingMatchConfig: state.rankingMatch,
        } : {}),
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
      <h1 className="text-3xl font-bold text-yellow-400">{t('admin.tournamentCreate.title')}</h1>
      <StepIndicator currentStep={state.step} totalSteps={4} labels={stepLabels} />

      {/* Step 1: 기본 정보 */}
      {state.step === 1 && (
        <div className="space-y-6">
          <div className="card space-y-4">
            <div>
              <label htmlFor="name" className="block mb-2 font-semibold text-lg">{t('admin.tournamentCreate.basicInfo.tournamentName')}</label>
              <input
                id="name"
                className={`input ${fieldErrors.name ? 'border-red-500 border-2' : ''}`}
                value={state.name}
                onChange={e => {
                  dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value });
                  if (fieldErrors.name) setFieldErrors(prev => { const next = { ...prev }; delete next.name; return next; });
                }}
                placeholder={t('admin.tournamentCreate.basicInfo.tournamentNamePlaceholder')}
                aria-label={t('admin.tournamentCreate.basicInfo.tournamentNameAriaLabel')}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? 'name-error' : undefined}
              />
              {fieldErrors.name && (
                <p id="name-error" className="text-red-500 text-sm mt-1" role="alert">{fieldErrors.name}</p>
              )}
            </div>
            <div>
              <label htmlFor="date" className="block mb-2 font-semibold text-lg">{t('admin.tournamentCreate.basicInfo.tournamentPeriod')}</label>
              <div className="flex gap-2 items-center flex-wrap">
                {/* 시작일 */}
                {(() => {
                  const [y, m, d] = (state.date || '').split('-');
                  const curYear = new Date().getFullYear();
                  return (
                    <div className="flex gap-1 items-center">
                      <select className="input text-sm" value={y || ''} onChange={e => dispatch({ type: 'SET_FIELD', field: 'date', value: `${e.target.value}-${m || '01'}-${d || '01'}` })} aria-label={t('admin.tournamentCreate.basicInfo.startDate')}>
                        <option value="">{t('common.date.year')}</option>
                        {[curYear, curYear + 1].map(yr => <option key={yr} value={yr}>{yr}</option>)}
                      </select>
                      <select className="input text-sm" value={m || ''} onChange={e => dispatch({ type: 'SET_FIELD', field: 'date', value: `${y || curYear}-${e.target.value}-${d || '01'}` })}>
                        <option value="">{t('common.date.month')}</option>
                        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(mo => <option key={mo} value={mo}>{parseInt(mo)}{t('common.date.monthUnit')}</option>)}
                      </select>
                      <select className="input text-sm" value={d || ''} onChange={e => dispatch({ type: 'SET_FIELD', field: 'date', value: `${y || curYear}-${m || '01'}-${e.target.value}` })}>
                        <option value="">{t('common.date.day')}</option>
                        {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(dy => <option key={dy} value={dy}>{parseInt(dy)}{t('common.date.dayUnit')}</option>)}
                      </select>
                    </div>
                  );
                })()}
                <span className="text-gray-400">~</span>
                {/* 종료일 */}
                {(() => {
                  const [y, m, d] = (state.endDate || '').split('-');
                  const curYear = new Date().getFullYear();
                  return (
                    <div className="flex gap-1 items-center">
                      <select className="input text-sm" value={y || ''} onChange={e => dispatch({ type: 'SET_FIELD', field: 'endDate', value: `${e.target.value}-${m || '01'}-${d || '01'}` })} aria-label={t('admin.tournamentCreate.basicInfo.endDate')}>
                        <option value="">{t('common.date.year')}</option>
                        {[curYear, curYear + 1].map(yr => <option key={yr} value={yr}>{yr}</option>)}
                      </select>
                      <select className="input text-sm" value={m || ''} onChange={e => dispatch({ type: 'SET_FIELD', field: 'endDate', value: `${y || curYear}-${e.target.value}-${d || '01'}` })}>
                        <option value="">{t('common.date.month')}</option>
                        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(mo => <option key={mo} value={mo}>{parseInt(mo)}{t('common.date.monthUnit')}</option>)}
                      </select>
                      <select className="input text-sm" value={d || ''} onChange={e => dispatch({ type: 'SET_FIELD', field: 'endDate', value: `${y || curYear}-${m || '01'}-${e.target.value}` })}>
                        <option value="">{t('common.date.day')}</option>
                        {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(dy => <option key={dy} value={dy}>{parseInt(dy)}{t('common.date.dayUnit')}</option>)}
                      </select>
                    </div>
                  );
                })()}
              </div>
              <p className="text-gray-400 text-xs mt-1">{t('admin.tournamentCreate.basicInfo.oneDayHint')}</p>
            </div>
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">{t('admin.tournamentCreate.basicInfo.typeSelection')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                className={`btn text-lg py-4 ${state.type === 'individual' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: 'individual' })}
                aria-pressed={state.type === 'individual'}
              >
                {t('admin.tournamentCreate.basicInfo.individual')}
              </button>
              <button
                type="button"
                className={`btn text-lg py-4 ${(state.type === 'team' || state.type === 'randomTeamLeague') ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: 'team' })}
                aria-pressed={state.type === 'team' || state.type === 'randomTeamLeague'}
              >
                {t('admin.tournamentCreate.basicInfo.team')}
              </button>
            </div>
            {(state.type === 'team' || state.type === 'randomTeamLeague') && (
              <label className="flex items-center justify-between cursor-pointer mt-2">
                <span className="text-lg font-semibold">{t('admin.tournamentCreate.basicInfo.randomTeamComposition')}</span>
                <button
                  role="switch"
                  aria-checked={state.type === 'randomTeamLeague'}
                  aria-label={t('admin.tournamentCreate.basicInfo.randomTeamComposition')}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.type === 'randomTeamLeague' ? 'bg-green-600' : 'bg-gray-600'}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: state.type === 'randomTeamLeague' ? 'team' : 'randomTeamLeague' })}
                >
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.type === 'randomTeamLeague' ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </label>
            )}
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">{t('admin.tournamentCreate.presets.title')}</h2>
            {state.type !== 'individual' && (
              <p className="text-gray-400 text-sm">
                {t('admin.tournamentCreate.presets.presetHint')}
              </p>
            )}
            <div className="space-y-3" role="radiogroup" aria-label={t('admin.tournamentCreate.presets.title')}>
              {state.type !== 'individual' && filteredPresets.map(preset => (
                <button
                  key={preset.id}
                  role="radio"
                  aria-checked={state.presetId === preset.id}
                  aria-label={`${preset.name}${state.presetId === preset.id ? `, ${t('common.accessibility.selected')}` : ''}`}
                  className={`card w-full text-left p-4 border-2 ${state.presetId === preset.id ? 'border-yellow-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                  onClick={() => {
                    const errors = validateStep(1);
                    if (Object.keys(errors).length > 0) {
                      setFieldErrors(errors);
                      const el = document.getElementById(Object.keys(errors)[0]);
                      el?.focus();
                      return;
                    }
                    setFieldErrors({});
                    dispatch({ type: 'APPLY_PRESET', presetId: preset.id });
                    dispatch({ type: 'GO_TO_STEP', step: 2 });
                  }}
                >
                  <h3 className="text-lg font-bold">{preset.name}</h3>
                  <p className="text-gray-400 text-sm">{preset.description}</p>
                </button>
              ))}
              <button
                className="card w-full text-left p-6 border-2 border-dashed border-yellow-400 hover:bg-gray-800"
                onClick={() => tryAdvanceStep({ type: 'NEXT_STEP' })}
              >
                <h3 className="text-lg font-bold text-yellow-400">⚙ {t('admin.tournamentCreate.presets.customTitle')}</h3>
                <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.presets.customDescription')}</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: 참가자 설정 */}
      {state.step === 2 && (
        <div className="space-y-6">
          <div className="card space-y-6">
            <h2 className="text-xl font-bold">
              {state.type === 'team' ? t('admin.tournamentCreate.participants.teamCount') : state.type === 'randomTeamLeague' ? t('admin.tournamentCreate.participants.playerCount') : t('admin.tournamentCreate.participants.participantCount')}
            </h2>
            <NumberStepper
              label={state.type === 'team' ? t('admin.tournamentCreate.participants.teamCount') : state.type === 'randomTeamLeague' ? t('admin.tournamentCreate.participants.playerCount') : t('admin.tournamentCreate.participants.participantCount')}
              value={state.participantCount}
              min={4}
              max={128}
              onChange={v => dispatch({ type: 'SET_FIELD', field: 'participantCount', value: v })}
              ariaLabel={state.type === 'team' ? t('admin.tournamentCreate.participants.teamCount') : state.type === 'randomTeamLeague' ? t('admin.tournamentCreate.participants.playerCount') : t('admin.tournamentCreate.participants.participantCount')}
            />
            <div className="flex gap-2 flex-wrap">
              {[4, 8, 16, 32, 64].map(v => (
                <button
                  key={v}
                  className={`btn flex-1 min-w-[60px] ${state.participantCount === v ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'participantCount', value: v })}
                >
                  {v}{state.type === 'team' ? t('common.units.team') : t('common.units.person')}
                </button>
              ))}
            </div>
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">{t('admin.tournamentCreate.tournamentMode.title')}</h2>
            <div className="space-y-2" role="radiogroup" aria-label={t('admin.tournamentCreate.tournamentMode.selectionAriaLabel')}>
              <button
                role="radio"
                aria-checked={state.tournamentMode === 'full_league_all'}
                aria-label={`${t('admin.tournamentCreate.tournamentMode.fullLeague')}${state.tournamentMode === 'full_league_all' ? `, ${t('common.accessibility.selected')}` : ''}`}
                className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'full_league_all' ? 'border-cyan-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'full_league_all' })}
              >
                <h3 className="text-lg font-bold">{t('admin.tournamentCreate.tournamentMode.fullLeague')}</h3>
                <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.tournamentMode.fullLeagueDescription')}</p>
              </button>
              <button
                role="radio"
                aria-checked={state.tournamentMode === 'group_tournament'}
                aria-label={`${t('admin.tournamentCreate.tournamentMode.groupTournament')}${state.tournamentMode === 'group_tournament' ? `, ${t('common.accessibility.selected')}` : ''}`}
                className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'group_tournament' ? 'border-cyan-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'group_tournament' })}
              >
                <h3 className="text-lg font-bold">{t('admin.tournamentCreate.tournamentMode.groupTournament')}</h3>
                <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.tournamentMode.groupTournamentDescription')}</p>
              </button>
              <button
                role="radio"
                aria-checked={state.tournamentMode === 'direct_tournament'}
                aria-label={`${t('admin.tournamentCreate.tournamentMode.directTournament')}${state.tournamentMode === 'direct_tournament' ? `, ${t('common.accessibility.selected')}` : ''}`}
                className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'direct_tournament' ? 'border-cyan-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'direct_tournament' })}
              >
                <h3 className="text-lg font-bold">{t('admin.tournamentCreate.tournamentMode.directTournament')}</h3>
                <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.tournamentMode.directTournamentDescription')}</p>
              </button>
              <button
                role="radio"
                aria-checked={state.tournamentMode === 'manual'}
                aria-label={`${t('admin.tournamentCreate.tournamentMode.manual')}${state.tournamentMode === 'manual' ? `, ${t('common.accessibility.selected')}` : ''}`}
                className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'manual' ? 'border-cyan-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'manual' })}
              >
                <h3 className="text-lg font-bold">{t('admin.tournamentCreate.tournamentMode.manual')}</h3>
                <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.tournamentMode.manualDescription')}</p>
              </button>
            </div>

            {state.tournamentMode === 'full_league_all' && (() => {
              const effectiveCount = state.type === 'randomTeamLeague'
                ? Math.floor(state.participantCount / state.teamSize)
                : state.participantCount;
              const unitLabel = (state.type === 'team' || state.type === 'randomTeamLeague') ? t('common.units.team') : t('common.units.person');
              return (
                <div className="bg-cyan-900/30 rounded-lg p-4 mt-2">
                  <p className="text-cyan-300 font-semibold">
                    {state.type === 'team' ? t('admin.tournamentCreate.tournamentMode.allTeamsPlay') : t('admin.tournamentCreate.tournamentMode.allPlayersPlay')}
                  </p>
                  <p className="text-cyan-200/70 text-lg font-bold mt-1">
                    {t('admin.tournamentCreate.tournamentMode.totalMatches', { count: effectiveCount * (effectiveCount - 1) / 2 })}
                  </p>
                  <p className="text-gray-400 text-sm mt-1">
                    {effectiveCount}{unitLabel} × {effectiveCount - 1} ÷ 2
                  </p>
                </div>
              );
            })()}
          </div>

          {state.tournamentMode === 'manual' && (
          <div className="card space-y-4">
            <h2 className="text-xl font-bold text-yellow-400">{t('admin.tournamentCreate.manualMode.title')}</h2>
            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3" role="note">
              <p className="text-yellow-300 text-sm font-semibold">{t('admin.tournamentCreate.manualMode.allManualNote')}</p>
              <p className="text-gray-400 text-xs mt-1">{t('admin.tournamentCreate.manualMode.allManualDescription')}</p>
            </div>

            {/* 예선 토글 */}
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-lg font-semibold">{t('admin.tournamentCreate.manualMode.qualifyingToggle')}</span>
                <p className="text-gray-400 text-sm">{t('admin.tournamentCreate.manualMode.qualifyingDescription')}</p>
              </div>
              <button
                role="switch"
                aria-checked={state.hasGroupStage}
                aria-label={t('admin.tournamentCreate.manualMode.qualifyingInclude')}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.hasGroupStage ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'hasGroupStage', value: !state.hasGroupStage })}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.hasGroupStage ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>

            {state.hasGroupStage && (() => {
              const effectiveCount = state.type === 'randomTeamLeague'
                ? Math.floor(state.participantCount / state.teamSize)
                : state.participantCount;
              const unitLabel = (state.type === 'team' || state.type === 'randomTeamLeague') ? t('common.units.team') : t('common.units.person');
              const perGroup = Math.floor(effectiveCount / state.groupCount);
              return (
                <div className="space-y-4 pl-4 border-l-2 border-cyan-400">
                  <NumberStepper
                    label={t('admin.tournamentCreate.manualMode.groupCount')}
                    value={state.groupCount}
                    min={2}
                    max={16}
                    onChange={v => dispatch({ type: 'SET_FIELD', field: 'groupCount', value: v })}
                    ariaLabel={t('admin.tournamentCreate.manualMode.groupCount')}
                  />
                  <p className="text-cyan-400 text-sm">
                    {t('admin.tournamentCreate.manualMode.perGroupInfo', { count: perGroup, unit: unitLabel, total: effectiveCount, groups: state.groupCount })}
                  </p>
                  <NumberStepper
                    label={t('admin.tournamentCreate.manualMode.advancePerGroup')}
                    value={state.advancePerGroup}
                    min={1}
                    max={Math.max(1, perGroup)}
                    onChange={v => dispatch({ type: 'SET_FIELD', field: 'advancePerGroup', value: v })}
                    ariaLabel={t('admin.tournamentCreate.manualMode.advancePerGroup')}
                  />
                  <div className="bg-cyan-900/20 rounded-lg p-3">
                    <p className="text-cyan-300 text-sm font-semibold">
                      {t('admin.tournamentCreate.manualMode.totalAdvance', { groups: state.groupCount, perGroup: state.advancePerGroup, unit: unitLabel, total: state.advancePerGroup * state.groupCount })}
                    </p>
                    <p className="text-gray-400 text-xs mt-1">{t('admin.tournamentCreate.manualMode.groupAssignmentNote')}</p>
                  </div>
                </div>
              );
            })()}

            {/* 본선 토글 */}
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-lg font-semibold">{t('admin.tournamentCreate.manualMode.finalsToggle')}</span>
                <p className="text-gray-400 text-sm">{t('admin.tournamentCreate.manualMode.finalsDescription')}</p>
              </div>
              <button
                role="switch"
                aria-checked={state.hasFinalsStage}
                aria-label={t('admin.tournamentCreate.manualMode.finalsInclude')}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.hasFinalsStage ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'hasFinalsStage', value: !state.hasFinalsStage })}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.hasFinalsStage ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>

            {state.hasFinalsStage && (
              <div className="space-y-3 pl-4 border-l-2 border-yellow-400">
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('admin.tournamentCreate.finals.formatTitle')}>
                  <button
                    role="radio"
                    aria-checked={state.finalsFormat === 'single_elimination'}
                    aria-label={`${t('admin.tournamentCreate.finals.singleElimination')}${state.finalsFormat === 'single_elimination' ? `, ${t('common.accessibility.selected')}` : ''}`}
                    className={`btn py-3 ${state.finalsFormat === 'single_elimination' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                    onClick={() => dispatch({ type: 'SET_FIELD', field: 'finalsFormat', value: 'single_elimination' })}
                  >
                    {t('admin.tournamentCreate.finals.singleElimination')}
                  </button>
                  <button
                    role="radio"
                    aria-checked={state.finalsFormat === 'double_elimination'}
                    aria-label={`${t('admin.tournamentCreate.finals.doubleElimination')}${state.finalsFormat === 'double_elimination' ? `, ${t('common.accessibility.selected')}` : ''}`}
                    className={`btn py-3 ${state.finalsFormat === 'double_elimination' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                    onClick={() => dispatch({ type: 'SET_FIELD', field: 'finalsFormat', value: 'double_elimination' })}
                  >
                    {t('admin.tournamentCreate.finals.doubleElimination')}
                  </button>
                </div>
                {state.hasGroupStage && (
                  <p className="text-yellow-300 text-sm">
                    {t('admin.tournamentCreate.groupQualifying.finalsRoundInfo', { round: state.finalsStartRound, count: state.advancePerGroup * state.groupCount, unit: t('common.units.person') })}
                  </p>
                )}
                {!state.hasGroupStage && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-400 mb-2">{t('admin.tournamentCreate.groupQualifying.finalsStartRoundLabel')}</h4>
                    <div className="grid grid-cols-4 gap-2">
                      {[4, 8, 16, 32].filter(v => v <= state.participantCount).map(v => (
                        <button
                          key={v}
                          className={`btn py-2 text-sm ${state.finalsStartRound === v ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                          onClick={() => dispatch({ type: 'SET_FIELD', field: 'finalsStartRound', value: v })}
                          aria-pressed={state.finalsStartRound === v}
                        >
                          {v === 4 ? t('admin.tournamentCreate.finals.round4') : v === 8 ? t('admin.tournamentCreate.finals.round8') : v === 16 ? t('admin.tournamentCreate.finals.round16') : t('admin.tournamentCreate.finals.round32')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-gray-400 text-xs">{t('admin.tournamentCreate.manualMode.bracketNote')}</p>
              </div>
            )}

            {/* 경기 규칙 (수동 모드) */}
            <div className="space-y-4 mt-4">
              <h3 className="text-lg font-bold text-cyan-400">{t('admin.tournamentCreate.matchRules.title')}</h3>
              <fieldset className="space-y-4">
                <legend className="sr-only">{t('admin.tournamentCreate.matchRules.title')}</legend>
                <NumberStepper
                  label={t('admin.tournamentCreate.matchRules.qualifyingSets', { maxSets: state.qualifyingScoringRules.maxSets, setsToWin: state.qualifyingScoringRules.setsToWin })}
                  value={state.qualifyingScoringRules.setsToWin}
                  min={1}
                  max={5}
                  onChange={v => {
                    dispatch({ type: 'SET_FIELD', field: 'qualifyingScoringRules', value: { ...state.qualifyingScoringRules, setsToWin: v, maxSets: v * 2 - 1 } });
                    if (state.sameRulesAsQualifying) {
                      dispatch({ type: 'SET_FIELD', field: 'finalsScoringRules', value: { ...state.finalsScoringRules, setsToWin: v, maxSets: v * 2 - 1 } });
                    }
                  }}
                  ariaLabel={t('admin.tournamentCreate.matchRules.qualifyingSets', { maxSets: state.qualifyingScoringRules.maxSets, setsToWin: state.qualifyingScoringRules.setsToWin })}
                />

                {state.hasFinalsStage && (
                  <>
                    <NumberStepper
                      label={t('admin.tournamentCreate.matchRules.finalsSets', { maxSets: state.finalsScoringRules.maxSets, setsToWin: state.finalsScoringRules.setsToWin })}
                      value={state.finalsScoringRules.setsToWin}
                      min={1}
                      max={5}
                      onChange={v => {
                        dispatch({ type: 'SET_FIELD', field: 'finalsScoringRules', value: { ...state.finalsScoringRules, setsToWin: v, maxSets: v * 2 - 1 } });
                        dispatch({ type: 'SET_FIELD', field: 'sameRulesAsQualifying', value: false });
                      }}
                      ariaLabel={t('admin.tournamentCreate.matchRules.finalsSets', { maxSets: state.finalsScoringRules.maxSets, setsToWin: state.finalsScoringRules.setsToWin })}
                    />

                    {/* 라운드별 세트 수 오버라이드 */}
                    {(() => {
                      const availableRounds: Array<{ value: number; label: string }> = [];
                      let r = state.finalsStartRound;
                      while (r >= 2) {
                        if (r < state.finalsStartRound) {
                          availableRounds.push({ value: r, label: r === 2 ? t('admin.tournamentCreate.finals.final') : r === 4 ? t('admin.tournamentCreate.finals.round4') : r === 8 ? t('admin.tournamentCreate.finals.round8') : r === 16 ? t('admin.tournamentCreate.finals.round16') : t('admin.tournamentCreate.finals.round32') });
                        }
                        r = Math.floor(r / 2);
                      }
                      if (availableRounds.length === 0) return null;
                      return (
                        <div>
                          <label className="flex items-center justify-between cursor-pointer">
                            <span className="font-semibold">{t('admin.tournamentCreate.matchRules.roundScoringOverride')}</span>
                            <button
                              role="switch"
                              aria-checked={state.hasRoundScoringOverride}
                              aria-label={t('admin.tournamentCreate.matchRules.roundScoringOverride')}
                              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.hasRoundScoringOverride ? 'bg-green-600' : 'bg-gray-600'}`}
                              onClick={() => dispatch({ type: 'SET_FIELD', field: 'hasRoundScoringOverride', value: !state.hasRoundScoringOverride })}
                            >
                              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.hasRoundScoringOverride ? 'translate-x-7' : 'translate-x-1'}`} />
                            </button>
                          </label>
                          {state.hasRoundScoringOverride && (
                            <div className="mt-3 p-3 bg-gray-800 rounded-lg space-y-3">
                              <div className="flex items-center gap-3">
                                <label htmlFor="manual-round-from" className="text-sm text-gray-400">{t('admin.tournamentCreate.matchRules.overrideStart')}</label>
                                <select
                                  id="manual-round-from"
                                  className="input bg-gray-600 text-white py-1 px-2 rounded"
                                  value={state.roundOverrideFromRound}
                                  onChange={e => dispatch({ type: 'SET_FIELD', field: 'roundOverrideFromRound', value: Number(e.target.value) })}
                                  aria-label={t('admin.tournamentCreate.matchRules.roundScoringOverride')}
                                >
                                  {availableRounds.map(r => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                  ))}
                                </select>
                              </div>
                              <NumberStepper
                                label={t('admin.tournamentCreate.matchRules.overrideSets', { maxSets: state.roundOverrideMaxSets, setsToWin: state.roundOverrideSetsToWin })}
                                value={state.roundOverrideSetsToWin}
                                min={state.finalsScoringRules.setsToWin + 1}
                                max={5}
                                onChange={v => {
                                  dispatch({ type: 'SET_FIELD', field: 'roundOverrideSetsToWin', value: v });
                                  dispatch({ type: 'SET_FIELD', field: 'roundOverrideMaxSets', value: v * 2 - 1 });
                                }}
                                ariaLabel={t('admin.tournamentCreate.matchRules.overrideSets', { maxSets: state.roundOverrideMaxSets, setsToWin: state.roundOverrideSetsToWin })}
                              />
                              <p aria-live="polite" className="text-sm text-cyan-400">
                                {t('admin.preview.setsPerRoundDetail', { maxSets: state.finalsScoringRules.maxSets, setsToWin: state.finalsScoringRules.setsToWin, fromRound: availableRounds.find(r => r.value === state.roundOverrideFromRound)?.label || '', overrideMaxSets: state.roundOverrideMaxSets, overrideSetsToWin: state.roundOverrideSetsToWin })}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                )}
              </fieldset>
            </div>

            {!state.hasGroupStage && !state.hasFinalsStage && (
              <div className="bg-gray-800 rounded-lg p-3">
                <p className="text-gray-400 text-sm">
                  {t('admin.tournamentCreate.manualMode.noStageNote')}
                </p>
              </div>
            )}
          </div>
          )}

          {state.tournamentMode === 'group_tournament' && (
          <div className="card space-y-4">
            <h2 className="text-xl font-bold">{t('admin.tournamentCreate.groupQualifying.title')}</h2>

            <div className="space-y-4 mt-4 pl-4 border-l-2 border-yellow-400">
                <NumberStepper
                  label={t('admin.tournamentCreate.groupQualifying.groupCount')}
                  value={state.groupCount}
                  min={2}
                  max={16}
                  onChange={v => dispatch({ type: 'SET_FIELD', field: 'groupCount', value: v })}
                  ariaLabel={t('admin.tournamentCreate.groupQualifying.groupCount')}
                />

                {(() => {
                  const effectiveCount = state.type === 'randomTeamLeague'
                    ? Math.floor(state.participantCount / state.teamSize)
                    : state.participantCount;
                  const unitLabel = (state.type === 'team' || state.type === 'randomTeamLeague') ? t('common.units.team') : t('common.units.person');
                  const perGroup = Math.floor(effectiveCount / state.groupCount);
                  const remainder = effectiveCount % state.groupCount;
                  return (
                    <div className="space-y-2">
                      {remainder === 0 ? (
                        <p className="text-cyan-400 font-semibold text-lg">
                          {t('admin.tournamentCreate.groupQualifying.perGroupEqual', { count: perGroup, unit: unitLabel })}
                        </p>
                      ) : (
                        <div className="bg-gray-800 rounded p-3 text-sm space-y-1">
                          <p className="text-yellow-400 font-semibold">{t('admin.tournamentCreate.groupQualifying.unevenDistribution')}</p>
                          <p className="text-gray-300">
                            {t('admin.tournamentCreate.groupQualifying.unevenDetail', { remainder, larger: perGroup + 1, unit: unitLabel, rest: state.groupCount - remainder, smaller: perGroup })}
                          </p>
                          <p className="text-gray-400 text-xs">
                            {t('admin.tournamentCreate.groupQualifying.snakeDraft')}
                          </p>
                        </div>
                      )}
                      {perGroup < 2 && (
                        <p className="text-red-500 text-sm font-bold">
                          {t('admin.tournamentCreate.groupQualifying.perGroupTooFew', { unit: unitLabel, participantUnit: unitLabel })}
                        </p>
                      )}
                    </div>
                  );
                })()}

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-lg font-semibold">{t('admin.tournamentCreate.groupQualifying.topSeedToggle')}</span>
                  <button
                    role="switch"
                    aria-checked={state.useTopSeed}
                    aria-label={t('admin.tournamentCreate.groupQualifying.topSeedToggle')}
                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.useTopSeed ? 'bg-green-600' : 'bg-gray-600'}`}
                    onClick={() => dispatch({ type: 'SET_FIELD', field: 'useTopSeed', value: !state.useTopSeed })}
                  >
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.useTopSeed ? 'translate-x-7' : 'translate-x-1'}`} />
                  </button>
                </label>

                {state.useTopSeed && (
                  <NumberStepper
                    label={t('admin.tournamentCreate.groupQualifying.seedCount')}
                    value={state.seedCount}
                    min={1}
                    max={Math.min(state.participantCount, state.groupCount * 2)}
                    onChange={v => dispatch({ type: 'SET_FIELD', field: 'seedCount', value: v })}
                    ariaLabel={t('admin.tournamentCreate.groupQualifying.seedCount')}
                  />
                )}

                {(() => {
                  const effectiveCount = state.type === 'randomTeamLeague'
                    ? Math.floor(state.participantCount / state.teamSize)
                    : state.participantCount;
                  const unitLabel = (state.type === 'team' || state.type === 'randomTeamLeague') ? t('common.units.team') : t('common.units.person');
                  const perGroup = Math.floor(effectiveCount / state.groupCount);
                  return (
                    <>
                      <NumberStepper
                        label={t('admin.tournamentCreate.groupQualifying.advancePerGroupLabel', { unit: unitLabel })}
                        value={state.advancePerGroup}
                        min={1}
                        max={perGroup}
                        onChange={v => dispatch({ type: 'SET_FIELD', field: 'advancePerGroup', value: v })}
                        ariaLabel={t('admin.tournamentCreate.groupQualifying.advancePerGroupAriaLabel', { unit: unitLabel })}
                      />

                      {(() => {
                        const directAdvance = state.advancePerGroup * state.groupCount;
                        const finalsSlots = state.finalsStartRound || directAdvance;
                        const wildcardCount = Math.max(0, finalsSlots - directAdvance);

                        return (
                          <>
                            <div className="bg-blue-900/30 rounded-lg p-4 space-y-2">
                              <p className="text-blue-300 font-semibold text-lg">
                                {t('admin.tournamentCreate.groupQualifying.groupAdvanceSummary', { groups: state.groupCount, perGroup: state.advancePerGroup, unit: unitLabel, total: directAdvance })}
                              </p>
                              {wildcardCount > 0 && (
                                <div className="bg-yellow-900/30 rounded p-3 mt-2">
                                  <p className="text-yellow-300 font-semibold">
                                    {t('admin.tournamentCreate.groupQualifying.wildcardAdvance', { count: wildcardCount, unit: unitLabel })}
                                  </p>
                                  <p className="text-yellow-200/70 text-sm">
                                    {t('admin.tournamentCreate.groupQualifying.wildcardExplanation', { count: wildcardCount, unit: unitLabel, rank: state.advancePerGroup + 1 })}
                                  </p>
                                </div>
                              )}
                              <p className="text-white font-bold text-lg">
                                {t('admin.tournamentCreate.groupQualifying.finalsTotalAdvance', { count: directAdvance + wildcardCount, unit: unitLabel })}
                              </p>
                              <p className="text-gray-400 text-sm">
                                {t('admin.tournamentCreate.groupQualifying.finalsStartFrom', { round: t(nearestBracketRoundKey(directAdvance + wildcardCount)) })}
                              </p>
                            </div>

                            {/* 본선 시작 라운드 */}
                            <div className="mt-4">
                              <h3 className="text-lg font-semibold mb-2">{t('admin.tournamentCreate.groupQualifying.finalsStartRoundLabel')}</h3>
                              <div className="grid grid-cols-4 gap-2">
                                {[4, 8, 16, 32].filter(v => v >= directAdvance).map(v => (
                                  <button
                                    key={v}
                                    className={`btn py-3 ${state.finalsStartRound === v ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                                    onClick={() => dispatch({ type: 'SET_FIELD', field: 'finalsStartRound', value: v })}
                                    aria-pressed={state.finalsStartRound === v}
                                  >
                                    {v === 4 ? t('admin.tournamentCreate.finals.round4') : v === 8 ? t('admin.tournamentCreate.finals.round8') : v === 16 ? t('admin.tournamentCreate.finals.round16') : t('admin.tournamentCreate.finals.round32')}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </>
                  );
                })()}
            </div>
          </div>
          )}

          {(state.type === 'team' || state.type === 'randomTeamLeague') && (
            <div className="card space-y-4">
              <h2 className="text-xl font-bold">{t('admin.tournamentCreate.teamSettings.title')}</h2>
              <NumberStepper
                label={t('admin.tournamentCreate.teamSettings.teamSize')}
                value={state.teamSize}
                min={2}
                max={6}
                onChange={v => dispatch({ type: 'SET_FIELD', field: 'teamSize', value: v })}
                ariaLabel={t('admin.tournamentCreate.teamSettings.teamSizeAriaLabel')}
              />
              <p className="text-gray-400 text-sm">{t('admin.tournamentCreate.teamSettings.teamSizeHint')}</p>
              <NumberStepper
                label={t('admin.tournamentCreate.teamSettings.reserves')}
                value={state.teamRules.maxReserves ?? 1}
                min={0}
                max={2}
                onChange={v => dispatch({ type: 'SET_FIELD', field: 'teamRules', value: { ...state.teamRules, maxReserves: v } })}
                ariaLabel={t('admin.tournamentCreate.teamSettings.reservesAriaLabel')}
              />
              <p className="text-cyan-400 text-sm font-semibold">
                {t('admin.tournamentCreate.teamSettings.teamCompositionSummary', { active: state.teamSize, reserve: state.teamRules.maxReserves ?? 1, total: state.teamSize + (state.teamRules.maxReserves ?? 1) })}
              </p>
              {/* 성별 비율 */}
              <div className="space-y-2">
                <label className="block font-semibold">{t('admin.tournamentCreate.teamSettings.genderRatio')}</label>
                <div className="flex gap-3 items-center">
                  <div className="flex items-center gap-1">
                    <span className="text-blue-400">{t('admin.tournamentCreate.teamSettings.male')}</span>
                    <NumberStepper
                      label=""
                      value={state.teamRules.genderRatio?.male ?? 2}
                      min={0}
                      max={state.teamSize}
                      onChange={v => dispatch({ type: 'SET_FIELD', field: 'teamRules', value: {
                        ...state.teamRules,
                        genderRatio: { male: v, female: state.teamSize - v }
                      }})}
                      ariaLabel={t('admin.tournamentCreate.teamSettings.maleAriaLabel')}
                    />
                  </div>
                  <span className="text-gray-400">:</span>
                  <div className="flex items-center gap-1">
                    <span className="text-pink-400">{t('admin.tournamentCreate.teamSettings.female')}</span>
                    <span className="text-lg font-bold">{state.teamSize - (state.teamRules.genderRatio?.male ?? 2)}</span>
                  </div>
                </div>
                <p className="text-gray-400 text-sm">{t('admin.tournamentCreate.teamSettings.genderRatioSummary', { male: state.teamRules.genderRatio?.male ?? 2, female: state.teamSize - (state.teamRules.genderRatio?.male ?? 2) })}</p>
              </div>
            </div>
          )}
        </div>
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
