import type {
  TournamentType,
  BracketFormatType,
  ScoringRules,
  MatchRules,
  TeamRules,
  RankingMatchConfig,
} from '@shared/types';
import { calculateMatchCount } from '@shared/utils/tournament';

// ===== 위자드 상태 타입 =====

export interface TournamentWizardState {
  step: 1 | 2 | 3 | 4 | 5;
  // Step 1: 기본 정보
  name: string;
  date: string;
  type: TournamentType;
  presetId: string | null;
  // Step 2: 참가자
  participantCount: number;
  participantNames: string[];
  // Step 3: 예선 설정
  hasGroupStage: boolean;
  groupCount: number;
  qualifyingFormat: 'round_robin' | 'group_round_robin';
  qualifyingScoringRules: ScoringRules;
  qualifyingMatchRules: MatchRules;
  advancePerGroup: number;
  // Step 4: 본선/순위결정전 설정
  hasFinalsStage: boolean;
  finalsFormat: 'single_elimination' | 'double_elimination';
  advanceCount: number;
  startingRound: number;
  seedMethod: 'ranking' | 'manual' | 'random';
  finalsScoringRules: ScoringRules;
  finalsMatchRules: MatchRules;
  hasThirdPlaceMatch: boolean;
  rankingMatch: RankingMatchConfig;
  // 공통
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules: TeamRules;
  formatType: BracketFormatType;
  useCustomRules: boolean;
}

