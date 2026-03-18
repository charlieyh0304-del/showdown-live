import NumberStepper from './NumberStepper';
import type { ScoringRules } from '@shared/types';

interface WizardStep4FinalsProps {
  state: {
    finalsFormat: 'single_elimination' | 'double_elimination' | 'round_robin';
    finalsStartRound: number;
    finalsScoringRules: ScoringRules;
    sameRulesAsQualifying: boolean;
    bracketArrangement: 'cross_group' | 'sequential' | 'random';
    avoidSameGroup: boolean;
    thirdPlaceMatch: boolean;
    hasRankingMatch: boolean;
    rankingStartRank: number;
    rankingEndRank: number;
    rankingFormat: 'round_robin' | 'single_elimination';
    // context from prior steps
    hasGroupStage?: boolean;
    advanceCount?: number;
    scoringRules?: ScoringRules;
  };
  dispatch: (action: { type: 'SET_FIELD'; field: string; value: unknown }) => void;
}

const FORMAT_CARDS: {
  value: 'single_elimination' | 'double_elimination' | 'round_robin';
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    value: 'single_elimination',
    label: '싱글 엘리미네이션',
    icon: '🏆',
    description: '패배 시 즉시 탈락. 빠르고 긴장감 있는 진행.',
  },
  {
    value: 'double_elimination',
    label: '더블 엘리미네이션',
    icon: '🔄',
    description: '2패 시 탈락. 한 번의 패배로 기회를 잃지 않습니다.',
  },
  {
    value: 'round_robin',
    label: '라운드 로빈',
    icon: '🔁',
    description: '모든 참가자가 서로 경기. 가장 공정한 방식.',
  },
];

const ARRANGEMENT_OPTIONS: {
  value: 'cross_group' | 'sequential' | 'random';
  label: string;
  description: string;
}[] = [
  { value: 'cross_group', label: '조 교차', description: 'A조 1위 vs B조 2위 형태' },
  { value: 'sequential', label: '순차 배치', description: '순위 순서대로 배치' },
  { value: 'random', label: '랜덤', description: '무작위 대진 편성' },
];

function getRoundLabel(round: number): string {
  if (round === 2) return '결승';
  if (round === 4) return '4강';
  if (round === 8) return '8강';
  if (round === 16) return '16강';
  if (round === 32) return '32강';
  return `${round}강`;
}

function getAvailableRounds(advanceCount: number): number[] {
  const rounds: number[] = [];
  let r = 2;
  while (r <= 32) {
    if (r <= advanceCount) {
      rounds.push(r);
    }
    r *= 2;
  }
  return rounds.sort((a, b) => b - a);
}

function getDefaultStartRound(advanceCount: number): number {
  let r = 2;
  while (r * 2 <= advanceCount) {
    r *= 2;
  }
  return r;
}

