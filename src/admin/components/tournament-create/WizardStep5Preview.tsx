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
  step: 1 | 2 | 3 | 4;
  // Step 1: 기본 정보
  name: string;
  date: string;
  type: TournamentType;
  presetId: string | null;
  // Step 2: 참가자
  tournamentMode: 'full_league_all' | 'group_tournament' | 'direct_tournament' | 'manual';
  participantCount: number;
  participantNames: string[];
  hasGroupStage: boolean;
  groupCount: number;
  qualifyingFormat: 'round_robin' | 'group_round_robin';
  qualifyingScoringRules: ScoringRules;
  qualifyingMatchRules: MatchRules;
  advancePerGroup: number;
  // Step 3: 본선/순위결정전 설정 (was Step 4)
  hasFinalsStage: boolean;
  finalsFormat: 'single_elimination' | 'double_elimination';
  advanceCount: number;
  startingRound: number;
  seedMethod: 'ranking' | 'manual' | 'custom';
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
  // 대진 편성
  bracketArrangement: 'cross_group' | 'sequential' | 'custom';
  hasRoundScoringOverride?: boolean;
  roundOverrideFromRound?: number;
  roundOverrideSetsToWin?: number;
  roundOverrideMaxSets?: number;
  customPairings?: Array<{ position: number; slot1: string; slot2: string }>;
}

export type WizardAction =
  | { type: 'SET_FIELD'; field: string; value: unknown }
  | { type: 'APPLY_PRESET'; presetId: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GO_TO_STEP'; step: 1 | 2 | 3 | 4 };

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
    manual: '완전 수동 설정',
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
    case 'custom': return '커스텀 배정';
    default: return method;
  }
}