export type WizardAction =
  | { type: 'SET_FIELD'; field: string; value: unknown }
  | { type: 'APPLY_PRESET'; presetId: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GO_TO_STEP'; step: 1 | 2 | 3 | 4 | 5 };

// ===== 헬퍼 =====

function getTypeLabel(type: TournamentType): string {
  switch (type) {
    case 'individual': return '개인전';
    case 'team': return '팀전';
    case 'randomTeamLeague': return '랜덤 팀리그전';
    default: return type;
  }
}

function getFormatLabel(format: BracketFormatType): string {
  const map: Record<BracketFormatType, string> = {
    round_robin: '풀리그 (라운드로빈)',
    single_elimination: '싱글 엘리미네이션',
    double_elimination: '더블 엘리미네이션',
    swiss: '스위스 시스템',
    group_knockout: '조별리그 + 토너먼트',
  };
  return map[format] || format;
}

function getStartingRoundLabel(round: number): string {
  switch (round) {
    case 2: return '결승';
    case 4: return '4강';
    case 8: return '8강';
    case 16: return '16강';
    case 32: return '32강';
    default: return `${round}강`;
  }
}

function getSeedMethodLabel(method: string): string {
  switch (method) {
    case 'ranking': return '순위 기반';
    case 'manual': return '수동 배정';
    case 'random': return '랜덤';
    default: return method;
  }
}

function formatScoringRules(rules: ScoringRules): string {
  return `${rules.winScore}점 | ${rules.setsToWin}세트 선승 | 최대 ${rules.maxSets}세트 | ${rules.minLead}점차${rules.deuceEnabled ? ' | 듀스' : ''}`;
}

function formatMatchRules(rules: MatchRules): string {
  return `타임아웃 ${rules.timeoutsPerPlayer}회 / ${rules.timeoutDurationSeconds}초`;
}

// ===== 컴포넌트 =====

interface WizardStep5Props {
  state: TournamentWizardState;
  dispatch: React.Dispatch<WizardAction>;
  onSubmit: () => void;
}

function SectionHeader({
  title,
  step,
  dispatch,
}: {
  title: string;
  step: 1 | 2 | 3 | 4 | 5;
  dispatch: React.Dispatch<WizardAction>;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-lg font-bold text-yellow-400">{title}</h3>
      <button
        className="text-sm text-cyan-400 hover:text-cyan-300 underline"
        onClick={() => dispatch({ type: 'GO_TO_STEP', step })}
        aria-label={`${title} 수정 (${step}단계로 이동)`}
      >
        수정
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-700 last:border-b-0">
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-semibold text-white text-right">{value}</dd>
    </div>
  );
}

export default function WizardStep5Preview({ state, dispatch, onSubmit }: WizardStep5Props) {
  const matchCounts = calculateMatchCount(
    state.participantCount,
    state.hasGroupStage,
    state.groupCount,
    state.hasFinalsStage,
    state.advanceCount,
    state.rankingMatch.enabled,
    state.rankingMatch.thirdPlace,
    state.rankingMatch.fifthPlace,
  );

  const perGroup = state.groupCount > 0
    ? Math.ceil(state.participantCount / state.groupCount)
    : state.participantCount;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-yellow-400">설정 확인 및 미리보기</h2>

      {/* 1. 대회 기본 정보 */}
      <section className="card p-5" aria-label="대회 기본 정보">
        <SectionHeader title="대회 기본 정보" step={1} dispatch={dispatch} />
        <dl>
          <SummaryRow label="대회명" value={state.name || '(미입력)'} />
          <SummaryRow label="날짜" value={state.date} />
          <SummaryRow label="유형" value={getTypeLabel(state.type)} />
          <SummaryRow label="참가자 수" value={`${state.participantCount}명`} />
        </dl>
      </section>

      {/* 2. 대회 구조 시각화 */}
      <section className="card p-5" aria-label="대회 구조">
        <h3 className="text-lg font-bold text-yellow-400 mb-4">대회 구조</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2" role="list" aria-label="스테이지 흐름">
          {state.hasGroupStage && (
            <>
              <div
                className="flex-shrink-0 rounded-lg border-2 border-cyan-500 bg-gray-800 p-3 text-center min-w-[140px]"
                role="listitem"
              >
                <div className="text-sm text-cyan-400 font-semibold">예선</div>
                <div className="text-white font-bold mt-1">
                  {state.groupCount > 1
                    ? `${state.groupCount}조 조별리그`
                    : '풀리그'}
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {state.participantCount}명
                </div>
                {state.groupCount > 1 && (
                  <div className="text-gray-500 text-xs mt-0.5">
                    조당 ~{perGroup}명
                  </div>
                )}
              </div>
              {state.hasFinalsStage && (
                <div className="text-2xl text-gray-500 flex-shrink-0" aria-hidden="true">→</div>
              )}
            </>
          )}

          {state.hasFinalsStage && (
            <>
              <div
                className="flex-shrink-0 rounded-lg border-2 border-yellow-500 bg-gray-800 p-3 text-center min-w-[140px]"
                role="listitem"
              >
                <div className="text-sm text-yellow-400 font-semibold">본선</div>
                <div className="text-white font-bold mt-1">
                  {getStartingRoundLabel(state.startingRound)} 토너먼트
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {state.advanceCount}명 진출
                </div>
              </div>

              {state.rankingMatch.enabled && (
                <>
                  <div className="text-2xl text-gray-500 flex-shrink-0" aria-hidden="true">→</div>
                  <div
                    className="flex-shrink-0 rounded-lg border-2 border-orange-500 bg-gray-800 p-3 text-center min-w-[140px]"
                    role="listitem"
                  >
                    <div className="text-sm text-orange-400 font-semibold">순위결정전</div>
                    <div className="text-white font-bold mt-1">
                      {state.rankingMatch.thirdPlace && state.rankingMatch.fifthPlace
                        ? '3-8위'
                        : state.rankingMatch.thirdPlace
                          ? '3-4위'
                          : '순위전'}
                    </div>
                    <div className="text-gray-400 text-sm mt-1">
                      {(state.rankingMatch.thirdPlace ? 2 : 0) + (state.rankingMatch.fifthPlace ? 4 : 0)}명
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {!state.hasGroupStage && !state.hasFinalsStage && (
            <div
              className="flex-shrink-0 rounded-lg border-2 border-cyan-500 bg-gray-800 p-3 text-center min-w-[140px]"
              role="listitem"
            >
              <div className="text-sm text-cyan-400 font-semibold">단일 스테이지</div>
              <div className="text-white font-bold mt-1">{getFormatLabel(state.formatType)}</div>
              <div className="text-gray-400 text-sm mt-1">{state.participantCount}명</div>
            </div>
          )}
        </div>
      </section>

      {/* 3. 예선 설정 요약 */}
      {state.hasGroupStage && (
        <section className="card p-5" aria-label="예선 설정">
          <SectionHeader title="예선 설정" step={3} dispatch={dispatch} />
          <dl>
            <SummaryRow label="형식" value={state.groupCount > 1 ? '조별 라운드로빈' : '풀리그'} />
            {state.groupCount > 1 && (
              <>
                <SummaryRow label="조 수" value={`${state.groupCount}조`} />
                <SummaryRow label="조당 인원" value={`~${perGroup}명`} />
                <SummaryRow label="조별 진출 수" value={`${state.advancePerGroup}명`} />
              </>
            )}
            <SummaryRow label="경기 규칙" value={formatScoringRules(state.qualifyingScoringRules)} />
            <SummaryRow label="타임아웃" value={formatMatchRules(state.qualifyingMatchRules)} />
            <SummaryRow label="예상 경기 수" value={`${matchCounts.qualifying}경기`} />
          </dl>
        </section>
      )}

      {/* 4. 본선 설정 요약 */}
      {state.hasFinalsStage && (
        <section className="card p-5" aria-label="본선 설정">
          <SectionHeader title="본선 설정" step={4} dispatch={dispatch} />
          <dl>
            <SummaryRow
              label="형식"
              value={state.finalsFormat === 'single_elimination' ? '싱글 엘리미네이션' : '더블 엘리미네이션'}
            />
            <SummaryRow label="시작" value={getStartingRoundLabel(state.startingRound)} />
            <SummaryRow label="편성 방식" value={getSeedMethodLabel(state.seedMethod)} />
            <SummaryRow label="경기 규칙" value={formatScoringRules(state.finalsScoringRules)} />
            <SummaryRow label="타임아웃" value={formatMatchRules(state.finalsMatchRules)} />
            <SummaryRow label="3/4위 결정전" value={state.hasThirdPlaceMatch ? '있음' : '없음'} />
            <SummaryRow label="예상 경기 수" value={`${matchCounts.finals}경기`} />
          </dl>
        </section>
      )}

      {/* 5. 순위결정전 요약 */}
      {state.hasFinalsStage && state.rankingMatch.enabled && (
        <section className="card p-5" aria-label="순위결정전 설정">
          <SectionHeader title="순위결정전" step={4} dispatch={dispatch} />
          <dl>
            <SummaryRow
              label="순위 범위"
              value={
                state.rankingMatch.thirdPlace && state.rankingMatch.fifthPlace
                  ? '3위~8위'
                  : state.rankingMatch.thirdPlace
                    ? '3위~4위'
                    : '순위결정전'
              }
            />
            <SummaryRow label="3/4위전" value={state.rankingMatch.thirdPlace ? '진행' : '미진행'} />
            <SummaryRow label="5/6위전" value={state.rankingMatch.fifthPlace ? '진행' : '미진행'} />
            <SummaryRow label="예상 경기 수" value={`${matchCounts.ranking}경기`} />
          </dl>
        </section>
      )}

      {/* 6. 총 예상 경기 수 */}
      <section className="card p-5 bg-gray-800 border-2 border-yellow-500" aria-label="총 경기 수 요약">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-bold text-yellow-400">총 예상 경기 수</h3>
          <span className="text-3xl font-bold text-white">{matchCounts.total}경기</span>
        </div>
        {(state.hasGroupStage || state.hasFinalsStage) && (
          <div className="flex gap-4 mt-2 text-sm text-gray-400">
            {state.hasGroupStage && <span>예선: {matchCounts.qualifying}</span>}
            {state.hasFinalsStage && <span>본선: {matchCounts.finals}</span>}
            {matchCounts.ranking > 0 && <span>순위결정전: {matchCounts.ranking}</span>}
          </div>
        )}
      </section>

      {/* 7. 생성 버튼 */}
      <button
        className="btn btn-success btn-large w-full text-xl py-4"
        onClick={onSubmit}
        aria-label="대회 생성"
      >
        대회 생성
      </button>
    </div>
  );
}
