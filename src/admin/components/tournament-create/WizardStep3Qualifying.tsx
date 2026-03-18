import type { ScoringRules, TiebreakerRule } from '../../../shared/types';
import NumberStepper from './NumberStepper';

interface WizardStepProps {
  state: {
    type: 'individual' | 'team' | 'randomTeamLeague';
    participantCount: number;
    groupCount: number;
    hasGroupStage: boolean;
    qualifyingScoringRules: ScoringRules;
    advanceCount: number;
    tiebreakerRules: TiebreakerRule[];
  };
  dispatch: React.Dispatch<any>;
}

const TIEBREAKER_LABELS: Record<TiebreakerRule, string> = {
  head_to_head: '직접 대결 결과',
  set_difference: '세트 득실차',
  point_difference: '점수 득실차',
  points_for: '총 득점',
};

const WIN_SCORE_QUICK_BUTTONS = [7, 11, 21, 31];

export default function WizardStep3Qualifying({ state, dispatch }: WizardStepProps) {
  const { qualifyingScoringRules: rules, groupCount, advanceCount, tiebreakerRules } = state;

  const groupSize = groupCount > 0
    ? Math.floor(state.participantCount / groupCount)
    : state.participantCount;

  const totalAdvance = groupCount * advanceCount;

  const updateScoringRule = <K extends keyof ScoringRules>(field: K, value: ScoringRules[K]) => {
    dispatch({
      type: 'SET_FIELD',
      field: 'qualifyingScoringRules',
      value: { ...rules, [field]: value },
    });
  };

  const moveTiebreaker = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= tiebreakerRules.length) return;
    const next = [...tiebreakerRules];
    [next[index], next[target]] = [next[target], next[index]];
    dispatch({ type: 'SET_FIELD', field: 'tiebreakerRules', value: next });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h2 className="text-xl font-bold">예선(조별리그) 경기 규칙</h2>

      {/* 승리 점수 */}
      <div>
        <NumberStepper
          label="승리 점수"
          value={rules.winScore}
          min={3}
          max={51}
          onChange={(v) => updateScoringRule('winScore', v)}
          ariaLabel="승리 점수"
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          {WIN_SCORE_QUICK_BUTTONS.map((score) => (
            <button
              key={score}
              className={`btn ${rules.winScore === score ? 'btn-warning' : 'btn-secondary'}`}
              style={{ minWidth: '48px' }}
              onClick={() => updateScoringRule('winScore', score)}
              aria-label={`승리 점수 ${score}점으로 설정`}
            >
              {score}
            </button>
          ))}
        </div>
      </div>

      {/* 세트 선승 */}
      <NumberStepper
        label="세트 선승"
        value={rules.setsToWin}
        min={1}
        max={5}
        onChange={(v) => {
          updateScoringRule('setsToWin', v);
          dispatch({
            type: 'SET_FIELD',
            field: 'qualifyingScoringRules',
            value: { ...rules, setsToWin: v, maxSets: v * 2 - 1 },
          });
        }}
        ariaLabel="세트 선승"
      />

      {/* 최소 점수차 */}
      <NumberStepper
        label="최소 점수차"
        value={rules.minLead}
        min={0}
        max={5}
        onChange={(v) => updateScoringRule('minLead', v)}
        ariaLabel="최소 점수차"
      />

      {/* 듀스 적용 */}
      <div>
        <label className="block mb-2 font-semibold text-lg">듀스 적용</label>
        <button
          className={`btn ${rules.deuceEnabled ? 'btn-success' : 'btn-secondary'}`}
          style={{ minWidth: '80px', height: '48px', fontSize: '1.1rem' }}
          onClick={() => updateScoringRule('deuceEnabled', !rules.deuceEnabled)}
          aria-label={`듀스 ${rules.deuceEnabled ? '해제' : '적용'}`}
          aria-pressed={rules.deuceEnabled}
        >
          {rules.deuceEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* 조별 진출 인원 */}
      <NumberStepper
        label="조별 진출 인원"
        value={advanceCount}
        min={1}
        max={Math.max(1, groupSize)}
        onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'advanceCount', value: v })}
        ariaLabel="조별 진출 인원"
      />

      {/* 본선 진출 총 인원 */}
      <div>
        <label className="block mb-2 font-semibold text-lg">본선 진출 총 인원</label>
        <span
          style={{ fontSize: '2.5rem', fontWeight: 'bold', display: 'inline-block', minWidth: '80px', textAlign: 'center' }}
          aria-label={`본선 진출 총 인원: ${totalAdvance}명`}
          aria-live="polite"
        >
          {totalAdvance}명
        </span>
        <p className="text-sm text-gray-400" aria-hidden="true">
          {groupCount}조 x {advanceCount}명 = {totalAdvance}명
        </p>
      </div>

      {/* 동률 처리 우선순위 */}
      <div>
        <label className="block mb-2 font-semibold text-lg">동률 처리 우선순위</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {tiebreakerRules.map((rule, index) => (
            <div
              key={rule}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                backgroundColor: '#1f2937',
                borderRadius: '8px',
              }}
            >
              <span style={{ fontWeight: 'bold', minWidth: '24px', color: '#9ca3af' }}>
                {index + 1}.
              </span>
              <span style={{ flex: 1 }}>{TIEBREAKER_LABELS[rule]}</span>
              <button
                className="btn btn-secondary"
                style={{ width: '40px', height: '40px', padding: 0 }}
                onClick={() => moveTiebreaker(index, -1)}
                disabled={index === 0}
                aria-label={`${TIEBREAKER_LABELS[rule]} 우선순위 올리기`}
              >
                ▲
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: '40px', height: '40px', padding: 0 }}
                onClick={() => moveTiebreaker(index, 1)}
                disabled={index === tiebreakerRules.length - 1}
                aria-label={`${TIEBREAKER_LABELS[rule]} 우선순위 내리기`}
              >
                ▼
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
