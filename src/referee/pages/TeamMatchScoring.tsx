import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTeamMatchScoring } from '../hooks/useTeamMatchScoring';
import TimerModal from '../components/TimerModal';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import TeamMatchCompletedView from '../components/TeamMatchCompletedView';
import TeamMatchPendingView from '../components/TeamMatchPendingView';
import ActionToast from '../components/ActionToast';
import FoulClassifyOverlay from '../components/FoulClassifyOverlay';

export default function TeamMatchScoring() {
  const { t } = useTranslation();
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const s = useTeamMatchScoring(tournamentId, matchId);
  const {
    match, matchLoading, updateMatch,
    team1Name, team2Name,
    announcement, lastAction, setLastAction,
    scoreFlash,
    pendingSideChange, setPendingSideChange,
    setSideChangeDismissed,
    showHistory, setShowHistory,
    showWarmup, setShowWarmup,
    showSubstitution, setShowSubstitution,
    expandedSection, toggleSection,
    foulClassify, setFoulClassify,
    subTeam, setSubTeam,
    subOutIndex, setSubOutIndex,
    subInIndex, setSubInIndex,
    team1Order, setTeam1Order,
    team2Order, setTeam2Order,
    coinTossStep, setCoinTossStep,
    tossWinner, setTossWinner,
    setCourtChangeByLoser,
    pendingChoice, setPendingChoice,
    sideChangeTimer, warmupTimer, timeoutTimer,
    shortWhistle, longWhistle, goalWhistle, initAudio,
    goldenGoal,
    handleStartMatch, handleWarmup, handleWalkover,
    handleIBSAScore, handleUndo, handleChangeServe,
    handleServeMiss, handleDeadBall, handleTimeout,
    handlePenalty, handleQuickFoul, handleClassifyFoul,
    handleSubstitution, openSubstitution,
    getTeamActivePlayers, getTeamReservePlayers, hasReserves,
    sets, currentSet, currentServe, serveCountVal, serverName, maxServes,
    history,
    t1TimeoutsUsed, t2TimeoutsUsed,
    p1Warnings, p2Warnings, p1Penalties, p2Penalties,
    showSideChange, scoringDisabled, nonGoalDisabled,
  } = s;

  if (matchLoading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-2xl text-gray-400 animate-pulse">{t('common.loading')}</p></div>;
  }

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-2xl text-red-400">{t('spectator.liveMatch.notFound')}</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    );
  }

  // ===== PENDING =====
  if (match.status === 'pending') {
    return (
      <TeamMatchPendingView
        match={match}
        team1Name={team1Name}
        team2Name={team2Name}
        coinTossStep={coinTossStep}
        setCoinTossStep={setCoinTossStep}
        tossWinner={tossWinner}
        setTossWinner={setTossWinner}
        pendingChoice={pendingChoice}
        setPendingChoice={setPendingChoice}
        team1Order={team1Order}
        setTeam1Order={setTeam1Order}
        team2Order={team2Order}
        setTeam2Order={setTeam2Order}
        setCourtChangeByLoser={setCourtChangeByLoser}
        initAudio={initAudio}
        handleStartMatch={handleStartMatch}
        handleWalkover={handleWalkover}
        updateMatch={updateMatch}
        warmupTimer={warmupTimer}
        setShowWarmup={setShowWarmup}
      />
    );
  }

  // ===== COMPLETED =====
  if (match.status === 'completed') {
    return <TeamMatchCompletedView match={match} team1Name={team1Name} team2Name={team2Name} />;
  }

  // ===== IN_PROGRESS =====
  return (
    <div className="min-h-screen flex flex-col">
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>
      <ActionToast message={lastAction} />

      {/* Warmup Timer Modal */}
      {showWarmup && warmupTimer.isRunning && (
        <TimerModal
          title={`🔥 ${t('referee.scoring.warmupStart')}`}
          seconds={warmupTimer.seconds}
          isWarning={warmupTimer.isWarning}
          subtitle={`${t('referee.home.teamMatch')} ${t('referee.scoring.warmupStart')} (90${t('common.time.seconds')})`}
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); longWhistle(); }}
          closeLabel={t('common.done')}
        />
      )}

      {/* Side Change: Phase 1 */}
      {pendingSideChange && !showSideChange && (
        <TimerModal
          title={`${t('common.matchHistory.sideChange')}! (16${t('common.units.point')})`}
          seconds={0}
          isWarning={false}
          subtitle={t('common.matchHistory.sideChange')}
          onClose={async () => {
            setPendingSideChange(false);
            const ok = await updateMatch({ sideChangeStartTime: Date.now() });
            if (!ok) {
              setLastAction('⚠️ ' + t('referee.scoring.conflictError'));
            }
          }}
          closeLabel={`⏱️ ${t('referee.scoring.timeoutTitle.player')} ${t('common.start')}`}
          required
        />
      )}

      {/* Side Change: Phase 2 */}
      {showSideChange && (
        <TimerModal
          title={`${t('common.matchHistory.sideChange')}! (16${t('common.units.point')})`}
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle={`1${t('common.time.minutes')}`}
          onClose={() => {
            sideChangeTimer.stop();
            setSideChangeDismissed(true);
            updateMatch({ sideChangeStartTime: null });
            longWhistle();
          }}
          closeLabel={t('common.confirm')}
          required
        />
      )}

      {/* Timeout Modal */}
      {match.activeTimeout && (timeoutTimer.isRunning || match.activeTimeout.type === 'referee') && (
        <TimerModal
          title={match.activeTimeout.type === 'medical' ? `🏥 ${t('referee.scoring.timeoutTitle.medical')}` : match.activeTimeout.type === 'referee' ? `🟨 ${t('referee.scoring.timeoutTitle.referee')}` : `⏱️ ${t('referee.scoring.timeoutTitle.player')}`}
          seconds={timeoutTimer.seconds}
          isWarning={timeoutTimer.isWarning}
          subtitle={match.activeTimeout.type === 'referee' ? '' : (match.activeTimeout.playerId === match.team1Id ? team1Name : team2Name)}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); longWhistle(); }}
          closeLabel={t('referee.scoring.timeoutEnd')}
        />
      )}

      {/* Substitution Modal */}
      {showSubstitution && subTeam !== null && (() => {
        const active = getTeamActivePlayers(subTeam);
        const reserves = getTeamReservePlayers(subTeam);
        const subTeamName = subTeam === 1 ? team1Name : team2Name;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onKeyDown={e => { if (e.key === 'Escape') { setShowSubstitution(false); setSubTeam(null); } }}>
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4" role="dialog" aria-modal="true" aria-label={`${subTeamName} ${t('common.matchHistory.substitution')}`}>
              <h2 className="text-xl font-bold text-indigo-300 text-center">
                🔄 {subTeamName} {t('common.matchHistory.substitution')}
              </h2>

              <div>
                <h3 className="text-sm font-bold text-gray-400 mb-2">{t('common.matchHistory.substitution')}</h3>
                <div className="space-y-1">
                  {active.names.map((name, i) => (
                    <button
                      key={active.ids[i] ?? i}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${
                        subOutIndex === i
                          ? 'bg-red-700 text-white'
                          : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      }`}
                      onClick={() => setSubOutIndex(i)}
                      aria-pressed={subOutIndex === i}
                      aria-label={`${name}${subOutIndex === i ? ` (${t('common.accessibility.selected')})` : ''}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-gray-400 mb-2">{t('common.matchHistory.substitution')}</h3>
                <div className="space-y-1">
                  {reserves.names.map((name, i) => (
                    <button
                      key={reserves.ids[i] ?? i}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${
                        subInIndex === i
                          ? 'bg-green-700 text-white'
                          : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      }`}
                      onClick={() => setSubInIndex(i)}
                      aria-pressed={subInIndex === i}
                      aria-label={`${name}${subInIndex === i ? ` (${t('common.accessibility.selected')})` : ''}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white"
                  onClick={() => { setShowSubstitution(false); setSubTeam(null); }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="btn flex-1 bg-indigo-600 hover:bg-indigo-500 text-white"
                  disabled={subOutIndex === null || subInIndex === null}
                  onClick={handleSubstitution}
                >
                  {t('common.confirm')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/games')} aria-label={t('referee.home.title')}>← {t('referee.home.title')}</button>
          <div className="text-center">
            <h1 className="text-lg font-bold text-yellow-400">{t('referee.home.teamMatch')}</h1>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{t('referee.home.mainReferee')}: {match.refereeName}</div>}
            {match.assistantRefereeName && <div>{t('referee.home.assistantReferee')}: {match.assistantRefereeName}</div>}
          </div>
        </div>
      </div>

      {/* Serve */}
      <div className="bg-blue-900/50 px-4 py-1.5 flex items-center justify-center gap-3" role="status" aria-label={`${serverName} ${t('common.matchHistory.serve')} ${serveCountVal + 1}/${maxServes}`}>
        <span className="text-blue-300 font-semibold text-sm">
          🎾 {serverName} {t('common.matchHistory.serve')} {serveCountVal + 1}/{maxServes}
        </span>
        <button className="text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label={t('common.matchHistory.serve')} style={{ minHeight: '44px', minWidth: '44px' }}>{t('common.matchHistory.serve')}</button>
      </div>

      {/* Score display */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-3 px-2 border-r border-gray-700" style={currentServe === 'player1' ? { borderLeft: '3px solid rgba(234,179,8,0.4)' } : undefined}>
          <h2 className="text-lg font-bold text-yellow-400">
            {currentServe === 'player1' && <span aria-hidden="true">🎾 </span>}{team1Name}
          </h2>
          <div key={`t1-${scoreFlash}`} className="text-7xl font-bold my-1 text-yellow-400" style={{ animation: 'scoreFlash 0.3s ease-out' }}>
            {currentSet.player1Score}
          </div>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 font-bold">W{p1Warnings}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-800/60 text-red-300 font-bold">P{p1Penalties}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-800/60 text-blue-300 font-bold">T{t1TimeoutsUsed}</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 px-2" style={currentServe === 'player2' ? { borderRight: '3px solid rgba(6,182,212,0.4)' } : undefined}>
          <h2 className="text-lg font-bold text-cyan-400">
            {currentServe === 'player2' && <span aria-hidden="true">🎾 </span>}{team2Name}
          </h2>
          <div key={`t2-${scoreFlash}`} className="text-7xl font-bold my-1 text-cyan-400" style={{ animation: 'scoreFlash 0.3s ease-out' }}>
            {currentSet.player2Score}
          </div>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 font-bold">W{p2Warnings}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-800/60 text-red-300 font-bold">P{p2Penalties}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-800/60 text-blue-300 font-bold">T{t2TimeoutsUsed}</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* 골든골 타이머/배너 */}
      {goldenGoal.enabled && (
        goldenGoal.isActive ? (
          <div className="mx-4 mt-2 px-4 py-3 rounded-lg bg-red-700 text-white font-bold text-center" role="status" aria-live="assertive">
            ⏱️ {t('referee.scoring.goldenGoalBanner')}
          </div>
        ) : (
          <div className="mx-4 mt-2 px-4 py-2 rounded-lg bg-gray-800 text-cyan-300 font-mono text-center text-lg">
            ⏱ {Math.floor(goldenGoal.remainingSec / 60)}:{String(goldenGoal.remainingSec % 60).padStart(2, '0')}
          </div>
        )
      )}

      {/* Scoring area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Row 1: 골 +2 */}
        <div className="grid grid-cols-2 gap-3">
          <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
            onClick={() => handleIBSAScore(1, 'goal', 2, false, `${team1Name} ${t('common.scoreActions.goal')}`)}
            aria-label={`${team1Name} ${t('common.scoreActions.goal')} +2`}>
            ⚽ {team1Name}<br/>{t('common.scoreActions.goal')} +2
          </button>
          <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
            onClick={() => handleIBSAScore(2, 'goal', 2, false, `${team2Name} ${t('common.scoreActions.goal')}`)}
            aria-label={`${team2Name} ${t('common.scoreActions.goal')} +2`}>
            ⚽ {team2Name}<br/>{t('common.scoreActions.goal')} +2
          </button>
        </div>

        {/* Row 2: 파울 +1 */}
        <div className="grid grid-cols-2 gap-3">
          <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={nonGoalDisabled}
            onClick={() => handleQuickFoul(1)}
            aria-label={`${team1Name} ${t('common.scoreActions.foul')}, ${team2Name} +1`}>
            🟡 {team1Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {team2Name} +1</span>
          </button>
          <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={nonGoalDisabled}
            onClick={() => handleQuickFoul(2)}
            aria-label={`${team2Name} ${t('common.scoreActions.foul')}, ${team1Name} +1`}>
            🟡 {team2Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {team1Name} +1</span>
          </button>
        </div>

        {/* Row 2.5 */}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn bg-purple-700 hover:bg-purple-600 text-white text-base py-3 font-bold" disabled={nonGoalDisabled || match.status !== 'in_progress'}
            onClick={() => handleDeadBall(match.currentServe === 'player1' ? 1 : 2)}
            aria-label={t('common.matchHistory.deadBall', { server: '' }).trim()}>
            🔵 {t('common.matchHistory.deadBall', { server: '' }).trim()}
          </button>
          <button className="btn bg-orange-700 hover:bg-orange-600 text-white text-base py-3 font-bold" disabled={nonGoalDisabled || match.status !== 'in_progress'}
            onClick={handleServeMiss}
            aria-label={t('common.scoreActions.serveMiss')}>
            🎾 {t('common.scoreActions.serveMiss')}
          </button>
        </div>

        {/* Row 3 */}
        <div className="grid grid-cols-3 gap-2">
          <button className="btn btn-danger py-3 text-sm" onClick={handleUndo} disabled={history.length === 0}
            aria-label={t('common.undo')}>↩️ {t('common.cancel')}</button>
          <button className="btn bg-yellow-800 hover:bg-yellow-700 text-white py-3 text-sm" onClick={() => handleTimeout(1, 'referee')} disabled={!!match.activeTimeout}
            aria-label={t('referee.scoring.timeoutTitle.referee')}>
            🟨 {t('referee.scoring.timeoutTitle.referee')}
          </button>
          <button className="btn bg-gray-700 hover:bg-gray-600 text-white py-3 text-sm" onClick={shortWhistle}
            aria-label={t('referee.scoring.whistleServeAriaLabel')} style={{ minHeight: '44px' }}>
            📣 {t('referee.scoring.whistleServeButton')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn bg-gray-700 hover:bg-gray-600 text-white py-3 text-sm font-bold" onClick={goalWhistle}
            aria-label={t('referee.scoring.whistleGoalAriaLabel')} style={{ minHeight: '44px' }}>
            ⚽ {t('referee.scoring.whistleGoalButton')}
          </button>
          <button className="btn bg-gray-700 hover:bg-gray-600 text-white py-3 text-sm font-bold" onClick={longWhistle}
            aria-label={t('referee.scoring.whistleEndAriaLabel')} style={{ minHeight: '44px' }}>
            📢 {t('referee.scoring.whistleEndButton')}
          </button>
        </div>

        {/* 접이식: 타임아웃 */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('timeout')} aria-expanded={expandedSection === 'timeout'}
            aria-label={t('referee.scoring.timeoutTitle.player')}>
            <span className="text-sm font-bold text-gray-300" aria-hidden="true">⏱️ {t('referee.scoring.timeoutTitle.player')}</span>
            <span className="text-gray-400" aria-hidden="true">{expandedSection === 'timeout' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'timeout' && (
            <div className="px-3 py-3 space-y-2 bg-gray-900/50">
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-secondary text-sm py-2" onClick={() => handleTimeout(1, 'player')} disabled={t1TimeoutsUsed >= 1 || !!match.activeTimeout}
                  aria-label={`${team1Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - t1TimeoutsUsed}/1)`}>
                  ⏱️ {team1Name} {t('referee.scoring.timeoutTitle.player')} ({1 - t1TimeoutsUsed}/1)
                </button>
                <button className="btn btn-secondary text-sm py-2" onClick={() => handleTimeout(2, 'player')} disabled={t2TimeoutsUsed >= 1 || !!match.activeTimeout}
                  aria-label={`${team2Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - t2TimeoutsUsed}/1)`}>
                  ⏱️ {team2Name} {t('referee.scoring.timeoutTitle.player')} ({1 - t2TimeoutsUsed}/1)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => handleTimeout(1, 'medical')} disabled={!!match.activeTimeout || history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team1Name).length >= 1}
                  aria-label={`${team1Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team1Name).length}/1)`}>
                  🏥 {team1Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team1Name).length}/1)
                </button>
                <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => handleTimeout(2, 'medical')} disabled={!!match.activeTimeout || history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team2Name).length >= 1}
                  aria-label={`${team2Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team2Name).length}/1)`}>
                  🏥 {team2Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team2Name).length}/1)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 접이식: 벌점 */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('penalty')} aria-expanded={expandedSection === 'penalty'}
            aria-label={t('referee.scoring.penaltySection')}>
            <span className="text-sm font-bold text-gray-300" aria-hidden="true">🔴 {t('referee.scoring.penaltySection')}</span>
            <span className="text-gray-400" aria-hidden="true">{expandedSection === 'penalty' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'penalty' && (
            <div className="px-3 py-3 space-y-2 bg-gray-900/50">
              <div className="grid grid-cols-2 gap-2">
                {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => {
                  const label = t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`);
                  return (
                  <button key={`t1-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded" disabled={scoringDisabled}
                    onClick={() => handlePenalty(1, pType)}
                    aria-label={`${team1Name} ${label}`}>
                    {team1Name} {label}
                  </button>
                  );
                })}
                {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => {
                  const label = t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`);
                  return (
                  <button key={`t2-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded" disabled={scoringDisabled}
                    onClick={() => handlePenalty(2, pType)}
                    aria-label={`${team2Name} ${label}`}>
                    {team2Name} {label}
                  </button>
                  );
                })}
              </div>
              <div className="border-t border-red-800 pt-2">
                <p className="text-[10px] text-red-400 mb-1">{t('referee.scoring.gogglesTouchHint')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn bg-red-800 hover:bg-red-700 text-white text-xs py-2 rounded font-bold"
                    disabled={scoringDisabled}
                    onClick={() => handleIBSAScore(1, 'mask_touch', 2, true, t('referee.scoring.gogglesTouchButton', { name: team1Name }))}
                    aria-label={t('referee.scoring.gogglesTouchAriaLabel', { name: team1Name, opponent: team2Name })} style={{ minHeight: '44px' }}>
                    🥽 {t('referee.scoring.gogglesTouchButton', { name: team1Name })}
                  </button>
                  <button className="btn bg-red-800 hover:bg-red-700 text-white text-xs py-2 rounded font-bold"
                    disabled={scoringDisabled}
                    onClick={() => handleIBSAScore(2, 'mask_touch', 2, true, t('referee.scoring.gogglesTouchButton', { name: team2Name }))}
                    aria-label={t('referee.scoring.gogglesTouchAriaLabel', { name: team2Name, opponent: team1Name })} style={{ minHeight: '44px' }}>
                    🥽 {t('referee.scoring.gogglesTouchButton', { name: team2Name })}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 접이식: 기타 */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('etc')} aria-expanded={expandedSection === 'etc'}
            aria-label={t('referee.scoring.otherActions')}>
            <span className="text-sm font-bold text-gray-300" aria-hidden="true">⚙️ {t('common.scoreActions.walkover')}</span>
            <span className="text-gray-400" aria-hidden="true">{expandedSection === 'etc' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'etc' && (
            <div className="px-4 py-3 space-y-3 bg-gray-900/50">
              {!match.warmupUsed && (match.currentSet ?? 0) === 0 && (
                <div className="flex gap-3">
                  <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white" onClick={handleWarmup}
                    aria-label={`${t('referee.scoring.warmupStart')} 90${t('common.time.seconds')}`}>
                    🔥 {t('referee.scoring.warmupStart')} 90{t('common.time.seconds')}
                  </button>
                </div>
              )}
              {(hasReserves(1) || hasReserves(2)) && (
                <div className="grid grid-cols-2 gap-2">
                  {hasReserves(1) && (
                    <button className="btn bg-indigo-700 hover:bg-indigo-600 text-white text-sm py-2 rounded" disabled={!!match.team1SubUsed}
                      onClick={() => openSubstitution(1)}
                      aria-label={`${team1Name} ${t('common.matchHistory.substitution')}`}>
                      🔄 {team1Name} {t('common.matchHistory.substitution')}
                    </button>
                  )}
                  {hasReserves(2) && (
                    <button className="btn bg-indigo-700 hover:bg-indigo-600 text-white text-sm py-2 rounded" disabled={!!match.team2SubUsed}
                      onClick={() => openSubstitution(2)}
                      aria-label={`${team2Name} ${t('common.matchHistory.substitution')}`}>
                      🔄 {team2Name} {t('common.matchHistory.substitution')}
                    </button>
                  )}
                </div>
              )}
              <div className="border-t border-gray-700 pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2" onClick={() => handleWalkover(1)} disabled={match.status !== 'in_progress' && match.status !== 'pending'}
                    aria-label={`${team1Name} ${t('common.scoreActions.walkover')}`}>{team1Name} {t('common.scoreActions.walkover')}</button>
                  <button className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2" onClick={() => handleWalkover(2)} disabled={match.status !== 'in_progress' && match.status !== 'pending'}
                    aria-label={`${team2Name} ${t('common.scoreActions.walkover')}`}>{team2Name} {t('common.scoreActions.walkover')}</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* History */}
        <div>
          <button className="text-sm text-gray-400 underline mb-2" onClick={() => setShowHistory(!showHistory)} style={{ minHeight: '44px' }}
            aria-expanded={showHistory} aria-label={t('common.matchHistory.title')}>
            <span aria-hidden="true">{showHistory ? '▲' : '▼'}</span> {showHistory ? t('common.matchHistory.title') : t('common.matchHistory.titleWithCount', { count: history.length })}
          </button>
          {showHistory && history.length > 0 && (
            <div className="w-full">
              <ScoreHistoryView history={history} sets={sets} />
            </div>
          )}
        </div>
      </div>

      {/* Foul classification overlay */}
      {foulClassify && (
        <FoulClassifyOverlay
          playerName={foulClassify.player === 1 ? team1Name : team2Name}
          player={foulClassify.player}
          onClassify={handleClassifyFoul}
          onPenalty={async (player, penaltyType) => {
            await handleUndo();
            setFoulClassify(null);
            handlePenalty(player, penaltyType);
          }}
          onDismiss={() => setFoulClassify(null)}
        />
      )}
    </div>
  );
}