function getBracketArrangementLabel(arrangement: string): string {
  switch (arrangement) {
    case 'cross_group': return '교차 배정';
    case 'sequential': return '순차 배치';
    case 'custom': return '커스텀 배정';
    default: return arrangement;
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
  step: 1 | 2 | 3 | 4;
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
  // 풀리그 단독 형식: 조별 예선 없이 라운드로빈만 진행
  const isRoundRobinOnly = state.tournamentMode === 'full_league_all' || (state.formatType === 'round_robin' && !state.hasGroupStage);

  // 팀전에서 실제 경기 참여 단위 수 계산
  const isTeamType = state.type === 'team' || state.type === 'randomTeamLeague';
  const effectiveCount = state.type === 'randomTeamLeague'
    ? Math.floor(state.participantCount / (state.teamRules?.teamSize ?? 3))
    : state.participantCount;
  const unitLabel = isTeamType ? '팀' : '명';

  const matchCounts = calculateMatchCount(
    effectiveCount,
    state.hasGroupStage,
    state.groupCount,
    state.hasFinalsStage,
    state.advanceCount,
    state.rankingMatch,
    state.startingRound,
  );

  const perGroup = state.groupCount > 0
    ? Math.ceil(effectiveCount / state.groupCount)
    : effectiveCount;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-yellow-400">설정 확인 및 미리보기</h2>

      {/* 수동 모드 배너 */}
      {state.tournamentMode === 'manual' && (
        <div className="card p-4 bg-yellow-900/20 border-2 border-yellow-500/40">
          <p className="text-yellow-400 font-bold text-lg">완전 수동 모드</p>
          <p className="text-gray-300 text-sm mt-1">
            조 편성과 대진 배정을 대회 상세에서 직접 수행합니다.
          </p>
        </div>
      )}

      {/* 1. 대회 기본 정보 */}
      <section className="card p-5" aria-label="대회 기본 정보">
        <SectionHeader title="대회 기본 정보" step={1} dispatch={dispatch} />
        <dl>
          <SummaryRow label="대회명" value={state.name || '(미입력)'} />
          <SummaryRow label="날짜" value={state.date} />
          <SummaryRow label="유형" value={getTypeLabel(state.type)} />
          <SummaryRow label={isTeamType ? '팀 수' : '참가자 수'} value={`${effectiveCount}${unitLabel}`} />
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
                <div className="text-sm text-cyan-400 font-semibold">예선{state.tournamentMode === 'manual' ? ' (수동)' : ''}</div>
                <div className="text-white font-bold mt-1">
                  {state.groupCount > 1
                    ? `${state.groupCount}조 조별리그`
                    : '풀리그'}
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {effectiveCount}{unitLabel}
                </div>
                {state.groupCount > 1 && (
                  <div className="text-gray-400 text-xs mt-0.5">
                    조당 ~{perGroup}{unitLabel}
                  </div>
                )}
              </div>
              {state.hasFinalsStage && (
                <div className="text-2xl text-gray-400 flex-shrink-0" aria-hidden="true">→</div>
              )}
            </>
          )}

          {state.hasFinalsStage && !isRoundRobinOnly && (
            <>
              <div
                className="flex-shrink-0 rounded-lg border-2 border-yellow-500 bg-gray-800 p-3 text-center min-w-[140px]"
                role="listitem"
              >
                <div className="text-sm text-yellow-400 font-semibold">본선{state.tournamentMode === 'manual' ? ' (수동)' : ''}</div>
                <div className="text-white font-bold mt-1">
                  {getStartingRoundLabel(state.startingRound)} 토너먼트
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {state.advanceCount}{unitLabel} 진출
                </div>
              </div>

              {state.rankingMatch.enabled && (
                <>
                  <div className="text-2xl text-gray-400 flex-shrink-0" aria-hidden="true">→</div>
                  <div
                    className="flex-shrink-0 rounded-lg border-2 border-orange-500 bg-gray-800 p-3 text-center min-w-[140px]"
                    role="listitem"
                  >
                    <div className="text-sm text-orange-400 font-semibold">순위결정전</div>
                    <div className="text-white font-bold mt-1">
                      {state.rankingMatch.thirdPlace && state.rankingMatch.fifthToEighth
                        ? '3-8위'
                        : state.rankingMatch.thirdPlace
                          ? '3-4위'
                          : '순위전'}
                    </div>
                    <div className="text-gray-400 text-sm mt-1">
                      {(state.rankingMatch.thirdPlace ? 2 : 0) + (state.rankingMatch.fifthToEighth ? 4 : 0)}{unitLabel}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {isRoundRobinOnly && (
            <div
              className="flex-shrink-0 rounded-lg border-2 border-cyan-500 bg-gray-800 p-3 text-center min-w-[140px]"
              role="listitem"
            >
              <div className="text-sm text-cyan-400 font-semibold">풀리그</div>
              <div className="text-white font-bold mt-1">라운드로빈</div>
              <div className="text-gray-400 text-sm mt-1">{effectiveCount}{unitLabel}</div>
            </div>
          )}

          {!state.hasGroupStage && !state.hasFinalsStage && !isRoundRobinOnly && (
            <div
              className="flex-shrink-0 rounded-lg border-2 border-cyan-500 bg-gray-800 p-3 text-center min-w-[140px]"
              role="listitem"
            >
              <div className="text-sm text-cyan-400 font-semibold">단일 스테이지</div>
              <div className="text-white font-bold mt-1">{getFormatLabel(state.formatType)}</div>
              <div className="text-gray-400 text-sm mt-1">{effectiveCount}{unitLabel}</div>
            </div>
          )}
        </div>
      </section>

      {/* 3. 예선 설정 요약 */}
      {state.hasGroupStage && (
        <section className="card p-5" aria-label="예선 설정">
          <SectionHeader title="예선 설정" step={2} dispatch={dispatch} />
          <dl>
            <SummaryRow label="형식" value={state.groupCount > 1 ? '조별 라운드로빈' : '풀리그'} />
            {state.groupCount > 1 && (
              <>
                <SummaryRow label="조 수" value={`${state.groupCount}조`} />
                <SummaryRow label={isTeamType ? '조당 팀 수' : '조당 인원'} value={`~${perGroup}${unitLabel}`} />
                <SummaryRow label={isTeamType ? '조별 진출 수' : '조별 진출 수'} value={`${state.advancePerGroup}${unitLabel}`} />
              </>
            )}
            {state.tournamentMode === 'manual' && (
              <SummaryRow label="조 편성" value="수동 배정" />
            )}
            <SummaryRow label="경기 규칙" value={formatScoringRules(state.qualifyingScoringRules)} />
            <SummaryRow label="타임아웃" value={formatMatchRules(state.qualifyingMatchRules)} />
            <SummaryRow label="예상 경기 수" value={`${matchCounts.qualifying}경기`} />
          </dl>
        </section>
      )}

      {/* 4. 본선 설정 요약 */}
      {state.hasFinalsStage && !isRoundRobinOnly && (
        <section className="card p-5" aria-label="본선 설정">
          <SectionHeader title="본선 설정" step={3} dispatch={dispatch} />
          <dl>
            <SummaryRow
              label="형식"
              value={state.finalsFormat === 'single_elimination' ? '싱글 엘리미네이션' : '더블 엘리미네이션'}
            />
            <SummaryRow label="시작" value={getStartingRoundLabel(state.startingRound)} />
            <SummaryRow label="편성 방식" value={state.tournamentMode === 'manual' ? '수동 배정' : getSeedMethodLabel(state.seedMethod)} />
            <SummaryRow label="경기 규칙" value={formatScoringRules(state.finalsScoringRules)} />
            <SummaryRow label="타임아웃" value={formatMatchRules(state.finalsMatchRules)} />
            <SummaryRow label="대진 편성" value={getBracketArrangementLabel(state.bracketArrangement)} />
            {state.hasRoundScoringOverride && state.roundOverrideFromRound && state.roundOverrideSetsToWin && state.roundOverrideMaxSets && (
              <div
                className="flex justify-between py-1.5 border-b border-gray-700"
                aria-label={`라운드별 세트 수: 기본 ${state.finalsScoringRules.maxSets}세트 ${state.finalsScoringRules.setsToWin}세트 선승, ${getStartingRoundLabel(state.roundOverrideFromRound)}부터 ${state.roundOverrideMaxSets}세트 ${state.roundOverrideSetsToWin}세트 선승`}
              >
                <dt className="text-gray-400">세트 수</dt>
                <dd className="font-semibold text-white text-right">
                  기본: {state.finalsScoringRules.maxSets}세트 ({state.finalsScoringRules.setsToWin}세트 선승) | {getStartingRoundLabel(state.roundOverrideFromRound)}~: {state.roundOverrideMaxSets}세트 ({state.roundOverrideSetsToWin}세트 선승)
                </dd>
              </div>
            )}
            <SummaryRow label="3/4위 결정전" value={state.hasThirdPlaceMatch ? '있음' : '없음'} />
            <SummaryRow label="예상 경기 수" value={`${matchCounts.finals}경기`} />
          </dl>

          {/* 커스텀 대진 목록 */}
          {state.customPairings && state.customPairings.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-gray-400 mb-2">커스텀 대진</h4>
              <ul role="list" className="space-y-1">
                {state.customPairings.map((pairing) => (
                  <li key={pairing.position} className="text-sm text-white">
                    경기{pairing.position}: {pairing.slot1} vs {pairing.slot2}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 4-1. 풀리그 설정 요약 (라운드로빈 단독) */}
      {isRoundRobinOnly && (
        <section className="card p-5" aria-label="대회 형식">
          <SectionHeader title="대회 형식" step={3} dispatch={dispatch} />
          <dl>
            <SummaryRow label="형식" value="풀리그 (라운드로빈)" />
            <SummaryRow label={isTeamType ? '팀 수' : '참가자 수'} value={`${effectiveCount}${unitLabel}`} />
            <SummaryRow label="경기 규칙" value={formatScoringRules(state.finalsScoringRules)} />
            <SummaryRow label="타임아웃" value={formatMatchRules(state.finalsMatchRules)} />
            <SummaryRow label="예상 경기 수" value={`${matchCounts.total}경기`} />
          </dl>
        </section>
      )}

      {/* 5. 순위결정전 요약 */}
      {state.hasFinalsStage && !isRoundRobinOnly && state.rankingMatch.enabled && (
        <section className="card p-5" aria-label="순위결정전 설정">
          <SectionHeader title="순위결정전" step={3} dispatch={dispatch} />
          <dl>
            <SummaryRow
              label="순위 범위"
              value={
                state.rankingMatch.thirdPlace && state.rankingMatch.fifthToEighth
                  ? '3위~8위'
                  : state.rankingMatch.thirdPlace
                    ? '3위~4위'
                    : '순위결정전'
              }
            />
            <SummaryRow label="3/4위전" value={state.rankingMatch.thirdPlace ? '진행' : '미진행'} />
            <SummaryRow label="5~8위전" value={
              state.rankingMatch.fifthToEighth
                ? state.rankingMatch.fifthToEighthFormat === 'simple' ? '간소화 (2경기)'
                  : state.rankingMatch.fifthToEighthFormat === 'full' ? '교차전 (4경기)'
                  : '풀리그 (6경기)'
                : '미진행'
            } />
            {state.rankingMatch.classificationGroups && (
              <SummaryRow label="하위 순위 그룹" value={`${state.rankingMatch.classificationGroupSize}${unitLabel}씩 풀리그`} />
            )}
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
        {(state.hasGroupStage || state.hasFinalsStage) && !isRoundRobinOnly && (
          <div className="flex gap-4 mt-2 text-sm text-gray-400">
            {state.hasGroupStage && <span>예선: {matchCounts.qualifying}</span>}
            {state.hasFinalsStage && <span>본선: {matchCounts.finals}</span>}
            {matchCounts.ranking > 0 && <span>순위결정전: {matchCounts.ranking}</span>}
          </div>
        )}
      </section>

      {/* 7. 스케줄 안내 */}
      {state.tournamentMode === 'manual' ? (
        <section className="card p-4 bg-blue-900/20 border border-blue-500/40" role="note" aria-label="다음 단계 안내">
          <p className="text-blue-400 font-bold">&#8505; 다음 단계 안내</p>
          <p className="text-gray-300 text-sm mt-2">
            대회 생성 후 [대회 상세] 페이지에서:
          </p>
          <ul className="text-gray-300 text-sm mt-1 list-disc list-inside">
            <li>조 편성 (수동 배정)</li>
            <li>대진표 설정</li>
            <li>경기장/심판 배정</li>
            <li>스케줄 설정</li>
          </ul>
          <p className="text-gray-300 text-sm mt-1">을 진행할 수 있습니다.</p>
        </section>
      ) : (
        <section className="card p-4 bg-blue-900/20 border border-blue-500/40" role="note" aria-label="스케줄 안내">
          <p className="text-blue-400 font-bold">&#8505; 스케줄 안내</p>
          <p className="text-gray-300 text-sm mt-2">
            대회 생성 후 [대회 상세 &gt; 스케줄] 탭에서
            경기장, 심판 배정, 시간 설정을 할 수 있습니다.
          </p>
        </section>
      )}

      {/* 8. 생성 버튼 */}
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
