import { useTranslation } from 'react-i18next';
import type { Dispatch } from 'react';
import NumberStepper from './NumberStepper';
import { nearestBracketRoundKey } from '../../pages/TournamentCreate';
import type { WizardState, Action } from '../../pages/TournamentCreate';

interface Step2ParticipantsProps {
  state: WizardState;
  dispatch: Dispatch<Action>;
}

/**
 * 마법사 Step 2: 참가자 설정 (인원수, 대회 모드, 수동/그룹/팀 설정)
 */
export default function Step2Participants({ state, dispatch }: Step2ParticipantsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="card space-y-6">
        <h2 className="text-xl font-bold text-center">
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
        <h2 className="text-xl font-bold text-center">{t('admin.tournamentCreate.tournamentMode.title')}</h2>
        <div className="space-y-2" role="radiogroup" aria-label={t('admin.tournamentCreate.tournamentMode.selectionAriaLabel')}>
          <button
            role="radio"
            aria-checked={state.tournamentMode === 'full_league_all'}
            aria-label={`${t('admin.tournamentCreate.tournamentMode.fullLeague')}${state.tournamentMode === 'full_league_all' ? `, ${t('common.accessibility.selected')}` : ''}`}
            className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'full_league_all' ? 'border-cyan-400 bg-cyan-900/40 ring-2 ring-cyan-400/50' : 'border-gray-700 hover:border-gray-500'}`}
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'full_league_all' })}
          >
            <h3 className="text-lg font-bold">{state.tournamentMode === 'full_league_all' && '✓ '}{t('admin.tournamentCreate.tournamentMode.fullLeague')}</h3>
            <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.tournamentMode.fullLeagueDescription')}</p>
          </button>
          <button
            role="radio"
            aria-checked={state.tournamentMode === 'group_tournament'}
            aria-label={`${t('admin.tournamentCreate.tournamentMode.groupTournament')}${state.tournamentMode === 'group_tournament' ? `, ${t('common.accessibility.selected')}` : ''}`}
            className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'group_tournament' ? 'border-cyan-400 bg-cyan-900/40 ring-2 ring-cyan-400/50' : 'border-gray-700 hover:border-gray-500'}`}
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'group_tournament' })}
          >
            <h3 className="text-lg font-bold">{state.tournamentMode === 'group_tournament' && '✓ '}{t('admin.tournamentCreate.tournamentMode.groupTournament')}</h3>
            <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.tournamentMode.groupTournamentDescription')}</p>
          </button>
          <button
            role="radio"
            aria-checked={state.tournamentMode === 'direct_tournament'}
            aria-label={`${t('admin.tournamentCreate.tournamentMode.directTournament')}${state.tournamentMode === 'direct_tournament' ? `, ${t('common.accessibility.selected')}` : ''}`}
            className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'direct_tournament' ? 'border-cyan-400 bg-cyan-900/40 ring-2 ring-cyan-400/50' : 'border-gray-700 hover:border-gray-500'}`}
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'direct_tournament' })}
          >
            <h3 className="text-lg font-bold">{state.tournamentMode === 'direct_tournament' && '✓ '}{t('admin.tournamentCreate.tournamentMode.directTournament')}</h3>
            <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.tournamentMode.directTournamentDescription')}</p>
          </button>
          <button
            role="radio"
            aria-checked={state.tournamentMode === 'manual'}
            aria-label={`${t('admin.tournamentCreate.tournamentMode.manual')}${state.tournamentMode === 'manual' ? `, ${t('common.accessibility.selected')}` : ''}`}
            className={`card w-full text-left p-4 border-2 ${state.tournamentMode === 'manual' ? 'border-cyan-400 bg-cyan-900/40 ring-2 ring-cyan-400/50' : 'border-gray-700 hover:border-gray-500'}`}
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'tournamentMode', value: 'manual' })}
          >
            <h3 className="text-lg font-bold">{state.tournamentMode === 'manual' && '✓ '}{t('admin.tournamentCreate.tournamentMode.manual')}</h3>
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
        <h2 className="text-xl font-bold text-yellow-400 text-center">{t('admin.tournamentCreate.manualMode.title')}</h2>
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

            {/* Time limit (golden goal) */}
            <div>
              <NumberStepper
                label={t('admin.tournamentCreate.matchRules.timeLimitMinutes', { minutes: Math.round((state.qualifyingScoringRules.timeLimitSeconds ?? 0) / 60) })}
                value={Math.round((state.qualifyingScoringRules.timeLimitSeconds ?? 0) / 60)}
                min={0}
                max={30}
                onChange={v => {
                  const seconds = v > 0 ? v * 60 : 0;
                  dispatch({ type: 'SET_FIELD', field: 'qualifyingScoringRules', value: { ...state.qualifyingScoringRules, timeLimitSeconds: seconds } });
                  if (state.sameRulesAsQualifying) {
                    dispatch({ type: 'SET_FIELD', field: 'finalsScoringRules', value: { ...state.finalsScoringRules, timeLimitSeconds: seconds } });
                  }
                }}
                ariaLabel={t('admin.tournamentCreate.matchRules.timeLimitAriaLabel')}
              />
              <p className="text-gray-400 text-xs text-center mt-1">{t('admin.tournamentCreate.matchRules.timeLimitHint')}</p>
            </div>

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

        {/* 순위 결정전 설정 */}
        {state.hasFinalsStage && (
          <div className="space-y-4 mt-4">
            <h3 className="text-lg font-bold text-cyan-400">{t('admin.tournamentCreate.rankingMatch.title')}</h3>

            {/* 3/4위 결정전 */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-semibold">{t('admin.tournamentCreate.rankingMatch.thirdPlace')}</span>
              <button
                role="switch"
                aria-checked={state.thirdPlaceMatch}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.thirdPlaceMatch ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'thirdPlaceMatch', value: !state.thirdPlaceMatch })}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.thirdPlaceMatch ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>

            {/* 5~8위 결정전 */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-semibold">{t('admin.tournamentCreate.rankingMatch.fifthToEighth')}</span>
              <button
                role="switch"
                aria-checked={state.fifthToEighth}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.fifthToEighth ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'fifthToEighth', value: !state.fifthToEighth })}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.fifthToEighth ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>
            {state.fifthToEighth && (
              <div className="ml-4 flex gap-2">
                {(['simple', 'full', 'round_robin'] as const).map(fmt => (
                  <button
                    key={fmt}
                    className={`btn py-1 px-3 text-sm ${state.fifthToEighthFormat === fmt ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                    onClick={() => dispatch({ type: 'SET_FIELD', field: 'fifthToEighthFormat', value: fmt })}
                  >
                    {t(`admin.tournamentCreate.rankingMatch.format_${fmt}`)}
                  </button>
                ))}
              </div>
            )}

            {/* 하위 순위 결정전 (전체 순위 산출) */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-semibold">{t('admin.tournamentCreate.rankingMatch.classification')}</span>
              <button
                role="switch"
                aria-checked={state.classificationGroups}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.classificationGroups ? 'bg-green-600' : 'bg-gray-600'}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'classificationGroups', value: !state.classificationGroups })}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.classificationGroups ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </label>
            {state.classificationGroups && (
              <div className="ml-4">
                <NumberStepper
                  label={t('admin.tournamentCreate.rankingMatch.classGroupSize')}
                  value={state.classificationGroupSize}
                  min={3}
                  max={16}
                  onChange={v => dispatch({ type: 'SET_FIELD', field: 'classificationGroupSize', value: v })}
                  ariaLabel={t('admin.tournamentCreate.rankingMatch.classGroupSize')}
                />
                <p className="text-gray-400 text-xs mt-1">{t('admin.tournamentCreate.rankingMatch.classGroupHint')}</p>
              </div>
            )}

            {/* N위까지만 순위 산출 */}
            <div>
              <label className="block font-semibold mb-1">{t('admin.tournamentCreate.rankingMatch.rankingUpTo')}</label>
              <div className="flex items-center gap-2">
                <NumberStepper
                  label=""
                  value={state.rankingUpTo}
                  min={0}
                  max={state.participantCount}
                  onChange={v => dispatch({ type: 'SET_FIELD', field: 'rankingUpTo', value: v })}
                  ariaLabel={t('admin.tournamentCreate.rankingMatch.rankingUpTo')}
                />
              </div>
              <p className="text-gray-400 text-xs mt-1">{t('admin.tournamentCreate.rankingMatch.rankingUpToHint')}</p>
            </div>
          </div>
        )}

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
        <h2 className="text-xl font-bold text-center">{t('admin.tournamentCreate.groupQualifying.title')}</h2>

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
          <h2 className="text-xl font-bold text-center">{t('admin.tournamentCreate.teamSettings.title')}</h2>
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
  );
}
