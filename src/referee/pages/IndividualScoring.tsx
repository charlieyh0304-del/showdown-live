import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { countSetWins } from '@shared/utils/scoring';
import { showError } from '@shared/utils/toast';
import type { SetScore, ScoreHistoryEntry } from '@shared/types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useIndividualScoring } from '../hooks/useIndividualScoring';
import TimerModal from '../components/TimerModal';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import ActionToast from '../components/ActionToast';
import FoulClassifyOverlay from '../components/FoulClassifyOverlay';

// Referee timeout elapsed timer component
function TimeoutModal({ match, player1Name, player2Name, timeoutTimer, onClose }: {
  match: { activeTimeout?: { playerId: string; startTime: number; type?: 'player' | 'medical' | 'referee' } | null; player1Id?: string };
  player1Name: string;
  player2Name: string;
  timeoutTimer: { seconds: number; isRunning: boolean; isWarning: boolean; stop: () => void };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toType = match.activeTimeout?.type ?? 'player';
  const playerName = match.activeTimeout?.playerId === match.player1Id ? player1Name : player2Name;
  const [elapsed, setElapsed] = useState(0);
  const trapRef = useFocusTrap(true, onClose);

  useEffect(() => {
    if (toType !== 'referee' || !match.activeTimeout) return;
    const startTime = match.activeTimeout.startTime;
    setElapsed(Math.floor((Date.now() - startTime) / 1000));
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [toType, match.activeTimeout]);

  const titleMap: Record<string, string> = {
    player: t('referee.scoring.timeoutTitle.player'),
    medical: t('referee.scoring.timeoutTitle.medical'),
    referee: t('referee.scoring.timeoutTitle.referee'),
  };

  if (toType === 'referee') {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const display = `${mins}:${secs.toString().padStart(2, '0')}`;
    return (
      <div className="modal-backdrop" style={{ zIndex: 100 }}>
        <div ref={trapRef} className="flex flex-col items-center gap-6 p-8" role="dialog" aria-modal="true" aria-label={titleMap[toType]}>
          <h2 className="text-3xl font-bold text-yellow-400">{titleMap[toType]}</h2>
          <div className="text-8xl font-bold my-4 text-white" aria-live="polite" aria-label={`${t('referee.scoring.elapsedTime')} ${display}`}>
            {display}
          </div>
          <p className="text-xl text-gray-300">{playerName} ({t('referee.scoring.elapsedTime')})</p>
          <button className="btn btn-danger btn-large" onClick={onClose} aria-label={t('referee.scoring.timeoutEnd')}>
            {t('referee.scoring.timeoutEnd')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <TimerModal
      title={titleMap[toType]}
      seconds={timeoutTimer.seconds}
      isWarning={timeoutTimer.isWarning}
      subtitle={playerName}
      onClose={onClose}
      closeLabel={t('referee.scoring.timeoutEnd')}
    />
  );
}

export default function IndividualScoring() {
  const { t } = useTranslation();
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();

  const {
    // data
    match, matchLoading, updateMatch,
    player1Name, player2Name,
    // game config
    gameConfig,
    // state + setters
    announcement, lastAction,
    scoreFlash,
    showHistory, setShowHistory,
    showSetEndConfirm, setEndMessage, isMatchEnd,
    pendingSideChange, setPendingSideChange,
    setSideChangeDismissed,
    coinTossStep, setCoinTossStep,
    tossWinner, setTossWinner,
    pendingFirstServe, setPendingFirstServe,
    setCourtChangeByLoser,
    player1Coach, setPlayer1Coach,
    player2Coach, setPlayer2Coach,
    syncCoachToFirebase,
    expandedSection, toggleSection,
    foulClassify, setFoulClassify,
    // timers & audio
    sideChangeTimer, warmupTimer, timeoutTimer,
    shortWhistle, longWhistle, goalWhistle, initAudio,
    // golden goal
    goldenGoal,
    // focus trap
    setEndTrapRef,
    // derived modal visibility
    showWarmup, showSideChange,
    // handlers
    handleStartMatch, handleWarmup, handleWalkover,
    handleIBSAScore, handleConfirmSetEnd, handleCancelSetEnd,
    handleUndo, handleChangeServe,
    handleServeMiss, handleDeadBall, handleTimeout,
    handlePenalty, handleQuickFoul, handleClassifyFoul,
    notifyUpdateFailed,
    // derived values
    sets, currentSetIndex, currentSet, setWins,
    currentServe, serveCountVal, serverName, maxServes,
    history,
    p1TimeoutsUsed, p2TimeoutsUsed,
    p1Warnings, p2Warnings, p1Penalties, p2Penalties,
    scoringDisabled, nonGoalDisabled,
  } = useIndividualScoring(tournamentId, matchId);

  // ===== LOADING =====
  if (matchLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-2xl text-gray-400 animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  // ===== NOT FOUND =====
  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-2xl text-red-400">{t('spectator.liveMatch.notFound')}</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    );
  }

  // ===== PENDING: serve selection =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('referee.scoring.matchStartLabel')}</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{player1Name}</span>
          <span className="text-gray-400">vs</span>
          <span className="text-cyan-400 font-bold">{player2Name}</span>
        </div>
        {match.courtName && <p className="text-gray-400 text-lg text-center">{t('referee.home.court')}: {match.courtName}</p>}

        <div className="card w-full max-w-md space-y-3">
          <h2 className="text-lg font-bold text-center text-gray-300">{t('referee.practice.setup.coachOptional')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-yellow-400 mb-1">{player1Name}</label>
              <input
                type="text"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                placeholder={t('referee.practice.setup.coachAriaLabel')}
                value={player1Coach}
                onChange={e => { setPlayer1Coach(e.target.value); syncCoachToFirebase('player1Coach', e.target.value); }}
              />
            </div>
            <div>
              <label className="block text-sm text-cyan-400 mb-1">{player2Name}</label>
              <input
                type="text"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                placeholder={t('referee.practice.setup.coachAriaLabel')}
                value={player2Coach}
                onChange={e => { setPlayer2Coach(e.target.value); syncCoachToFirebase('player2Coach', e.target.value); }}
              />
            </div>
          </div>
        </div>

        {coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.coinToss')}</h2>
            <div className="flex gap-4">
              <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { initAudio(); setTossWinner('player1'); setCoinTossStep('choice'); }}>
                {player1Name}
              </button>
              <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { initAudio(); setTossWinner('player2'); setCoinTossStep('choice'); }}>
                {player2Name}
              </button>
            </div>
          </div>
        )}
        {coinTossStep === 'choice' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">
              {tossWinner === 'player1' ? player1Name : player2Name}!
            </h2>
            <p className="text-gray-400 text-center">{t('referee.scoring.serveChoice')} / {t('referee.scoring.receiveChoice')}</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'player1' ? player1Name : player2Name} ${t('referee.scoring.serveChoice')}`}>
                {t('referee.scoring.serveChoice')}
              </button>
              <button className="btn btn-accent btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner === 'player1' ? 'player2' : 'player1'); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'player1' ? player1Name : player2Name} ${t('referee.scoring.receiveChoice')}`}>
                {t('referee.scoring.receiveChoice')}
              </button>
            </div>
            <div className="text-center">
              <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
                {t('common.back')}
              </button>
            </div>
          </div>
        )}
        {coinTossStep === 'court_change' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.courtChangeTitle')}</h2>
            <p className="text-gray-400 text-center" aria-live="polite">
              {t('referee.scoring.courtChangeQuestion', { loser: tossWinner === 'player1' ? player2Name : player1Name })}
            </p>
            <div className="flex gap-4" role="group" aria-label={t('referee.scoring.courtChangeAriaLabel')}>
              <button
                className="btn btn-primary btn-large flex-1 text-xl py-6"
                onClick={() => { setCourtChangeByLoser(true); setCoinTossStep('warmup_ask'); }}
                aria-label={`${tossWinner === 'player1' ? player2Name : player1Name}: ${t('referee.scoring.courtChangeYesButton')}`}
              >
                {t('referee.scoring.courtChangeYesButton')}
              </button>
              <button
                className="btn bg-gray-700 text-white btn-large flex-1 text-xl py-6"
                onClick={() => { setCourtChangeByLoser(false); setCoinTossStep('warmup_ask'); }}
                aria-label={`${tossWinner === 'player1' ? player2Name : player1Name}: ${t('referee.scoring.courtChangeNoButton')}`}
              >
                {t('referee.scoring.courtChangeNoButton')}
              </button>
            </div>
            <div className="text-center">
              <button className="text-sm text-gray-400 underline" onClick={() => setCoinTossStep('choice')} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
                {t('common.back')}
              </button>
            </div>
          </div>
        )}
        {coinTossStep === 'warmup_ask' && pendingFirstServe && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.warmupStart')}</h2>
            <p className="text-gray-400 text-center">{t('referee.scoring.warmupStart')} (60{t('common.time.seconds')})?</p>
            <div className="flex gap-4">
              <button
                className="btn btn-success btn-large flex-1 text-xl py-6"
                onClick={async () => {
                  try {
                    await handleStartMatch(pendingFirstServe!, true);
                  } catch (err) {
                    showError(String(err));
                  }
                }}
                aria-label={t('referee.scoring.warmupStart')}
              >
                {t('referee.scoring.warmupStart')}
              </button>
              <button
                className="btn btn-accent btn-large flex-1 text-xl py-6"
                onClick={async () => {
                  try {
                    await handleStartMatch(pendingFirstServe!);
                  } catch (err) {
                    showError(String(err));
                  }
                }}
                aria-label={t('referee.scoring.matchStartLabel')}
              >
                {t('referee.scoring.matchStartLabel')}
              </button>
            </div>
            <div className="text-center">
              <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('choice'); setPendingFirstServe(null); }} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
                {t('common.back')}
              </button>
            </div>
          </div>
        )}

        <div className="card w-full max-w-md space-y-4">
          <div className="border-t border-gray-700 pt-3">
            <h3 className="text-sm font-bold text-gray-400 mb-2 text-center">{t('common.scoreActions.walkover')}</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
                onClick={() => handleWalkover(1)}
              >
                {player1Name} {t('common.scoreActions.walkover')}
              </button>
              <button
                className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
                onClick={() => handleWalkover(2)}
              >
                {player2Name} {t('common.scoreActions.walkover')}
              </button>
            </div>
          </div>
        </div>

        <div className="text-center">
          <button className="btn btn-accent" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
        </div>
      </div>
    );
  }

  // ===== COMPLETED =====
  if (match.status === 'completed') {
    const isP2Winner = match.winnerId === match.player2Id;
    const winnerName = isP2Winner ? player2Name : player1Name;
    const loserName = isP2Winner ? player1Name : player2Name;
    const completedSetWins = Array.isArray(match.sets) && match.sets.length > 0 ? countSetWins(match.sets, gameConfig) : { player1: 0, player2: 0 };
    const winSets = isP2Winner ? completedSetWins.player2 : completedSetWins.player1;
    const loseSets = isP2Winner ? completedSetWins.player1 : completedSetWins.player2;
    const completedHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    return (
      <div className="min-h-screen flex flex-col p-4">
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-yellow-400">{t('common.matchStatus.completed')}</h1>
          <div className="text-4xl font-bold text-green-400 mt-2" role="status" aria-live="assertive">🏆 {winnerName}!</div>
          <div className="text-2xl text-gray-300 mt-1" aria-label={`${t('common.units.set')} ${winSets} : ${loseSets}`}>{t('common.units.set')}: {winSets} - {loseSets}</div>
        </div>
        {/* 세트별 결과 - 승자 점수가 먼저 */}
        {match.sets && match.sets.length > 0 && (
          <div className="w-full max-w-lg mx-auto mb-4">
            <div className="grid grid-cols-1 gap-2">
              {match.sets.map((s: SetScore, i: number) => {
                const setWinScore = isP2Winner ? s.player2Score : s.player1Score;
                const setLoseScore = isP2Winner ? s.player1Score : s.player2Score;
                const setWinnerName = s.player1Score > s.player2Score ? player1Name : player2Name;
                return (
                  <div key={i} className="flex justify-between items-center bg-gray-800 rounded px-4 py-2" aria-label={`${t('common.matchHistory.setLabel', { num: i + 1 })}: ${winnerName} ${setWinScore} : ${loserName} ${setLoseScore}`}>
                    <span className="text-sm text-gray-400">{t('common.matchHistory.setLabel', { num: i + 1 })}</span>
                    <span className="text-lg font-bold">
                      <span className="text-green-400">{setWinScore}</span>
                      <span className="text-gray-400"> - </span>
                      <span className="text-gray-300">{setLoseScore}</span>
                    </span>
                    <span className="text-sm text-green-400">🏆 {setWinnerName}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 상세 경기 기록 - 관람 모드와 동일한 형식 */}
        {completedHistory.length > 0 && (
          <div className="w-full max-w-lg mx-auto flex-1 min-h-0">
            <ScoreHistoryView history={completedHistory} sets={match.sets ?? []} />
          </div>
        )}
        <div className="text-center mt-4">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
        </div>
      </div>
    );
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
          subtitle={`${t('referee.practice.setup.individual')} ${t('referee.scoring.warmupStart')} (60${t('common.time.seconds')})`}
          onClose={() => { warmupTimer.stop(); updateMatch({ warmupStartTime: null }); longWhistle(); }}
          closeLabel={t('common.done')}
        />
      )}

      {/* Side Change: Phase 1 - Prompt */}
      {pendingSideChange && !showSideChange && (
        <TimerModal
          title={t('common.matchHistory.sideChange')}
          seconds={0}
          isWarning={false}
          subtitle={t('common.matchHistory.sideChange')}
          onClose={async () => {
            setPendingSideChange(false);
            const ok = await updateMatch({ sideChangeStartTime: Date.now() });
            if (!ok) {
              // Firebase 실패 시에도 경기 진행 가능하도록 바로 해제
              notifyUpdateFailed();
            }
          }}
          closeLabel={`⏱️ ${t('referee.scoring.timeoutTitle.player')} ${t('common.start')}`}
          required
        />
      )}

      {/* Side Change: Phase 2 - Timer countdown */}
      {showSideChange && (
        <TimerModal
          title={t('common.matchHistory.sideChange')}
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle={`1${t('common.time.minutes')}`}
          onClose={() => {
            sideChangeTimer.stop();
            setSideChangeDismissed(true);  // 즉시 UI 닫기
            updateMatch({ sideChangeStartTime: null });  // Firebase 백그라운드 정리
          }}
          closeLabel={t('common.confirm')}
          required
        />
      )}

      {/* Timeout Modal - countdown for player/medical, elapsed for referee */}
      {match.activeTimeout && (match.activeTimeout.type === 'referee' || timeoutTimer.isRunning) && (
        <TimeoutModal
          match={match}
          player1Name={player1Name}
          player2Name={player2Name}
          timeoutTimer={timeoutTimer}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); longWhistle(); }}
        />
      )}

      {/* Set End Confirmation Dialog */}
      {showSetEndConfirm && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onKeyDown={e => { if (e.key === 'Escape' && !isMatchEnd) handleCancelSetEnd(); }}>
          <div ref={setEndTrapRef} className="flex flex-col items-center gap-6 p-8 max-w-sm" role="dialog" aria-modal="true" aria-label={t('common.matchHistory.setResult')}>
            <h2 className="text-2xl font-bold text-yellow-400">{t('common.matchHistory.setResult')}</h2>
            <p className="text-lg text-gray-300 text-center whitespace-pre-line">{setEndMessage}</p>
            <div className="flex gap-4 w-full">
              <button className="btn btn-success btn-large flex-1" onClick={handleConfirmSetEnd}>{t('common.confirm')}</button>
              {!isMatchEnd && (
                <button className="btn btn-secondary btn-large flex-1" onClick={handleCancelSetEnd}>{t('common.cancel')}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/games')} aria-label={t('referee.home.title')}>← {t('referee.home.title')}</button>
          <div className="text-center">
            <h1 className="text-lg font-bold text-yellow-400">{t('common.matchHistory.setLabel', { num: currentSetIndex + 1 })}/{gameConfig.MAX_SETS}</h1>
            <div className="text-sm text-gray-400" aria-label={`${t('common.units.set')} ${setWins.player1} : ${setWins.player2}`}>{t('common.units.set')}: {setWins.player1} - {setWins.player2}</div>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{t('referee.home.mainReferee')}: {match.refereeName}</div>}
            {match.assistantRefereeName && <div>{t('referee.home.assistantReferee')}: {match.assistantRefereeName}</div>}
          </div>
        </div>
      </div>

      {/* Serve display */}
      <div className="bg-blue-900/50 px-4 py-1.5 flex items-center justify-center gap-3" role="status" aria-label={`${serverName} ${t('common.matchHistory.serve')} ${serveCountVal + 1}/${maxServes}`}>
        <span className="text-blue-300 font-semibold text-sm">
          🎾 {serverName} {t('common.matchHistory.serve')} {serveCountVal + 1}/{maxServes}
        </span>
        <button className="text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label={t('common.matchHistory.serve')} style={{ minHeight: '44px', minWidth: '44px' }}>
          {t('common.matchHistory.serve')}
        </button>
      </div>

      {/* Score display - server on left */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-3 px-2 border-r border-gray-700" style={currentServe === 'player1' ? { borderLeft: '3px solid rgba(234,179,8,0.4)' } : undefined}>
          <h2 className="text-lg font-bold text-yellow-400">
            {currentServe === 'player1' && <span aria-hidden="true">🎾 </span>}{player1Name}
          </h2>
          {match.player1Coach && <span className="text-xs text-gray-500">{match.player1Coach}</span>}
          <div key={`p1-${scoreFlash}`} className="text-7xl font-bold my-1 text-yellow-400" style={{ animation: 'scoreFlash 0.3s ease-out' }}>
            {currentSet.player1Score}
          </div>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 font-bold">W{p1Warnings}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-800/60 text-red-300 font-bold">P{p1Penalties}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-800/60 text-blue-300 font-bold">T{p1TimeoutsUsed}</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 px-2" style={currentServe === 'player2' ? { borderRight: '3px solid rgba(6,182,212,0.4)' } : undefined}>
          <h2 className="text-lg font-bold text-cyan-400">
            {currentServe === 'player2' && <span aria-hidden="true">🎾 </span>}{player2Name}
          </h2>
          {match.player2Coach && <span className="text-xs text-gray-500">{match.player2Coach}</span>}
          <div key={`p2-${scoreFlash}`} className="text-7xl font-bold my-1 text-cyan-400" style={{ animation: 'scoreFlash 0.3s ease-out' }}>
            {currentSet.player2Score}
          </div>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 font-bold">W{p2Warnings}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-800/60 text-red-300 font-bold">P{p2Penalties}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-800/60 text-blue-300 font-bold">T{p2TimeoutsUsed}</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* 골든골 타이머/배너 */}
      {goldenGoal.enabled && (
        goldenGoal.isActive ? (
          <div className="mx-4 mt-2 px-4 py-3 rounded-lg bg-red-700 text-white font-bold text-center" role="status" aria-live="assertive">
            <span aria-hidden="true">⏱️ </span>{t('referee.scoring.goldenGoalBanner')}
          </div>
        ) : (
          <div className="mx-4 mt-2 px-4 py-2 rounded-lg bg-gray-800 text-cyan-300 font-mono text-center text-lg">
            ⏱ {Math.floor(goldenGoal.remainingSec / 60)}:{String(goldenGoal.remainingSec % 60).padStart(2, '0')}
          </div>
        )
      )}

      {/* Scoring area - 4 main buttons (1-tap each) */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {(() => {
          return (
            <>
              {/* Row 1: 골 +2 */}
              <div className="grid grid-cols-2 gap-3">
                <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
                  onClick={() => handleIBSAScore(1, 'goal', 2, false, `${player1Name} ${t('common.scoreActions.goal')}`)}
                  aria-label={`${player1Name} ${t('common.scoreActions.goal')} +2`}>
                  ⚽ {player1Name}<br/>{t('common.scoreActions.goal')} +2
                </button>
                <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
                  onClick={() => handleIBSAScore(2, 'goal', 2, false, `${player2Name} ${t('common.scoreActions.goal')}`)}
                  aria-label={`${player2Name} ${t('common.scoreActions.goal')} +2`}>
                  ⚽ {player2Name}<br/>{t('common.scoreActions.goal')} +2
                </button>
              </div>

              {/* Row 2: 파울 +1 (상대에게) */}
              <div className="grid grid-cols-2 gap-3">
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={nonGoalDisabled}
                  onClick={() => handleQuickFoul(1)}
                  aria-label={`${player1Name} ${t('common.scoreActions.foul')}, ${player2Name} +1`}>
                  🟡 {player1Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {player2Name} +1</span>
                </button>
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={nonGoalDisabled}
                  onClick={() => handleQuickFoul(2)}
                  aria-label={`${player2Name} ${t('common.scoreActions.foul')}, ${player1Name} +1`}>
                  🟡 {player2Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {player1Name} +1</span>
                </button>
              </div>

              {/* Row 2.5: 데드볼 + 서브 미스 */}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn bg-purple-700 hover:bg-purple-600 text-white py-3 font-bold"
                  disabled={nonGoalDisabled || match.status !== 'in_progress'}
                  onClick={() => handleDeadBall(match.currentServe === 'player1' ? 1 : 2)}
                  aria-label={t('common.matchHistory.deadBall', { server: '' }).trim()}>
                  🔵 {t('common.matchHistory.deadBall', { server: '' }).trim()}
                </button>
                <button className="btn bg-orange-700 hover:bg-orange-600 text-white py-3 font-bold"
                  disabled={nonGoalDisabled || match.status !== 'in_progress'}
                  onClick={handleServeMiss}
                  aria-label={t('common.scoreActions.serveMiss')}>
                  🎾 {t('common.scoreActions.serveMiss')}
                </button>
              </div>
            </>
          );
        })()}

        {/* Row 3: 취소 / 레프리타임 / 휘슬 */}
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
                <button className="btn btn-secondary text-sm py-2" onClick={() => handleTimeout(1, 'player')} disabled={p1TimeoutsUsed >= 1 || !!match.activeTimeout}
                  aria-label={`${player1Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - p1TimeoutsUsed}/1)`}>
                  ⏱️ {player1Name} {t('referee.scoring.timeoutTitle.player')} ({1 - p1TimeoutsUsed}/1)
                </button>
                <button className="btn btn-secondary text-sm py-2" onClick={() => handleTimeout(2, 'player')} disabled={p2TimeoutsUsed >= 1 || !!match.activeTimeout}
                  aria-label={`${player2Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - p2TimeoutsUsed}/1)`}>
                  ⏱️ {player2Name} {t('referee.scoring.timeoutTitle.player')} ({1 - p2TimeoutsUsed}/1)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(() => {
                  const p1MedicalUsed = history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === player1Name).length;
                  const p2MedicalUsed = history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === player2Name).length;
                  return (
                    <>
                      <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => handleTimeout(1, 'medical')} disabled={!!match.activeTimeout || p1MedicalUsed >= 1}
                        aria-label={`${player1Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - p1MedicalUsed}/1)`}>
                        🏥 {player1Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - p1MedicalUsed}/1)
                      </button>
                      <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => handleTimeout(2, 'medical')} disabled={!!match.activeTimeout || p2MedicalUsed >= 1}
                        aria-label={`${player2Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - p2MedicalUsed}/1)`}>
                        🏥 {player2Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - p2MedicalUsed}/1)
                      </button>
                    </>
                  );
                })()}
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
                  <button key={`p1-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded"
                    disabled={!!match.activeTimeout}
                    onClick={() => handlePenalty(1, pType)}
                    aria-label={`${player1Name} ${label}`}>
                    {player1Name} {label}
                  </button>
                  );
                })}
                {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => {
                  const label = t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`);
                  return (
                  <button key={`p2-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded"
                    disabled={!!match.activeTimeout}
                    onClick={() => handlePenalty(2, pType)}
                    aria-label={`${player2Name} ${label}`}>
                    {player2Name} {label}
                  </button>
                  );
                })}
              </div>
              <div className="border-t border-red-800 pt-2">
                <p className="text-[10px] text-red-400 mb-1">{t('referee.scoring.gogglesTouchHint')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn bg-red-800 hover:bg-red-700 text-white text-xs py-2 rounded font-bold"
                    disabled={!!match.activeTimeout}
                    onClick={async () => handleIBSAScore(1, 'mask_touch', 2, true, t('referee.scoring.gogglesTouchButton', { name: player1Name }))}
                    aria-label={t('referee.scoring.gogglesTouchAriaLabel', { name: player1Name, opponent: player2Name })} style={{ minHeight: '44px' }}>
                    🥽 {t('referee.scoring.gogglesTouchButton', { name: player1Name })}
                  </button>
                  <button className="btn bg-red-800 hover:bg-red-700 text-white text-xs py-2 rounded font-bold"
                    disabled={!!match.activeTimeout}
                    onClick={async () => handleIBSAScore(2, 'mask_touch', 2, true, t('referee.scoring.gogglesTouchButton', { name: player2Name }))}
                    aria-label={t('referee.scoring.gogglesTouchAriaLabel', { name: player2Name, opponent: player1Name })} style={{ minHeight: '44px' }}>
                    🥽 {t('referee.scoring.gogglesTouchButton', { name: player2Name })}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 접이식: 기타 (워밍업/부전승) */}
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
                    aria-label={`${t('referee.scoring.warmupStart')} 60${t('common.time.seconds')}`}>
                    🔥 {t('referee.scoring.warmupStart')} 60{t('common.time.seconds')}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2" onClick={() => handleWalkover(1)} disabled={match.status !== 'in_progress' && match.status !== 'pending'}
                  aria-label={`${player1Name} ${t('common.scoreActions.walkover')}`}>
                  {player1Name} {t('common.scoreActions.walkover')}
                </button>
                <button className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2" onClick={() => handleWalkover(2)} disabled={match.status !== 'in_progress' && match.status !== 'pending'}
                  aria-label={`${player2Name} ${t('common.scoreActions.walkover')}`}>
                  {player2Name} {t('common.scoreActions.walkover')}
                </button>
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
          playerName={foulClassify.player === 1 ? player1Name : player2Name}
          player={foulClassify.player}
          onClassify={handleClassifyFoul}
          onPenalty={async (player, penaltyType) => {
            // Foul로 1점 적용된 것을 먼저 undo한 후 penalty 실행
            await handleUndo();
            setFoulClassify(null);
            handlePenalty(player, penaltyType);
          }}
          onDismiss={() => setFoulClassify(null)}
        />
      )}

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2 text-center">{t('common.matchHistory.setResult')}</h3>
          <div className="flex justify-center gap-4 overflow-x-auto">
            {sets.map((s: SetScore, i: number) => (
              <div key={i} className={`text-center px-3 py-1 rounded ${i === currentSetIndex ? 'bg-gray-700' : ''}`} aria-label={`${t('common.matchHistory.setLabel', { num: i + 1 })}: ${player1Name} ${s.player1Score} : ${player2Name} ${s.player2Score}`} aria-current={i === currentSetIndex ? 'true' : undefined}>
                <div className="text-xs text-gray-400">{t('common.matchHistory.setLabel', { num: i + 1 })}</div>
                <div className="text-lg font-bold">
                  <span className="text-yellow-400">{s.player1Score}</span>
                  <span className="text-gray-400"> - </span>
                  <span className="text-cyan-400">{s.player2Score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