export default function WizardStep4Finals({ state, dispatch }: WizardStep4FinalsProps) {
  const advanceCount = state.advanceCount || 8;
  const availableRounds = getAvailableRounds(advanceCount);
  const startRound = state.finalsStartRound || getDefaultStartRound(advanceCount);

  const setField = (field: string, value: unknown) => {
    dispatch({ type: 'SET_FIELD', field, value });
  };

  return (
    <div className="space-y-6">
      {/* 본선 형식 선택 */}
      <div className="card space-y-4">
        <h2 className="text-xl font-bold">본선 형식</h2>
        <div
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          role="radiogroup"
          aria-label="본선 형식 선택"
        >
          {FORMAT_CARDS.map((fmt) => (
            <button
              key={fmt.value}
              role="radio"
              aria-checked={state.finalsFormat === fmt.value}
              className={`card text-left p-4 border-2 ${
                state.finalsFormat === fmt.value
                  ? 'border-yellow-400 bg-gray-800'
                  : 'border-transparent hover:border-gray-600'
              }`}
              onClick={() => setField('finalsFormat', fmt.value)}
              aria-label={fmt.label}
            >
              <div className="text-2xl mb-1" aria-hidden="true">
                {fmt.icon}
              </div>
              <h3 className="text-lg font-bold">{fmt.label}</h3>
              <p className="text-gray-400 text-sm">{fmt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 본선 시작 강 */}
      {state.finalsFormat !== 'round_robin' && availableRounds.length > 0 && (
        <div className="card space-y-4">
          <h2 className="text-xl font-bold">본선 시작 강</h2>
          <select
            className="input"
            value={startRound}
            onChange={(e) => setField('finalsStartRound', Number(e.target.value))}
            aria-label="본선 시작 라운드"
          >
            {availableRounds.map((r) => (
              <option key={r} value={r}>
                {getRoundLabel(r)}
              </option>
            ))}
          </select>
          <p className="text-gray-400 text-sm">
            진출 인원: {advanceCount}명 → {getRoundLabel(startRound)}부터 시작
          </p>
        </div>
      )}

      {/* 예선과 동일 규칙 사용 */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-lg font-semibold">예선과 동일 규칙 사용</label>
          <button
            className={`btn ${
              state.sameRulesAsQualifying ? 'btn-success' : 'bg-gray-700 text-white'
            }`}
            onClick={() => setField('sameRulesAsQualifying', !state.sameRulesAsQualifying)}
            aria-pressed={state.sameRulesAsQualifying}
            aria-label="예선과 동일 규칙 사용 토글"
          >
            {state.sameRulesAsQualifying ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* 본선 스코어링 규칙 (sameRulesAsQualifying=false 일 때) */}
        {!state.sameRulesAsQualifying && (
          <div className="space-y-4 mt-4 p-4 bg-gray-800 rounded-lg">
            <h3 className="text-lg font-bold text-cyan-400">본선 스코어링 규칙</h3>
            <NumberStepper
              label="승리 점수"
              value={state.finalsScoringRules.winScore}
              min={3}
              max={51}
              onChange={(v) =>
                setField('finalsScoringRules', {
                  ...state.finalsScoringRules,
                  winScore: v,
                })
              }
              ariaLabel="본선 승리 점수"
            />
            <NumberStepper
              label="세트 선승"
              value={state.finalsScoringRules.setsToWin}
              min={1}
              max={5}
              onChange={(v) =>
                setField('finalsScoringRules', {
                  ...state.finalsScoringRules,
                  setsToWin: v,
                  maxSets: v * 2 - 1,
                })
              }
              ariaLabel="본선 선승 세트 수"
            />
            <NumberStepper
              label="최소 점수차"
              value={state.finalsScoringRules.minLead}
              min={0}
              max={5}
              onChange={(v) =>
                setField('finalsScoringRules', {
                  ...state.finalsScoringRules,
                  minLead: v,
                })
              }
              ariaLabel="본선 최소 점수차"
            />
            <div className="flex items-center gap-4">
              <label className="text-lg font-semibold">듀스 적용</label>
              <button
                className={`btn ${
                  state.finalsScoringRules.deuceEnabled
                    ? 'btn-success'
                    : 'bg-gray-700 text-white'
                }`}
                onClick={() =>
                  setField('finalsScoringRules', {
                    ...state.finalsScoringRules,
                    deuceEnabled: !state.finalsScoringRules.deuceEnabled,
                  })
                }
                aria-pressed={state.finalsScoringRules.deuceEnabled}
                aria-label="본선 듀스 적용 토글"
              >
                {state.finalsScoringRules.deuceEnabled ? '적용' : '미적용'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 편성 방식 (조별 예선이 있을 때만) */}
      {state.hasGroupStage && (
        <div className="card space-y-4">
          <h2 className="text-xl font-bold">대진 편성 방식</h2>
          <div
            className="space-y-3"
            role="radiogroup"
            aria-label="대진 편성 방식 선택"
          >
            {ARRANGEMENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                role="radio"
                aria-checked={state.bracketArrangement === opt.value}
                className={`card w-full text-left p-4 border-2 ${
                  state.bracketArrangement === opt.value
                    ? 'border-yellow-400 bg-gray-800'
                    : 'border-transparent hover:border-gray-600'
                }`}
                onClick={() => setField('bracketArrangement', opt.value)}
                aria-label={opt.label}
              >
                <h3 className="text-lg font-bold">{opt.label}</h3>
                <p className="text-gray-400 text-sm">{opt.description}</p>
              </button>
            ))}
          </div>

          {/* 같은 조 회피 */}
          <div className="flex items-center justify-between mt-4">
            <label className="text-lg font-semibold">같은 조 회피</label>
            <button
              className={`btn ${
                state.avoidSameGroup ? 'btn-success' : 'bg-gray-700 text-white'
              }`}
              onClick={() => setField('avoidSameGroup', !state.avoidSameGroup)}
              aria-pressed={state.avoidSameGroup}
              aria-label="같은 조 회피 토글"
            >
              {state.avoidSameGroup ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      )}

      {/* 3/4위 결정전 */}
      <div className="card">
        <div className="flex items-center justify-between">
          <label className="text-lg font-semibold">3/4위 결정전</label>
          <button
            className={`btn ${
              state.thirdPlaceMatch ? 'btn-success' : 'bg-gray-700 text-white'
            }`}
            onClick={() => setField('thirdPlaceMatch', !state.thirdPlaceMatch)}
            aria-pressed={state.thirdPlaceMatch}
            aria-label="3/4위 결정전 토글"
          >
            {state.thirdPlaceMatch ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* 순위결정전 */}
      <div className="card space-y-4">
        <h2 className="text-xl font-bold">순위결정전</h2>
        <div className="flex items-center justify-between">
          <label className="text-lg font-semibold">순위결정전 진행</label>
          <button
            className={`btn ${
              state.hasRankingMatch ? 'btn-success' : 'bg-gray-700 text-white'
            }`}
            onClick={() => setField('hasRankingMatch', !state.hasRankingMatch)}
            aria-pressed={state.hasRankingMatch}
            aria-label="순위결정전 진행 토글"
          >
            {state.hasRankingMatch ? 'ON' : 'OFF'}
          </button>
        </div>

        {state.hasRankingMatch && (
          <div className="space-y-4 mt-4 p-4 bg-gray-800 rounded-lg">
            <h3 className="text-lg font-bold text-cyan-400">순위 범위</h3>
            <div className="grid grid-cols-2 gap-4">
              <NumberStepper
                label="시작 순위"
                value={state.rankingStartRank}
                min={3}
                max={advanceCount}
                onChange={(v) => setField('rankingStartRank', v)}
                ariaLabel="순위결정전 시작 순위"
              />
              <NumberStepper
                label="끝 순위"
                value={state.rankingEndRank}
                min={state.rankingStartRank}
                max={advanceCount}
                onChange={(v) => setField('rankingEndRank', v)}
                ariaLabel="순위결정전 끝 순위"
              />
            </div>
            <p className="text-gray-400 text-sm">
              {state.rankingStartRank}위 ~ {state.rankingEndRank}위 순위를 결정합니다.
            </p>

            <h3 className="text-lg font-bold text-cyan-400 mt-4">순위결정전 형식</h3>
            <div
              className="grid grid-cols-2 gap-3"
              role="radiogroup"
              aria-label="순위결정전 형식 선택"
            >
              {([
                { value: 'round_robin' as const, label: '라운드 로빈' },
                { value: 'single_elimination' as const, label: '싱글 엘리미네이션' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  role="radio"
                  aria-checked={state.rankingFormat === opt.value}
                  className={`btn text-lg py-3 ${
                    state.rankingFormat === opt.value
                      ? 'btn-primary'
                      : 'bg-gray-700 text-white'
                  }`}
                  onClick={() => setField('rankingFormat', opt.value)}
                  aria-label={`순위결정전 ${opt.label}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
