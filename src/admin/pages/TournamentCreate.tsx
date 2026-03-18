import { useState, useCallback, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTournaments } from '@shared/hooks/useFirebase';
import { TOURNAMENT_PRESETS, FORMAT_OPTIONS } from '@shared/constants/presets';
import type { TournamentType, BracketFormatType, ScoringRules, MatchRules, TeamRules } from '@shared/types';
import StepIndicator from '../components/tournament-create/StepIndicator';
import NumberStepper from '../components/tournament-create/NumberStepper';

interface WizardState {
  step: 1 | 2 | 3 | 4;
  name: string;
  date: string;
  type: TournamentType;
  presetId: string | null;
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules: TeamRules;
  formatType: BracketFormatType;
  useCustomRules: boolean;
  groupCount: number;
}

type Action =
  | { type: 'SET_FIELD'; field: string; value: unknown }
  | { type: 'APPLY_PRESET'; presetId: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' };

const defaultState: WizardState = {
  step: 1,
  name: '',
  date: new Date().toISOString().split('T')[0],
  type: 'individual',
  presetId: 'ibsa_individual',
  scoringRules: { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2, deuceEnabled: true },
  matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
  teamRules: { teamSize: 3, rotationEnabled: true, rotationInterval: 6 },
  formatType: 'round_robin',
  useCustomRules: false,
  groupCount: 4,
};

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'APPLY_PRESET': {
      const preset = TOURNAMENT_PRESETS.find(p => p.id === action.presetId);
      if (!preset) return state;
      return {
        ...state,
        presetId: action.presetId,
        type: preset.type,
        scoringRules: { ...preset.scoringRules },
        matchRules: { ...preset.matchRules },
        teamRules: preset.teamRules ? { ...preset.teamRules } : state.teamRules,
        formatType: preset.formatType,
        useCustomRules: false,
      };
    }
    case 'NEXT_STEP':
      return { ...state, step: Math.min(4, state.step + 1) as WizardState['step'] };
    case 'PREV_STEP':
      return { ...state, step: Math.max(1, state.step - 1) as WizardState['step'] };
    default:
      return state;
  }
}

