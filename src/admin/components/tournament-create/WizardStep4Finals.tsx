import NumberStepper from './NumberStepper';

interface WizardStep4FinalsProps {
  state: {
    finalsFormat: 'single_elimination' | 'double_elimination' | 'round_robin';
    finalsStartRound: number;
    bracketArrangement: 'cross_group' | 'sequential' | 'random';
    avoidSameGroup: boolean;
    thirdPlaceMatch: boolean;
    hasRankingMatch: boolean;
    rankingStartRank: number;
    rankingEndRank: number;
    rankingFormat: 'round_robin' | 'single_elimination';
    fifthToEighth: boolean;
    fifthToEighthFormat: 'simple' | 'full' | 'round_robin';
    classificationGroups: boolean;
    classificationGroupSize: number;
    // context from prior steps
    hasGroupStage?: boolean;
    advanceCount?: number;
    participantCount?: number;
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

  const setField = (field: string, value: unknown) => {
    dispatch({ type: 'SET_FIELD', field, value });
  };

  return (
    <div className="space-y-6">
      {/* 본선 형식 선택 */}
      <div className="card space-y-4">
        <h2 className="text-xl font-bold">{state.hasGroupStage ? '본선 형식' : '대회 형식'}</h2>
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
                aria-checked={state.fifthToEighth}
                aria-label="5~8위 결정전"
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.fifthToEighth ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => setField('fifthToEighth', !state.fifthToEighth)}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.fifthToEighth ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>

            {state.fifthToEighth && (
              <div className="ml-4 space-y-2">
                <h4 className="text-sm font-semibold text-gray-400">결정 방식</h4>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="5~8위 결정 방식">
                  {([
                    { value: 'simple' as const, label: '간소화 (2경기)', desc: '5vs8, 6vs7' },
                    { value: 'full' as const, label: '교차전 (4경기)', desc: '교차 → 순위전' },
                    { value: 'round_robin' as const, label: '풀리그 (6경기)', desc: '4명 라운드로빈' },
                  ]).map(opt => {
                    const selected = state.fifthToEighthFormat === opt.value;
                    return (
                      <button
                        key={opt.value}
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${opt.label} ${opt.desc}`}
                        className={`p-3 rounded-lg text-center text-sm font-semibold transition-all ${
                          selected
                            ? 'bg-yellow-500 text-black border-2 border-yellow-300 shadow-lg'
                            : 'bg-gray-700 text-gray-300 border-2 border-gray-600 hover:bg-gray-600'
                        }`}
                        onClick={() => setField('fifthToEighthFormat', opt.value)}
                      >
                        <span className="block">{selected ? '✓ ' : ''}{opt.label}</span>
                        <span className="block text-xs mt-1" style={{ opacity: selected ? 1 : 0.6 }}>{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  현재 선택: <span className="text-yellow-400 font-bold">
                    {state.fifthToEighthFormat === 'simple' ? '간소화 (2경기)' : state.fifthToEighthFormat === 'full' ? '교차전 (4경기)' : '풀리그 (6경기)'}
                  </span>
                </p>
              </div>
            )}

            {/* IBSA 하위 순위 그룹 */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-semibold">하위 순위 그룹 결정전 (IBSA 방식)</span>
              <button
                role="switch"
                aria-checked={state.classificationGroups}
                aria-label="하위 순위 그룹 결정전"
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.classificationGroups ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => setField('classificationGroups', !state.classificationGroups)}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.classificationGroups ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>
            {state.classificationGroups && (
              <div className="ml-4">
                <NumberStepper
                  label="그룹 크기"
                  value={state.classificationGroupSize}
                  min={3}
                  max={8}
                  onChange={(v) => setField('classificationGroupSize', v)}
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
