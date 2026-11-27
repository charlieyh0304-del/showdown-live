import { useTranslation } from 'react-i18next';
import type { TournamentType, BracketFormatType, MatchRules } from '@shared/types';
import { calculateMatchCount } from '@shared/utils/tournament';
import {
  RULES_PRESETS,
  matchKindOf,
  resolveCompetitionRules,
  resolveMatchScoring,
  type ScoringRuleSet,
} from '@shared/rules/competitionRules';
import { overriddenPaths, draftFromTournament } from '../rules/rulesEditorModel';
import { effectiveParticipantCount, type Action, type NewTournament, type WizardState } from './wizardModel';

// ===== 헬퍼 =====

// Helper functions that need t() are now inside the component or receive t as param

function getStartingRoundLabel(round: number, t: (key: string) => string): string {
  switch (round) {
    case 2: return t('admin.tournamentCreate.finals.final');
    case 4: return t('admin.tournamentCreate.finals.round4');
    case 8: return t('admin.tournamentCreate.finals.round8');
    case 16: return t('admin.tournamentCreate.finals.round16');
    case 32: return t('admin.tournamentCreate.finals.round32');
    default: return `${round}`;
  }
}

// ===== 컴포넌트 =====

interface WizardStep5Props {
  state: WizardState;
  /** 저장될 대회 문서 (buildTournamentFromWizard). 미리보기는 이 값에서 읽는다(B15 왕복 보장). */
  doc: NewTournament;
  dispatch: (action: Action) => void;
  onSubmit: () => void;
  saving: boolean;
}