export default function TournamentCreate() {
  const navigate = useNavigate();
  const { addTournament } = useTournaments();
  const [state, dispatch] = useReducer(reducer, defaultState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async () => {
    if (!state.name.trim()) { setError('대회명을 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      const isTeam = state.type === 'team' || state.type === 'randomTeamLeague';
      const gameConfig = { winScore: state.scoringRules.winScore, setsToWin: state.scoringRules.setsToWin };
      const teamMatchSettings = isTeam ? { winScore: state.scoringRules.winScore, setsToWin: state.scoringRules.setsToWin, minLead: state.scoringRules.minLead } : undefined;

      const id = await addTournament({
        name: state.name.trim(),
        date: state.date,
        type: state.type,
        format: 'full_league',
        status: 'draft',
        gameConfig,
        ...(teamMatchSettings ? { teamMatchSettings } : {}),
        formatType: state.formatType,
        scoringRules: state.scoringRules,
        matchRules: state.matchRules,
        ...(isTeam ? { teamRules: state.teamRules } : {}),
      });

      if (id) navigate(`/admin/tournament/${id}`);
    } catch {
      setError('대회 생성 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }, [state, addTournament, navigate]);

  const stepLabels = ['기본 정보', '경기 규칙', '대회 형식', '확인'];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-yellow-400">새 대회 만들기</h1>
      <StepIndicator currentStep={state.step} totalSteps={4} labels={stepLabels} />

      {/* Step 1: 기본 정보 */}
      {state.step === 1 && (
        <div className="space-y-6">
          <div className="card space-y-4">
            <div>
              <label htmlFor="name" className="block mb-2 font-semibold text-lg">대회명</label>
              <input id="name" className="input" value={state.name}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
                placeholder="대회명을 입력하세요" aria-label="대회명" />
            </div>
            <div>
              <label htmlFor="date" className="block mb-2 font-semibold text-lg">날짜</label>
              <input id="date" type="date" className="input" value={state.date}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'date', value: e.target.value })} aria-label="대회 날짜" />
            </div>
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">유형 선택</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                { value: 'individual' as const, label: '개인전' },
                { value: 'team' as const, label: '팀전' },
                { value: 'randomTeamLeague' as const, label: '랜덤 팀리그전' },
              ]).map(opt => (
                <button key={opt.value} type="button"
                  className={`btn text-lg py-4 ${state.type === opt.value ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: opt.value })}
                  aria-pressed={state.type === opt.value}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">빠른 설정 (프리셋)</h2>
            <div className="space-y-3" role="radiogroup" aria-label="대회 프리셋">
              {TOURNAMENT_PRESETS.map(preset => (
                <button key={preset.id} role="radio" aria-checked={state.presetId === preset.id}
                  className={`card w-full text-left p-4 border-2 ${state.presetId === preset.id ? 'border-yellow-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                  onClick={() => dispatch({ type: 'APPLY_PRESET', presetId: preset.id })}>
                  <h3 className="text-lg font-bold">{preset.name}</h3>
                  <p className="text-gray-400 text-sm">{preset.description}</p>
                </button>
              ))}
              <button role="radio" aria-checked={state.useCustomRules}
                className={`card w-full text-left p-4 border-2 ${state.useCustomRules ? 'border-yellow-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'useCustomRules', value: true })}>
                <h3 className="text-lg font-bold text-cyan-400">직접 설정</h3>
                <p className="text-gray-400 text-sm">모든 규칙을 직접 설정합니다</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: 경기 규칙 */}
      {state.step === 2 && (
        <div className="space-y-6">
          <div className="card space-y-6">
            <h2 className="text-xl font-bold">점수 규칙</h2>
            <NumberStepper label="승리 점수" value={state.scoringRules.winScore} min={3} max={51}
              onChange={v => dispatch({ type: 'SET_FIELD', field: 'scoringRules', value: { ...state.scoringRules, winScore: v } })}
              ariaLabel="승리 점수" />
            <div className="flex gap-2">
              {[7, 11, 21, 31].map(v => (
                <button key={v} className={`btn flex-1 ${state.scoringRules.winScore === v ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'scoringRules', value: { ...state.scoringRules, winScore: v } })}>
                  {v}점
                </button>
              ))}
            </div>
            <NumberStepper label="세트 수 (선승)" value={state.scoringRules.setsToWin} min={1} max={5}
              onChange={v => dispatch({ type: 'SET_FIELD', field: 'scoringRules', value: { ...state.scoringRules, setsToWin: v, maxSets: v * 2 - 1 } })}
              ariaLabel="선승 세트 수" />
            <NumberStepper label="최소 점수차" value={state.scoringRules.minLead} min={0} max={5}
              onChange={v => dispatch({ type: 'SET_FIELD', field: 'scoringRules', value: { ...state.scoringRules, minLead: v } })}
              ariaLabel="최소 점수차" />
            <div className="flex items-center gap-4">
              <label className="text-lg font-semibold">듀스 적용</label>
              <button
                className={`btn ${state.scoringRules.deuceEnabled ? 'btn-success' : 'bg-gray-700 text-white'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'scoringRules', value: { ...state.scoringRules, deuceEnabled: !state.scoringRules.deuceEnabled } })}
                aria-pressed={state.scoringRules.deuceEnabled}>
                {state.scoringRules.deuceEnabled ? '적용' : '미적용'}
              </button>
            </div>
          </div>

          <div className="card space-y-4">
            <h2 className="text-xl font-bold">경기 규칙</h2>
            <NumberStepper label="선수당 타임아웃 횟수" value={state.matchRules.timeoutsPerPlayer} min={0} max={3}
              onChange={v => dispatch({ type: 'SET_FIELD', field: 'matchRules', value: { ...state.matchRules, timeoutsPerPlayer: v } })}
              ariaLabel="타임아웃 횟수" />
            <NumberStepper label="타임아웃 시간 (초)" value={state.matchRules.timeoutDurationSeconds} min={30} max={120} step={10}
              onChange={v => dispatch({ type: 'SET_FIELD', field: 'matchRules', value: { ...state.matchRules, timeoutDurationSeconds: v } })}
              ariaLabel="타임아웃 시간" />
          </div>

          <div className="card p-4">
            <h3 className="text-lg font-bold mb-2">설정 미리보기</h3>
            <p className="text-cyan-400 font-semibold text-lg">
              {state.scoringRules.winScore}점 | {state.scoringRules.setsToWin}세트 선승 | 최대 {state.scoringRules.maxSets}세트 | {state.scoringRules.minLead}점차
              {state.scoringRules.deuceEnabled ? ' | 듀스 적용' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Step 3: 대회 형식 */}
      {state.step === 3 && (
        <div className="space-y-6">
          <div className="card space-y-4">
            <h2 className="text-xl font-bold">대회 진행 방식</h2>
            <div className="space-y-3" role="radiogroup" aria-label="대회 형식 선택">
              {FORMAT_OPTIONS.map(fmt => (
                <button key={fmt.value} role="radio" aria-checked={state.formatType === fmt.value}
                  className={`card w-full text-left p-4 border-2 ${state.formatType === fmt.value ? 'border-yellow-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'formatType', value: fmt.value })}>
                  <h3 className="text-lg font-bold">{fmt.label}</h3>
                  <p className="text-gray-400 text-sm">{fmt.description}</p>
                </button>
              ))}
            </div>
          </div>

          {state.formatType === 'group_knockout' && (
            <div className="card space-y-4">
              <h2 className="text-xl font-bold">조별리그 설정</h2>
              <NumberStepper label="조 수" value={state.groupCount} min={2} max={8}
                onChange={v => dispatch({ type: 'SET_FIELD', field: 'groupCount', value: v })} ariaLabel="조 수" />
            </div>
          )}
        </div>
      )}

      {/* Step 4: 확인 */}
      {state.step === 4 && (
        <div className="space-y-6">
          <div className="card space-y-4" role="region" aria-label="대회 설정 요약">
            <h2 className="text-2xl font-bold text-yellow-400">설정 확인</h2>
            <dl style={{ fontSize: '1.15rem' }}>
              {[
                ['대회명', state.name || '(미입력)'],
                ['날짜', state.date],
                ['유형', state.type === 'individual' ? '개인전' : state.type === 'team' ? '팀전' : '랜덤 팀리그전'],
                ['형식', FORMAT_OPTIONS.find(f => f.value === state.formatType)?.label || state.formatType],
                ['점수 규칙', `${state.scoringRules.winScore}점 | ${state.scoringRules.setsToWin}세트 선승 | ${state.scoringRules.minLead}점차${state.scoringRules.deuceEnabled ? ' | 듀스' : ''}`],
                ['타임아웃', `${state.matchRules.timeoutsPerPlayer}회 / ${state.matchRules.timeoutDurationSeconds}초`],
              ].map(([key, val]) => (
                <div key={key as string} className="flex justify-between py-2 border-b border-gray-700">
                  <dt className="text-gray-400">{key}</dt>
                  <dd className="font-bold text-white">{val}</dd>
                </div>
              ))}
            </dl>
          </div>
          {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-4">
        {state.step > 1 && (
          <button className="btn btn-secondary flex-1" onClick={() => dispatch({ type: 'PREV_STEP' })} aria-label="이전 단계">
            이전
          </button>
        )}
        {state.step < 4 ? (
          <button className="btn btn-primary flex-1" onClick={() => dispatch({ type: 'NEXT_STEP' })} aria-label="다음 단계">
            다음
          </button>
        ) : (
          <button className="btn btn-success flex-1" onClick={handleSubmit} disabled={saving} aria-label="대회 생성">
            {saving ? '생성 중...' : '대회 생성'}
          </button>
        )}
        <button className="btn btn-accent" onClick={() => navigate('/admin')} aria-label="취소">취소</button>
      </div>
    </div>
  );
}
