import { useState, useCallback, useReducer, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  tournamentMode: 'full_league_all' | 'group_tournament' | 'direct_tournament';
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
  bracketArrangement: 'cross_group' | 'sequential' | 'random';
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
  // Common
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules: TeamRules;
  formatType: BracketFormatType;
  useCustomRules: boolean;
  startingRound: number;
  seedMethod: 'ranking' | 'manual' | 'random';
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
        }
      }
      if (action.field === 'hasGroupStage') {
        next.hasFinalsStage = action.value as boolean;
        next.qualifyingFormat = next.groupCount > 1 ? 'group_round_robin' : 'round_robin';
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
        next.formatType = action.value as BracketFormatType;
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
        seedMethod: (preset.finalsConfig?.seedMethod as 'ranking' | 'manual' | 'random') ?? 'ranking',
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
      if (state.step === 2 && nextStep === 3 && state.tournamentMode === 'full_league_all') {
        next.step = 4;
      }
      return next;
    }
    case 'PREV_STEP': {
      const prevStep = getPrevStep(state.step, state.hasGroupStage);
      const next = { ...state, step: prevStep };
      if (state.step === 4 && prevStep === 3 && state.tournamentMode === 'full_league_all') {
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

function nearestBracketRound(count: number): string {
  if (count >= 32) return '32강';
  if (count >= 16) return '16강';
  if (count >= 8) return '8강';
  if (count >= 4) return '4강';
  return '결승';
}

// ===== Component =====

export default function TournamentCreate() {
  const navigate = useNavigate();
  const { addTournament } = useTournaments();
  const [state, dispatch] = useReducer(reducer, defaultState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const stepLabels = ['기본 정보', '참가자 설정', '대회 형식', '미리보기'];
  const stepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    stepRef.current?.focus();
  }, [state.step]);

  const handleSubmit = useCallback(async () => {
    if (!state.name.trim()) {
      setError('대회명을 입력해주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const isTeam = state.type === 'team' || state.type === 'randomTeamLeague';
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
        formatType: state.hasGroupStage ? 'group_knockout' : state.formatType,
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
            seedMethod: state.seedMethod,
            scoringRules: state.sameRulesAsQualifying ? state.qualifyingScoringRules : state.finalsScoringRules,
          },
        } : {}),
        ...(state.rankingMatch.enabled ? {
          rankingMatchConfig: state.rankingMatch,
        } : {}),
      });

      if (id) navigate(`/admin/tournament/${id}`);
    } catch (err) {
      console.error('대회 생성 오류:', err);
      setError('대회 생성 중 오류가 발생했습니다.');
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
      <h1 className="text-3xl font-bold text-yellow-400">새 대회 만들기</h1>
      <StepIndicator currentStep={state.step} totalSteps={4} labels={stepLabels} />

      {/* Step 1: 기본 정보 */}
      {state.step === 1 && (
        <div className="space-y-6">
          <div className="card space-y-4">
            <div>
              <label htmlFor="name" className="block mb-2 font-semibold text-lg">대회명</label>
              <input
                id="name"
                className="input"
                value={state.name}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
                placeholder="대회명을 입력하세요"
                aria-label="대회명"
              />
            </div>
            <div>
              <label htmlFor="date" className="block mb-2 font-semibold text-lg">대회 기간</label>
              <div className="flex gap-2 items-center">
                <input
                  id="date"
                  type="date"
                  className="input flex-1"
                  value={state.date}
                  onChange={e => dispatch({ type: 'SET_FIELD', field: 'date', value: e.target.value })}
                  aria-label="시작 날짜"
                />
                <span className="text-gray-400">~</span>
                <input
                  type="date"
                  className="input flex-1"
                  value={state.endDate}
                  min={state.date}
                  onChange={e => dispatch({ type: 'SET_FIELD', field: 'endDate', value: e.target.value })}
                  aria-label="종료 날짜"
                />
              </div>
              <p className="text-gray-500 text-xs mt-1">1일 대회는 종료 날짜를 비워두세요</p>
            </div>
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">유형 선택</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                className={`btn text-lg py-4 ${state.type === 'individual' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: 'individual' })}
                aria-pressed={state.type === 'individual'}
              >
                개인전
              </button>
              <button
                type="button"
                className={`btn text-lg py-4 ${(state.type === 'team' || state.type === 'randomTeamLeague') ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: 'team' })}
                aria-pressed={state.type === 'team' || state.type === 'randomTeamLeague'}
              >
                팀전
              </button>
            </div>
            {(state.type === 'team' || state.type === 'randomTeamLeague') && (
              <label className="flex items-center justify-between cursor-pointer mt-2">
                <span className="text-lg font-semibold">랜덤 팀 구성</span>
                <button
                  role="switch"
                  aria-checked={state.type === 'randomTeamLeague'}
                  aria-label="랜덤 팀 구성"
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.type === 'randomTeamLeague' ? 'bg-green-600' : 'bg-gray-600'}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: state.type === 'randomTeamLeague' ? 'team' : 'randomTeamLeague' })}
                >
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.type === 'randomTeamLeague' ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </label>
            )}
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">설정 방식</h2>
            {state.type !== 'individual' && (
              <p className="text-gray-400 text-sm">
                프리셋을 선택하면 바로 확인 화면으로 이동합니다. 직접 설정하면 세부 옵션을 조정할 수 있습니다.
              </p>
            )}
            <div className="space-y-3" role="radiogroup" aria-label="설정 방식 선택">
              {state.type !== 'individual' && filteredPresets.map(preset => (
                <button
                  key={preset.id}
                  role="radio"
                  aria-checked={state.presetId === preset.id}
                  className={`card w-full text-left p-4 border-2 ${state.presetId === preset.id ? 'border-yellow-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                  onClick={() => {
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
                onClick={() => dispatch({ type: 'NEXT_STEP' })}
              >
                <h3 className="text-lg font-bold text-yellow-400">⚙ 직접 설정 (커스텀)</h3>
                <p className="text-gray-400 text-sm mt-1">참가자 수, 조 편성, 예선/본선 규칙 등을 자유롭게 설정합니다</p>
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
              {state.type === 'team' ? '팀 수' : state.type === 'randomTeamLeague' ? '선수 수 (자동 팀 편성)' : '참가자 수'}
            </h2>
            <NumberStepper
              label={state.type === 'team' ? '팀 수' : state.type === 'randomTeamLeague' ? '선수 수' : '참가자 수'}
              value={state.participantCount}
              min={4}
              max={128}
              onChange={v => dispatch({ type: 'SET_FIELD', field: 'participantCount', value: v })}
              ariaLabel={state.type === 'team' ? '팀 수' : state.type === 'randomTeamLeague' ? '선수 수' : '참가자 수'}
            />
            <div className="flex gap-2 flex-wrap">
              {[4, 8, 16, 32, 64].map(v => (
                <button
                  key={v}
                  className={`btn flex-1 min-w-[60px] ${state.participantCount === v ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'participantCount', value: v })}
                >
                  {v}{state.type === 'team' ? '팀' : '명'}
                </button>
              ))}
            </div>
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">대회 방식</h2>
            <div className="space-y-2" role="radiogroup" aria-label="대회 방식 선택">
              <button
                role="radio"
                aria-checked={state.tournamentMode === 'full_league_all'}
                className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'full_league_all' ? 'border-cyan-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'full_league_all' })}
              >
                <h3 className="text-lg font-bold">풀리그 (전체 라운드로빈)</h3>
                <p className="text-gray-400 text-sm mt-1">모든 참가자가 서로 한 번씩 경기합니다. 조 편성 없음.</p>
              </button>
              <button
                role="radio"
                aria-checked={state.tournamentMode === 'group_tournament'}
                className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'group_tournament' ? 'border-cyan-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'group_tournament' })}
              >
                <h3 className="text-lg font-bold">조별 예선 + 토너먼트</h3>
                <p className="text-gray-400 text-sm mt-1">조별 라운드로빈 후 본선 토너먼트를 진행합니다.</p>
              </button>
              <button
                role="radio"
                aria-checked={state.tournamentMode === 'direct_tournament'}
                className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'direct_tournament' ? 'border-cyan-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'direct_tournament' })}
              >
                <h3 className="text-lg font-bold">토너먼트 (직접 대진)</h3>
                <p className="text-gray-400 text-sm mt-1">싱글/더블 엘리미네이션 토너먼트만 진행합니다.</p>
              </button>
            </div>

            {state.tournamentMode === 'full_league_all' && (() => {
              const effectiveCount = state.type === 'randomTeamLeague'
                ? Math.floor(state.participantCount / state.teamSize)
                : state.participantCount;
              const unitLabel = (state.type === 'team' || state.type === 'randomTeamLeague') ? '팀' : '명';
              return (
                <div className="bg-cyan-900/30 rounded-lg p-4 mt-2">
                  <p className="text-cyan-300 font-semibold">
                    {state.type === 'team' ? '모든 팀이 서로 경기합니다.' : '모든 참가자가 서로 경기합니다.'}
                  </p>
                  <p className="text-cyan-200/70 text-lg font-bold mt-1">
                    총 {effectiveCount * (effectiveCount - 1) / 2}경기
                  </p>
                  <p className="text-gray-400 text-sm mt-1">
                    {effectiveCount}{unitLabel} × {effectiveCount - 1} ÷ 2
                  </p>
                </div>
              );
            })()}
          </div>

          {state.tournamentMode === 'group_tournament' && (
          <div className="card space-y-4">
            <h2 className="text-xl font-bold">조별 예선 설정</h2>

            <div className="space-y-4 mt-4 pl-4 border-l-2 border-yellow-400">
                <NumberStepper
                  label="조 수"
                  value={state.groupCount}
                  min={2}
                  max={16}
                  onChange={v => dispatch({ type: 'SET_FIELD', field: 'groupCount', value: v })}
                  ariaLabel="조 수"
                />

                {(() => {
                  const effectiveCount = state.type === 'randomTeamLeague'
                    ? Math.floor(state.participantCount / state.teamSize)
                    : state.participantCount;
                  const unitLabel = (state.type === 'team' || state.type === 'randomTeamLeague') ? '팀' : '명';
                  const perGroup = Math.floor(effectiveCount / state.groupCount);
                  const remainder = effectiveCount % state.groupCount;
                  return (
                    <div className="space-y-2">
                      {remainder === 0 ? (
                        <p className="text-cyan-400 font-semibold text-lg">
                          조당 {perGroup}{unitLabel} (균등 배분)
                        </p>
                      ) : (
                        <div className="bg-gray-800 rounded p-3 text-sm space-y-1">
                          <p className="text-yellow-400 font-semibold">불균등 배분 안내</p>
                          <p className="text-gray-300">
                            {remainder}개 조는 {perGroup + 1}{unitLabel}, 나머지 {state.groupCount - remainder}개 조는 {perGroup}{unitLabel}
                          </p>
                          <p className="text-gray-400 text-xs">
                            Snake draft 방식으로 공정하게 배분됩니다
                          </p>
                        </div>
                      )}
                      {perGroup < 2 && (
                        <p className="text-red-500 text-sm font-bold">
                          조당 {unitLabel === '팀' ? '팀 수가' : '인원이'} 너무 적습니다. 조 수를 줄이거나 {unitLabel === '팀' ? '팀 수를' : '참가자 수를'} 늘려주세요.
                        </p>
                      )}
                    </div>
                  );
                })()}

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-lg font-semibold">탑시드 배정</span>
                  <button
                    role="switch"
                    aria-checked={state.useTopSeed}
                    aria-label="탑시드 배정"
                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.useTopSeed ? 'bg-green-600' : 'bg-gray-600'}`}
                    onClick={() => dispatch({ type: 'SET_FIELD', field: 'useTopSeed', value: !state.useTopSeed })}
                  >
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.useTopSeed ? 'translate-x-7' : 'translate-x-1'}`} />
                  </button>
                </label>

                {state.useTopSeed && (
                  <NumberStepper
                    label="시드 수"
                    value={state.seedCount}
                    min={1}
                    max={Math.min(state.participantCount, state.groupCount * 2)}
                    onChange={v => dispatch({ type: 'SET_FIELD', field: 'seedCount', value: v })}
                    ariaLabel="시드 수"
                  />
                )}

                {(() => {
                  const effectiveCount = state.type === 'randomTeamLeague'
                    ? Math.floor(state.participantCount / state.teamSize)
                    : state.participantCount;
                  const unitLabel = (state.type === 'team' || state.type === 'randomTeamLeague') ? '팀' : '명';
                  const perGroup = Math.floor(effectiveCount / state.groupCount);
                  return (
                    <>
                      <NumberStepper
                        label={`조당 진출 ${unitLabel === '팀' ? '팀 수' : '인원'}`}
                        value={state.advancePerGroup}
                        min={1}
                        max={perGroup}
                        onChange={v => dispatch({ type: 'SET_FIELD', field: 'advancePerGroup', value: v })}
                        ariaLabel={`각 조에서 본선에 진출하는 ${unitLabel === '팀' ? '팀 수' : '인원 수'}`}
                      />

                      {(() => {
                        const directAdvance = state.advancePerGroup * state.groupCount;
                        const finalsSlots = state.finalsStartRound || directAdvance;
                        const wildcardCount = Math.max(0, finalsSlots - directAdvance);

                        return (
                          <>
                            <div className="bg-blue-900/30 rounded-lg p-4 space-y-2">
                              <p className="text-blue-300 font-semibold text-lg">
                                조별 진출: {state.groupCount}조 × {state.advancePerGroup}{unitLabel} = {directAdvance}{unitLabel}
                              </p>
                              {wildcardCount > 0 && (
                                <div className="bg-yellow-900/30 rounded p-3 mt-2">
                                  <p className="text-yellow-300 font-semibold">
                                    와일드카드 {wildcardCount}{unitLabel} 추가 진출
                                  </p>
                                  <p className="text-yellow-200/70 text-sm">
                                    각 조 {state.advancePerGroup + 1}위 중 성적이 가장 좋은 {wildcardCount}{unitLabel}{unitLabel === '팀' ? '이' : '이'} 본선에 진출합니다
                                  </p>
                                </div>
                              )}
                              <p className="text-white font-bold text-lg">
                                본선 총 진출: {directAdvance + wildcardCount}{unitLabel}
                              </p>
                              <p className="text-gray-400 text-sm">
                                본선 {nearestBracketRound(directAdvance + wildcardCount)} 시작
                              </p>
                            </div>

                            {/* 본선 시작 라운드 */}
                            <div className="mt-4">
                              <h3 className="text-lg font-semibold mb-2">본선 시작 라운드</h3>
                              <div className="grid grid-cols-4 gap-2">
                                {[4, 8, 16, 32].filter(v => v >= directAdvance).map(v => (
                                  <button
                                    key={v}
                                    className={`btn py-3 ${state.finalsStartRound === v ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                                    onClick={() => dispatch({ type: 'SET_FIELD', field: 'finalsStartRound', value: v })}
                                    aria-pressed={state.finalsStartRound === v}
                                  >
                                    {v === 4 ? '4강' : v === 8 ? '8강' : v === 16 ? '16강' : '32강'}
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
              <h2 className="text-xl font-bold">팀 설정</h2>
              <NumberStepper
                label="팀 인원"
                value={state.teamSize}
                min={2}
                max={6}
                onChange={v => dispatch({ type: 'SET_FIELD', field: 'teamSize', value: v })}
                ariaLabel="팀 인원"
              />
              <NumberStepper
                label="예비 선수"
                value={state.teamRules.maxReserves ?? 1}
                min={0}
                max={2}
                onChange={v => dispatch({ type: 'SET_FIELD', field: 'teamRules', value: { ...state.teamRules, maxReserves: v } })}
                ariaLabel="예비 선수 수"
              />
              <p className="text-cyan-400 text-sm font-semibold">
                출전 {state.teamSize}명 + 예비 {state.teamRules.maxReserves ?? 1}명 = 총 {state.teamSize + (state.teamRules.maxReserves ?? 1)}명
              </p>
              {/* 성별 비율 */}
              <div className="space-y-2">
                <label className="block font-semibold">성별 비율</label>
                <div className="flex gap-3 items-center">
                  <div className="flex items-center gap-1">
                    <span className="text-blue-400">남</span>
                    <NumberStepper
                      label=""
                      value={state.teamRules.genderRatio?.male ?? 2}
                      min={0}
                      max={state.teamSize}
                      onChange={v => dispatch({ type: 'SET_FIELD', field: 'teamRules', value: {
                        ...state.teamRules,
                        genderRatio: { male: v, female: state.teamSize - v }
                      }})}
                      ariaLabel="남성 인원"
                    />
                  </div>
                  <span className="text-gray-400">:</span>
                  <div className="flex items-center gap-1">
                    <span className="text-pink-400">여</span>
                    <span className="text-lg font-bold">{state.teamSize - (state.teamRules.genderRatio?.male ?? 2)}</span>
                  </div>
                </div>
                <p className="text-gray-400 text-sm">팀당 남 {state.teamRules.genderRatio?.male ?? 2}명, 여 {state.teamSize - (state.teamRules.genderRatio?.male ?? 2)}명</p>
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
            aria-label="이전 단계"
          >
            이전
          </button>
        )}
        {state.step < 4 ? (
          <button
            className="btn btn-primary flex-1"
            onClick={() => dispatch({ type: 'NEXT_STEP' })}
            aria-label="다음 단계"
          >
            다음
          </button>
        ) : (
          <button
            className="btn btn-success flex-1"
            onClick={handleSubmit}
            disabled={saving}
            aria-label="대회 생성"
          >
            {saving ? '생성 중...' : '대회 생성'}
          </button>
        )}
        <button className="btn btn-accent" onClick={() => navigate('/admin')} aria-label="취소">
          취소
        </button>
      </div>
    </div>
  );
}
