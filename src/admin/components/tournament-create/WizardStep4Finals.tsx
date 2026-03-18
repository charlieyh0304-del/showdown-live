import NumberStepper from './NumberStepper';
import type { ScoringRules, RankingMatchConfig } from '@shared/types';

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
    rankingMatch?: RankingMatchConfig;
    // context from prior steps
    hasGroupStage?: boolean;
    advanceCount?: number;
    participantCount?: number;
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

export default function WizardStep4Finals({ state, dispatch }: WizardStep4FinalsProps) {
  const advanceCount = state.advanceCount || 8;
  const rm = state.rankingMatch || { enabled: false, thirdPlace: true, fifthToEighth: false, fifthToEighthFormat: 'full' as const, classificationGroups: false, classificationGroupSize: 4 };

  const setField = (field: string, value: unknown) => {
    dispatch({ type: 'SET_FIELD', field, value });
  };

  const updateRankingMatch = (updates: Partial<RankingMatchConfig>) => {
    dispatch({ type: 'SET_FIELD', field: 'rankingMatch', value: { ...rm, ...updates } });
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
      {state.finalsFormat !== 'round_robin' && (
        <div className="card space-y-4">
          <h3 className="text-lg font-semibold mb-2">본선 시작 라운드</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { value: 32, label: '32강' },
              { value: 16, label: '16강' },
              { value: 8, label: '8강' },
              { value: 4, label: '4강' },
            ].filter(opt => {
              // 진출 인원보다 큰 라운드만 표시
              const ac = state.advanceCount || state.participantCount || 8;
              return opt.value <= ac * 2;
            }).map(opt => (
              <button
                key={opt.value}
                className={`btn py-3 text-lg ${state.finalsStartRound === opt.value ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'finalsStartRound', value: opt.value })}
                aria-pressed={state.finalsStartRound === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* BYE 안내 */}
          {advanceCount < state.finalsStartRound && (
            <p className="text-yellow-500 text-sm mt-2">
              진출 {advanceCount}명 / {state.finalsStartRound}강 → {state.finalsStartRound - advanceCount}명은 부전승(BYE) 처리됩니다
            </p>
          )}
        </div>
      )}

      {/* 예선과 동일 규칙 사용 */}
      <div className="card space-y-4">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-lg font-semibold">예선과 동일 규칙 사용</span>
          <button
            role="switch"
            aria-checked={state.sameRulesAsQualifying}
            aria-label="예선과 동일 규칙 사용"
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.sameRulesAsQualifying ? 'bg-green-600' : 'bg-gray-600'}`}
            onClick={() => setField('sameRulesAsQualifying', !state.sameRulesAsQualifying)}
          >
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.sameRulesAsQualifying ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </label>

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
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-lg font-semibold">듀스 적용</span>
              <button
                role="switch"
                aria-checked={state.finalsScoringRules.deuceEnabled}
                aria-label="듀스 적용"
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.finalsScoringRules.deuceEnabled ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() =>
                  setField('finalsScoringRules', {
                    ...state.finalsScoringRules,
                    deuceEnabled: !state.finalsScoringRules.deuceEnabled,
                  })
                }
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.finalsScoringRules.deuceEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>
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
          <label className="flex items-center justify-between cursor-pointer mt-4">
            <span className="text-lg font-semibold">같은 조 회피 편성</span>
            <button
              role="switch"
              aria-checked={state.avoidSameGroup}
              aria-label="같은 조 회피 편성"
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.avoidSameGroup ? 'bg-green-600' : 'bg-gray-600'}`}
              onClick={() => setField('avoidSameGroup', !state.avoidSameGroup)}
            >
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.avoidSameGroup ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </label>
        </div>
      )}

      {/* 3/4위 결정전 */}
      <div className="card">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-lg font-semibold">3/4위 결정전</span>
          <button
            role="switch"
            aria-checked={state.thirdPlaceMatch}
            aria-label="3/4위 결정전"
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.thirdPlaceMatch ? 'bg-green-600' : 'bg-gray-600'}`}
            onClick={() => setField('thirdPlaceMatch', !state.thirdPlaceMatch)}
          >
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.thirdPlaceMatch ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </label>
      </div>

      {/* 순위결정전 */}
      <div className="card space-y-4">
        <h2 className="text-xl font-bold">순위결정전</h2>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-lg font-semibold">순위결정전 진행</span>
          <button
            role="switch"
            aria-checked={state.hasRankingMatch}
            aria-label="순위결정전 진행"
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.hasRankingMatch ? 'bg-green-600' : 'bg-gray-600'}`}
            onClick={() => setField('hasRankingMatch', !state.hasRankingMatch)}
          >
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.hasRankingMatch ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </label>

        {state.hasRankingMatch && (
          <div className="space-y-4 mt-4 p-4 bg-gray-800 rounded-lg">
            {/* 5~8위 결정전 */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-semibold">5~8위 결정전</span>
              <button
                role="switch"
                aria-checked={rm.fifthToEighth ?? false}
                aria-label="5~8위 결정전"
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${rm.fifthToEighth ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => updateRankingMatch({ fifthToEighth: !rm.fifthToEighth })}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${rm.fifthToEighth ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>

            {rm.fifthToEighth && (
              <div className="ml-4 space-y-2">
                <h4 className="text-sm font-semibold text-gray-400">결정 방식</h4>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    className={`p-3 rounded-lg text-center text-sm border-2 ${
                      rm.fifthToEighthFormat === 'simple'
                        ? 'border-yellow-400 bg-gray-700'
                        : 'border-transparent bg-gray-700 hover:border-gray-600'
                    }`}
                    onClick={() => updateRankingMatch({ fifthToEighthFormat: 'simple' })}
                  >
                    <span className="block">간소화 (2경기)</span>
                    <span className="block text-xs opacity-75">5vs8, 6vs7</span>
                  </button>
                  <button
                    className={`p-3 rounded-lg text-center text-sm border-2 ${
                      rm.fifthToEighthFormat === 'full'
                        ? 'border-yellow-400 bg-gray-700'
                        : 'border-transparent bg-gray-700 hover:border-gray-600'
                    }`}
                    onClick={() => updateRankingMatch({ fifthToEighthFormat: 'full' })}
                  >
                    <span className="block">교차전 (4경기)</span>
                    <span className="block text-xs opacity-75">교차 → 순위전</span>
                  </button>
                  <button
                    className={`p-3 rounded-lg text-center text-sm border-2 ${
                      rm.fifthToEighthFormat === 'round_robin'
                        ? 'border-yellow-400 bg-gray-700'
                        : 'border-transparent bg-gray-700 hover:border-gray-600'
                    }`}
                    onClick={() => updateRankingMatch({ fifthToEighthFormat: 'round_robin' })}
                  >
                    <span className="block">풀리그 (6경기)</span>
                    <span className="block text-xs opacity-75">4명 라운드로빈</span>
                  </button>
                </div>
              </div>
            )}

            {/* IBSA 하위 순위 그룹 */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-semibold">하위 순위 그룹 결정전 (IBSA 방식)</span>
              <button
                role="switch"
                aria-checked={rm.classificationGroups ?? false}
                aria-label="하위 순위 그룹 결정전"
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${rm.classificationGroups ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => updateRankingMatch({ classificationGroups: !rm.classificationGroups })}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${rm.classificationGroups ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>
            {rm.classificationGroups && (
              <div className="ml-4">
                <NumberStepper
                  label="그룹 크기"
                  value={rm.classificationGroupSize || 4}
                  min={3}
                  max={8}
                  onChange={(v) => updateRankingMatch({ classificationGroupSize: v })}
                  ariaLabel="하위 순위 그룹 크기"
                />
              </div>
            )}

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