function SectionHeader({
  title,
  step,
  dispatch,
  t,
}: {
  title: string;
  step: number;
  dispatch: (action: Action) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-lg font-bold text-yellow-400">{title}</h3>
      <button
        className="text-sm text-cyan-400 hover:text-cyan-300 underline"
        onClick={() => dispatch({ type: 'GO_TO_STEP', step })}
        aria-label={t('admin.preview.editAriaLabel', { title, step })}
      >
        {t('admin.preview.editButton')}
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

export default function WizardStep5Preview({ state, doc, dispatch, onSubmit, saving }: WizardStep5Props) {
  const { t } = useTranslation();
  const stages = doc.stages ?? [];
  const qualStage = stages.find(s => s.type === 'qualifying');
  const finalsStage = stages.find(s => s.type === 'finals');
  const hasGroupStage = !!qualStage;
  const hasFinalsStage = !!finalsStage;
  // 풀리그 단독 형식: 조별 예선 없이 라운드로빈만 진행
  const isRoundRobinOnly = !hasGroupStage && !hasFinalsStage && doc.formatType === 'round_robin';
  const finalsConfig = doc.finalsConfig;
  const rankingMatch = doc.rankingMatchConfig ?? state.rankingMatch;
  const startingRound = finalsConfig?.startingRound ?? state.finalsStartRound;
  const advanceCount = finalsConfig?.advanceCount ?? state.advanceCount;
  const kind = matchKindOf(doc.type);
  const tournamentRules = resolveCompetitionRules(doc);
  const finalsRules = finalsStage ? resolveCompetitionRules(doc, finalsStage.id) : tournamentRules;
  // 진출 인원·와일드카드는 본선 생성기처럼 예선 스테이지 규칙에서 읽는다 (같은 조 회피는 본선 스테이지)
  const qualRules = qualStage ? resolveCompetitionRules(doc, qualStage.id) : tournamentRules;
  // 경기 점수 규칙은 저장될 문서에서 규칙 해석기로 읽는다 (심판 화면·순위 계산과 같은 값)
  const qualScoring = resolveMatchScoring({ type: kind, stageId: qualStage?.id }, doc);
  const finalsScoring = resolveMatchScoring({ type: kind, stageId: finalsStage?.id, roundLabel: `${startingRound}강` }, doc);
  const leagueScoring = resolveMatchScoring({ type: kind }, doc);

  // 팀전에서 실제 경기 참여 단위 수 계산
  const isTeamType = state.type === 'team' || state.type === 'randomTeamLeague';
  const effectiveCount = effectiveParticipantCount(state);
  const unitLabel = isTeamType ? t('common.units.team') : t('common.units.person');

  // Helper functions using t()
  const getTypeLabel = (type: TournamentType): string => {
    return t(`common.tournamentType.${type}`);
  };

  const getFormatLabel = (format: BracketFormatType): string => {
    const map: Record<BracketFormatType, string> = {
      round_robin: t('admin.preview.fullLeagueRoundRobin'),
      single_elimination: t('admin.tournamentCreate.finals.singleElimination'),
      double_elimination: t('admin.tournamentCreate.finals.doubleElimination'),
      swiss: 'Swiss',
      group_knockout: t('admin.tournamentCreate.tournamentMode.groupTournament'),
      manual: t('admin.tournamentCreate.manualMode.title'),
    };
    return map[format] || format;
  };

  const getSeedMethodLabel = (method: string): string => {
    return t(`admin.preview.seedMethod.${method}`) || method;
  };

  const getBracketArrangementLabel = (arrangement: string): string => {
    switch (arrangement) {
      case 'cross_group': return t('admin.tournamentCreate.finals.crossGroup');
      case 'sequential': return t('admin.tournamentCreate.finals.sequential');
      case 'custom': return t('admin.tournamentCreate.finals.customArrangement');
      default: return arrangement;
    }
  };

  const formatScoringRules = (rules: ScoringRuleSet): string => {
    return t('admin.preview.scoringRulesSummary', { winScore: rules.winScore, setsToWin: rules.setsToWin, maxSets: rules.maxSets, minLead: rules.minLead });
  };

  const formatMatchRules = (rules: MatchRules): string => {
    return t('admin.preview.timeoutSummary', { count: rules.timeoutsPerPlayer, duration: rules.timeoutDurationSeconds });
  };

  const matchCounts = calculateMatchCount(
    effectiveCount,
    hasGroupStage,
    state.groupCount,
    hasFinalsStage,
    advanceCount,
    rankingMatch,
    hasFinalsStage ? startingRound : undefined,
  );

  // 경기 규칙 요약
  const criterionName = (c: string) => t(`admin.rulesEditor.tiebreak.criteria.${c}`);
  const lastKey = tournamentRules.tiebreak.unresolved === 'lot' ? 'lastLot' : tournamentRules.tiebreak.unresolved === 'playoff' ? 'lastPlayoff' : 'lastAdmin';
  const tiebreakText = t('admin.rulesEditor.tiebreak.preview', {
    order: tournamentRules.tiebreak.criteria.map(criterionName).join(t('admin.rulesEditor.tiebreak.joiner')),
    last: t(`admin.rulesEditor.tiebreak.${lastKey}`),
  });
  const docDraft = draftFromTournament(doc);
  const stageName = (type?: string) => (type === 'qualifying' ? t('admin.rulesEditor.wizard.stageQualifying') : type === 'finals' ? t('admin.rulesEditor.wizard.stageFinals') : t('admin.rulesEditor.wizard.stageRanking'));
  const stageOverrides = stages
    .map(s => ({ name: stageName(s.type), count: overriddenPaths(doc, docDraft, s.id).length }))
    .filter(x => x.count > 0);
  const presetLabel = RULES_PRESETS[tournamentRules.presetId] ? t(RULES_PRESETS[tournamentRules.presetId].labelKey) : tournamentRules.presetId;

  const perGroup = state.groupCount > 0
    ? Math.ceil(effectiveCount / state.groupCount)
    : effectiveCount;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-yellow-400 text-center">{t('admin.preview.title')}</h2>

      {/* 수동 모드 배너 */}
      {state.tournamentMode === 'manual' && (
        <div className="card p-4 bg-yellow-900/20 border-2 border-yellow-500/40">
          <p className="text-yellow-400 font-bold text-lg">{t('admin.preview.manualModeBanner')}</p>
          <p className="text-gray-300 text-sm mt-1">
            {t('admin.preview.manualModeDescription')}
          </p>
        </div>
      )}

      {/* 1. 대회 기본 정보 */}
      <section className="card p-5" aria-label={t('admin.preview.basicInfo')}>
        <SectionHeader title={t('admin.preview.basicInfo')} step={1} dispatch={dispatch} t={t} />
        <dl>
          <SummaryRow label={t('admin.preview.tournamentName')} value={state.name || t('admin.preview.notEntered')} />
          <SummaryRow label={t('admin.preview.date')} value={state.date} />
          <SummaryRow label={t('admin.preview.type')} value={getTypeLabel(state.type)} />
          <SummaryRow label={isTeamType ? t('admin.preview.teamCount') : t('admin.preview.participantCount')} value={`${effectiveCount}${unitLabel}`} />
        </dl>
      </section>

      {/* 2. 대회 구조 시각화 */}
      <section className="card p-5" aria-label={t('admin.preview.structure')}>
        <h3 className="text-lg font-bold text-yellow-400 mb-4">{t('admin.preview.structure')}</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2" role="list" aria-label={t('admin.preview.stageFlow')}>
          {hasGroupStage && (
            <>
              <div
                className="flex-shrink-0 rounded-lg border-2 border-cyan-500 bg-gray-800 p-3 text-center min-w-[140px]"
                role="listitem"
              >
                <div className="text-sm text-cyan-400 font-semibold">{state.tournamentMode === 'manual' ? t('admin.preview.qualifyingManual') : t('admin.preview.qualifying')}</div>
                <div className="text-white font-bold mt-1">
                  {state.groupCount > 1
                    ? t('admin.preview.groupLeague', { count: state.groupCount })
                    : t('admin.preview.fullLeague')}
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {effectiveCount}{unitLabel}
                </div>
                {state.groupCount > 1 && (
                  <div className="text-gray-400 text-xs mt-0.5">
                    {t('admin.preview.perGroupCount')} ~{perGroup}{unitLabel}
                  </div>
                )}
              </div>
              {hasFinalsStage && (
                <div className="text-2xl text-gray-400 flex-shrink-0" aria-hidden="true">→</div>
              )}
            </>
          )}

          {hasFinalsStage && !isRoundRobinOnly && (
            <>
              <div
                className="flex-shrink-0 rounded-lg border-2 border-yellow-500 bg-gray-800 p-3 text-center min-w-[140px]"
                role="listitem"
              >
                <div className="text-sm text-yellow-400 font-semibold">{state.tournamentMode === 'manual' ? t('admin.preview.finalsManual') : t('admin.preview.finals')}</div>
                <div className="text-white font-bold mt-1">
                  {getStartingRoundLabel(startingRound, t)} {t('admin.preview.tournament')}
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  {t('admin.preview.advance', { count: advanceCount, unit: unitLabel })}
                </div>
              </div>

              {rankingMatch.enabled && (
                <>
                  <div className="text-2xl text-gray-400 flex-shrink-0" aria-hidden="true">→</div>
                  <div
                    className="flex-shrink-0 rounded-lg border-2 border-orange-500 bg-gray-800 p-3 text-center min-w-[140px]"
                    role="listitem"
                  >
                    <div className="text-sm text-orange-400 font-semibold">{t('admin.preview.rankingMatchSection')}</div>
                    <div className="text-white font-bold mt-1">
                      {rankingMatch.thirdPlace && rankingMatch.fifthToEighth
                        ? t('admin.preview.rankThirdEighth')
                        : rankingMatch.thirdPlace
                          ? t('admin.preview.rankThirdFourth')
                          : t('admin.preview.rankingGeneral')}
                    </div>
                    <div className="text-gray-400 text-sm mt-1">
                      {(rankingMatch.thirdPlace ? 2 : 0) + (rankingMatch.fifthToEighth ? 4 : 0)}{unitLabel}
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
              <div className="text-sm text-cyan-400 font-semibold">{t('admin.preview.fullLeague')}</div>
              <div className="text-white font-bold mt-1">{t('admin.tournamentCreate.finals.roundRobin')}</div>
              <div className="text-gray-400 text-sm mt-1">{effectiveCount}{unitLabel}</div>
            </div>
          )}

          {!hasGroupStage && !hasFinalsStage && !isRoundRobinOnly && (
            <div
              className="flex-shrink-0 rounded-lg border-2 border-cyan-500 bg-gray-800 p-3 text-center min-w-[140px]"
              role="listitem"
            >
              <div className="text-sm text-cyan-400 font-semibold">{t('admin.preview.singleStage')}</div>
              <div className="text-white font-bold mt-1">{getFormatLabel(state.formatType)}</div>
              <div className="text-gray-400 text-sm mt-1">{effectiveCount}{unitLabel}</div>
            </div>
          )}
        </div>
      </section>

      {/* 3. 예선 설정 요약 */}
      {hasGroupStage && (
        <section className="card p-5" aria-label={t('admin.preview.qualifyingSettings')}>
          <SectionHeader title={t('admin.preview.qualifyingSettings')} step={2} dispatch={dispatch} t={t} />
          <dl>
            <SummaryRow label={t('admin.preview.format')} value={state.groupCount > 1 ? t('admin.preview.groupRoundRobin') : t('admin.preview.fullLeague')} />
            {state.groupCount > 1 && (
              <>
                <SummaryRow label={t('admin.preview.groupCountLabel')} value={`${state.groupCount}${t('common.units.group')}`} />
                <SummaryRow label={isTeamType ? t('admin.preview.perGroupTeamCount') : t('admin.preview.perGroupCount')} value={`~${perGroup}${unitLabel}`} />
                <SummaryRow label={t('admin.preview.advancePerGroup')} value={`${state.advancePerGroup}${unitLabel}`} />
              </>
            )}
            {state.tournamentMode === 'manual' && (
              <SummaryRow label={t('admin.preview.groupArrangement')} value={t('admin.preview.manualAssignment')} />
            )}
            <SummaryRow label={t('admin.preview.matchRules')} value={formatScoringRules(qualScoring)} />
            <SummaryRow label={t('admin.preview.timeoutRules')} value={formatMatchRules(state.qualifyingMatchRules)} />
            <SummaryRow label={t('admin.preview.expectedMatches')} value={`${matchCounts.qualifying}${t('common.units.match')}`} />
          </dl>
        </section>
      )}

      {/* 4. 본선 설정 요약 */}
      {hasFinalsStage && !isRoundRobinOnly && (
        <section className="card p-5" aria-label={t('admin.preview.finalsSettings')}>
          <SectionHeader title={t('admin.preview.finalsSettings')} step={3} dispatch={dispatch} t={t} />
          <dl>
            <SummaryRow
              label={t('admin.preview.format')}
              value={finalsConfig?.format === 'double_elimination' ? t('admin.tournamentCreate.finals.doubleElimination') : t('admin.tournamentCreate.finals.singleElimination')}
            />
            <SummaryRow label={t('admin.preview.start')} value={getStartingRoundLabel(startingRound, t)} />
            <SummaryRow label={t('admin.preview.arrangementMethod')} value={state.tournamentMode === 'manual' ? t('admin.preview.manualAssignment') : getSeedMethodLabel(finalsConfig?.seedMethod ?? state.seedMethod)} />
            <SummaryRow label={t('admin.preview.matchRules')} value={formatScoringRules(finalsScoring)} />
            <SummaryRow label={t('admin.preview.timeoutRules')} value={formatMatchRules(state.finalsMatchRules)} />
            <SummaryRow label={t('admin.preview.bracketArrangement')} value={getBracketArrangementLabel(finalsConfig?.bracketArrangement ?? state.bracketArrangement)} />
            {hasGroupStage && (
              <>
                <SummaryRow label={t('admin.rulesEditor.qualification.perGroup')} value={`${qualRules.qualification.perGroup}${unitLabel}`} />
                <SummaryRow label={t('admin.rulesEditor.qualification.wildcards')} value={`${qualRules.qualification.wildcards}${unitLabel}`} />
                <SummaryRow label={t('admin.rulesEditor.qualification.avoidSameGroup')} value={finalsRules.qualification.avoidSameGroupFirstRound ? t('admin.preview.exists') : t('admin.preview.none')} />
              </>
            )}
            {finalsRules.roundScoring && (
              <SummaryRow
                label={t('admin.preview.setsPerRound')}
                value={(() => {
                  const r = finalsRules.roundScoring;
                  const win = r[kind]?.setsToWin ?? finalsScoring.setsToWin;
                  return t('admin.rulesEditor.scoring.round.summary', { round: t(`admin.rulesEditor.rounds.r${r.fromRound}`), max: r[kind]?.maxSets ?? win * 2 - 1, win });
                })()}
              />
            )}
            <SummaryRow label={t('admin.preview.thirdPlaceMatch')} value={finalsRules.finalRanking.thirdPlace === 'match' ? t('admin.preview.exists') : t('admin.preview.none')} />
            <SummaryRow label={t('admin.preview.expectedMatches')} value={`${matchCounts.finals}${t('common.units.match')}`} />
          </dl>

          {/* 커스텀 대진 목록 */}
          {finalsConfig?.customBracketPairings && finalsConfig.customBracketPairings.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-gray-400 mb-2">{t('admin.preview.customPairings')}</h4>
              <ul role="list" className="space-y-1">
                {finalsConfig.customBracketPairings.map((pairing) => (
                  <li key={pairing.position} className="text-sm text-white">
                    {t('admin.preview.matchNumber', { position: pairing.position })}: {pairing.slot1} vs {pairing.slot2}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 4-1. 풀리그 설정 요약 (라운드로빈 단독) */}
      {isRoundRobinOnly && (
        <section className="card p-5" aria-label={t('admin.preview.tournamentFormat')}>
          <SectionHeader title={t('admin.preview.tournamentFormat')} step={3} dispatch={dispatch} t={t} />
          <dl>
            <SummaryRow label={t('admin.preview.format')} value={t('admin.preview.fullLeagueRoundRobin')} />
            <SummaryRow label={isTeamType ? t('admin.preview.teamCount') : t('admin.preview.participantCount')} value={`${effectiveCount}${unitLabel}`} />
            <SummaryRow label={t('admin.preview.matchRules')} value={formatScoringRules(leagueScoring)} />
            <SummaryRow label={t('admin.preview.timeoutRules')} value={formatMatchRules(doc.matchRules ?? state.qualifyingMatchRules)} />
            <SummaryRow label={t('admin.preview.expectedMatches')} value={`${matchCounts.total}${t('common.units.match')}`} />
          </dl>
        </section>
      )}

      {/* 5. 순위결정전 요약 */}
      {hasFinalsStage && !isRoundRobinOnly && rankingMatch.enabled && (
        <section className="card p-5" aria-label={t('admin.preview.rankingSettings')}>
          <SectionHeader title={t('admin.preview.rankingMatchSection')} step={3} dispatch={dispatch} t={t} />
          <dl>
            <SummaryRow
              label={t('admin.preview.rankRange')}
              value={
                rankingMatch.thirdPlace && rankingMatch.fifthToEighth
                  ? t('admin.preview.rank3to8')
                  : rankingMatch.thirdPlace
                    ? t('admin.preview.rank3to4')
                    : t('admin.preview.rankGeneral')
              }
            />
            <SummaryRow label={t('admin.preview.thirdFourthMatch')} value={rankingMatch.thirdPlace ? t('admin.preview.proceed') : t('admin.preview.notProceed')} />
            <SummaryRow label={t('admin.preview.fifthEighthMatch')} value={
              rankingMatch.fifthToEighth
                ? rankingMatch.fifthToEighthFormat === 'simple' ? t('admin.preview.simplified')
                  : rankingMatch.fifthToEighthFormat === 'full' ? t('admin.preview.crossMatch')
                  : t('admin.preview.fullLeagueMatch')
                : t('admin.preview.notProceed')
            } />
            {rankingMatch.classificationGroups && (
              <SummaryRow label={t('admin.preview.lowerRankGroup')} value={t('admin.preview.lowerRankGroupLabel', { size: rankingMatch.classificationGroupSize, unit: unitLabel })} />
            )}
            <SummaryRow label={t('admin.preview.expectedMatches')} value={`${matchCounts.ranking}${t('common.units.match')}`} />
          </dl>
        </section>
      )}

      {/* 5-1. 경기 규칙 요약 (저장될 규칙) */}
      <section className="card p-5" aria-label={t('admin.rulesEditor.title')}>
        <SectionHeader title={t('admin.rulesEditor.title')} step={4} dispatch={dispatch} t={t} />
        <dl>
          <SummaryRow label={t('admin.rulesEditor.summary.preset')} value={presetLabel} />
          <SummaryRow label={t('admin.rulesEditor.summary.tiebreak')} value={tiebreakText} />
          <SummaryRow label={t('admin.rulesEditor.summary.standings')} value={t('admin.rulesEditor.summary.standingsValue', { ...tournamentRules.standingsPoints })} />
          <SummaryRow
            label={t('admin.rulesEditor.summary.walkover')}
            value={tournamentRules.walkover.setScore === null ? t('admin.rulesEditor.summary.walkoverTarget') : t('admin.rulesEditor.summary.walkoverValue', { score: tournamentRules.walkover.setScore })}
          />
          <SummaryRow
            label={t('admin.rulesEditor.summary.retirement')}
            value={t(tournamentRules.retirement.mode === 'keep_played' ? 'admin.rulesEditor.walkover.retirementKeep' : tournamentRules.retirement.mode === 'as_walkover' ? 'admin.rulesEditor.walkover.retirementVoid' : 'admin.rulesEditor.walkover.retirementRecorded')}
          />
          {hasFinalsStage && (
            <SummaryRow
              label={t('admin.rulesEditor.summary.thirdPlace')}
              value={finalsRules.finalRanking.thirdPlace === 'match' ? t('admin.rulesEditor.finalRanking.thirdMatch') : t('admin.rulesEditor.finalRanking.thirdJoint')}
            />
          )}
          <SummaryRow label={t('admin.rulesEditor.summary.rest')} value={t('admin.rulesEditor.summary.restValue', { min: tournamentRules.schedule.minRestMinutes })} />
          {stageOverrides.length > 0 && (
            <SummaryRow
              label={t('admin.rulesEditor.summary.stageOverrides')}
              value={stageOverrides.map(o => t('admin.rulesEditor.summary.stageOverridesValue', o)).join(', ')}
            />
          )}
        </dl>
      </section>

      {/* 6. 총 예상 경기 수 */}
      <section className="card p-5 bg-gray-800 border-2 border-yellow-500" aria-label={t('admin.preview.totalExpectedMatches')}>
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-bold text-yellow-400">{t('admin.preview.totalExpectedMatches')}</h3>
          <span className="text-3xl font-bold text-white">{matchCounts.total}{t('common.units.match')}</span>
        </div>
        {(hasGroupStage || hasFinalsStage) && !isRoundRobinOnly && (
          <div className="flex gap-4 mt-2 text-sm text-gray-400">
            {hasGroupStage && <span>{t('admin.preview.qualifyingCount', { count: matchCounts.qualifying })}</span>}
            {hasFinalsStage && <span>{t('admin.preview.finalsCount', { count: matchCounts.finals })}</span>}
            {matchCounts.ranking > 0 && <span>{t('admin.preview.rankingCount', { count: matchCounts.ranking })}</span>}
          </div>
        )}
      </section>

      {/* 7. 스케줄 안내 */}
      {state.tournamentMode === 'manual' ? (
        <section className="card p-4 bg-blue-900/20 border border-blue-500/40" role="note" aria-label={t('admin.preview.nextStepGuide')}>
          <p className="text-blue-400 font-bold">&#8505; {t('admin.preview.nextStepGuide')}</p>
          <p className="text-gray-300 text-sm mt-2">
            {t('admin.preview.manualNextStepDescription')}
          </p>
          <ul className="text-gray-300 text-sm mt-1 list-disc list-inside">
            <li>{t('admin.preview.manualStep1')}</li>
            <li>{t('admin.preview.manualStep2')}</li>
            <li>{t('admin.preview.manualStep3')}</li>
            <li>{t('admin.preview.manualStep4')}</li>
          </ul>
          <p className="text-gray-300 text-sm mt-1">{t('admin.preview.manualNextStepSuffix')}</p>
        </section>
      ) : (
        <section className="card p-4 bg-blue-900/20 border border-blue-500/40" role="note" aria-label={t('admin.preview.scheduleGuide')}>
          <p className="text-blue-400 font-bold">&#8505; {t('admin.preview.scheduleGuide')}</p>
          <p className="text-gray-300 text-sm mt-2">
            {t('admin.preview.scheduleDescription')}
          </p>
        </section>
      )}

      {/* 8. 생성 버튼 */}
      <button
        className="btn btn-success btn-large w-full text-xl py-4"
        onClick={onSubmit}
        disabled={saving}
        aria-label={t('admin.preview.createTournament')}
      >
        {saving ? t('common.creating') : t('admin.preview.createTournament')}
      </button>
    </div>
  );
}
