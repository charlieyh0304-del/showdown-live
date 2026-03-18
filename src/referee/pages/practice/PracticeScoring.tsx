import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePracticeMatch } from '../../hooks/usePracticeMatch';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';
import {
  checkSetWinner,
  checkMatchWinner,
  createEmptySet,
  countSetWins,
  advanceServe,
  revertServe,
  shouldSideChange,
  createScoreHistoryEntry,
  getMaxServes,
} from '@shared/utils/scoring';
import { IBSA_SCORE_ACTIONS } from '@shared/types';
import type { SetScore, ScoreActionType } from '@shared/types';
import { useCountdownTimer } from '../../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../../hooks/useDoubleClickGuard';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useAudioFeedback } from '@shared/hooks/useAudioFeedback';
import { vibrate, hapticPatterns } from '@shared/utils/haptic';
import TimerModal from '../../components/TimerModal';
import SetGroupedHistory from '../../components/SetGroupedHistory';
import ActionToast from '../../components/ActionToast';

export default function PracticeScoring() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addSession } = usePracticeHistory();
  const { canAct } = useDoubleClickGuard();
  const audio = useAudioFeedback();

  const matchType = (searchParams.get('type') || 'individual') as 'individual' | 'team';
  const p1Name = searchParams.get('p1') || '연습선수A';
  const p2Name = searchParams.get('p2') || '연습선수B';
  const config = JSON.parse(searchParams.get('config') || '{"SETS_TO_WIN":2,"MAX_SETS":3,"POINTS_TO_WIN":11,"MIN_POINT_DIFF":2}');

  const { match, updateMatch, startMatch, addAction } = usePracticeMatch({
    matchType,
    player1Name: p1Name,
    player2Name: p2Name,
    config,
  });

  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);
  const [showSideChange, setShowSideChange] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSetEndConfirm, setShowSetEndConfirm] = useState(false);
  const [setEndMessage, setSetEndMessage] = useState('');
  // Warmup
  const [showWarmup, setShowWarmup] = useState(false);
  // Pause
  const [isPausedLocal, setIsPausedLocal] = useState(false);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const [pauseReason, setPauseReason] = useState('');

  const setEndTrapRef = useFocusTrap(showSetEndConfirm);

  // Timers
  const sideChangeTimer = useCountdownTimer(() => setShowSideChange(false));
  const warmupTimer = useCountdownTimer(() => setShowWarmup(false));
  const timeoutTimer = useCountdownTimer(() => updateMatch({ activeTimeout: null }));

  // 15초 안내 (타임아웃)
  useEffect(() => {
    if (timeoutTimer.seconds === 15 && timeoutTimer.isRunning) {
      setLastAction('⚠️ 15초 남았습니다');
      setAnnouncement('15초 남았습니다');
    }
  }, [timeoutTimer.seconds]);

  // 15초 안내 (사이드 체인지)
  useEffect(() => {
    if (sideChangeTimer.seconds === 15 && sideChangeTimer.isRunning) {
      setLastAction('⚠️ 사이드 체인지 15초 남았습니다');
      setAnnouncement('15초 남았습니다');
    }
  }, [sideChangeTimer.seconds]);

  // 15초 안내 (워밍업)
  useEffect(() => {
    if (warmupTimer.seconds === 15 && warmupTimer.isRunning) {
      setLastAction('⚠️ 워밍업 15초 남았습니다');
      setAnnouncement('15초 남았습니다');
    }
  }, [warmupTimer.seconds]);

  // localStorage sharing (spectator mode)
  useEffect(() => {
    if (match.status === 'in_progress') {
      localStorage.setItem('showdown_practice_live', JSON.stringify([match]));
    } else if (match.status === 'completed') {
      localStorage.removeItem('showdown_practice_live');
    }
    return () => { localStorage.removeItem('showdown_practice_live'); };
  }, [match]);

  // Timeout timer
  useEffect(() => {
    if (match.activeTimeout) {
      const elapsed = Math.floor((Date.now() - match.activeTimeout.startTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      if (remaining > 0) timeoutTimer.start(remaining);
    } else {
      timeoutTimer.stop();
    }
  }, [match.activeTimeout]);

  // Pause elapsed counter
  useEffect(() => {
    if (!isPausedLocal) return;
    const interval = setInterval(() => setPauseElapsed(p => p + 1), 1000);
    return () => clearInterval(interval);
  }, [isPausedLocal]);

  // Warmup
  const handleWarmup = useCallback(() => {
    if (match.warmupUsed) return;
    updateMatch({ warmupUsed: true });
    const warmupSeconds = matchType === 'team' ? 90 : 60;
    warmupTimer.start(warmupSeconds);
    setShowWarmup(true);
  }, [match.warmupUsed, matchType, updateMatch, warmupTimer]);

  // Pause
  const handlePause = useCallback(() => {
    if (match.status !== 'in_progress' || isPausedLocal) return;
    const reason = prompt('일시정지 사유를 입력하세요:\n(예: 부상, 장비 문제, 기타)');
    if (reason === null) return;
    const actualReason = reason || '사유 없음';
    setIsPausedLocal(true);
    setPauseReason(actualReason);
    setPauseElapsed(0);
    const pauseEntry = {
      time: new Date().toLocaleTimeString('ko-KR'),
      reason: actualReason,
      set: match.currentSet + 1,
    };
    updateMatch({ isPaused: true, pauseHistory: [...match.pauseHistory, pauseEntry] });
  }, [match.status, match.currentSet, match.pauseHistory, isPausedLocal, updateMatch]);

  const handleResume = useCallback(() => {
    const updated = [...match.pauseHistory];
    if (updated.length > 0) {
      updated[updated.length - 1] = { ...updated[updated.length - 1], duration: pauseElapsed };
    }
    setIsPausedLocal(false);
    setPauseElapsed(0);
    setPauseReason('');
    updateMatch({ isPaused: false, pauseHistory: updated });
  }, [match.pauseHistory, pauseElapsed, updateMatch]);

  // IBSA score
  const handleIBSAScore = useCallback((
    actingPlayer: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!canAct()) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout) return;

    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    const scoreBefore = { player1: cs.player1Score, player2: cs.player2Score };
    const scoringPlayer = toOpponent ? (actingPlayer === 1 ? 2 : 1) : actingPlayer;

    if (scoringPlayer === 1) cs.player1Score += points;
    else cs.player2Score += points;
    sets[ci] = cs;

    const scoreAfter = { player1: cs.player1Score, player2: cs.player2Score };

    const serverName = match.currentServe === 'player1' ? p1Name : p2Name;
    const serveNumber = match.serveCount + 1;

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: scoringPlayer === 1 ? p1Name : p2Name,
      actionPlayer: actingPlayer === 1 ? p1Name : p2Name,
      actionType, actionLabel: label, points,
      set: ci + 1,
      server: serverName, serveNumber,
      scoreBefore, scoreAfter,
    });

    const newHistory = [historyEntry, ...match.scoreHistory];

    const { currentServe: nextServe, serveCount: nextCount } = advanceServe(
      match.currentServe, match.serveCount, matchType,
    );

    addAction({ type: 'score', player: actingPlayer, detail: `${label} (${points}점)` });
    audio.scoreUp();
    vibrate(hapticPatterns.scoreUp);
    setScoreFlash(f => f + 1);

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;

    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${pName} +${points}점`
      : `${pName} 골! +${points}점`;
    setLastAction(`${actionDesc} | ${scoreAfter.player1} : ${scoreAfter.player2}`);

    const serverScore = nextServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = nextServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;
    setAnnouncement(
      `${pName} ${points}점. 스코어 ${serverScore} 대 ${receiverScore}. ${nextServerName} ${nextCount + 1}번째 서브`
    );

    // Set winner check with confirmation
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, config);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? 'player1' : 'player2';
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, config);

      // Save state first
      updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
      });

      // Show confirmation after 500ms delay
      setTimeout(() => {
        if (matchWinner) {
          const winnerName = matchWinner === 1 ? p1Name : p2Name;
          const setWinsCalc = countSetWins(sets, config);
          setSetEndMessage(`경기 종료!\n\n${winnerName} 승리! (세트 ${setWinsCalc.player1}:${setWinsCalc.player2})\n현재 점수: ${cs.player1Score} - ${cs.player2Score}`);
        } else {
          const setWinsCalc = countSetWins(sets, config);
          setSetEndMessage(`세트 ${ci + 1}을(를) 종료하시겠습니까?\n\n현재 점수: ${cs.player1Score} - ${cs.player2Score}\n세트 스코어: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
        }
        setShowSetEndConfirm(true);
      }, 500);
      return;
    }

    // Side change
    if (shouldSideChange(matchType, cs, match.sideChangeUsed, sets, config)) {
      updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
      });
      sideChangeTimer.start(60);
      setShowSideChange(true);
      return;
    }

    updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
    });
  }, [match, config, updateMatch, addAction, p1Name, p2Name, matchType, canAct, sideChangeTimer]);

  // Confirm set end
  const handleConfirmSetEnd = useCallback(() => {
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;

    const matchWinner = checkMatchWinner(sets, config);
    if (matchWinner) {
      const winnerId = matchWinner === 1 ? 'player1' : 'player2';
      updateMatch({
        sets, status: 'completed', winnerId, completedAt: Date.now(),
      });
      audio.matchComplete();
      vibrate(hapticPatterns.matchComplete);
      addSession({
        id: crypto.randomUUID(),
        date: Date.now(),
        matchType,
        sessionType: 'free',
        duration: Math.floor((Date.now() - match.startedAt) / 1000),
        totalActions: match.actionLog.length + 1,
        finalScore: sets.map(s => `${s.player1Score}-${s.player2Score}`).join(', '),
      });
    } else {
      audio.setComplete();
      vibrate(hapticPatterns.setComplete);
      sets.push(createEmptySet());
      updateMatch({
        sets, currentSet: ci + 1,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        sideChangeUsed: false,
      });
    }
    setShowSetEndConfirm(false);
  }, [match, config, updateMatch, matchType]);

  const handleCancelSetEnd = useCallback(() => {
    setShowSetEndConfirm(false);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (match.status !== 'in_progress' || match.scoreHistory.length === 0) return;

    const lastEntry = match.scoreHistory[0];
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    cs.player1Score = lastEntry.scoreBefore.player1;
    cs.player2Score = lastEntry.scoreBefore.player2;
    cs.winnerId = null;
    sets[ci] = cs;

    const { currentServe, serveCount } = revertServe(
      match.currentServe, match.serveCount, matchType,
    );

    updateMatch({ sets, currentServe, serveCount, scoreHistory: match.scoreHistory.slice(1) });
    const serverAfterUndo = currentServe === 'player1' ? p1Name : p2Name;
    const msg = `취소됨. ${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}. ${serverAfterUndo} 서브`;
    setAnnouncement(msg);
    setLastAction(`↩️ ${msg}`);
  }, [match, updateMatch, p1Name, p2Name, matchType]);

  const handleChangeServe = useCallback(() => {
    if (match.status !== 'in_progress') return;
    updateMatch({
      currentServe: match.currentServe === 'player1' ? 'player2' : 'player1',
      serveCount: 0,
    });
    const newServer = match.currentServe === 'player1' ? p2Name : p1Name;
    setAnnouncement(`서브권 변경: ${newServer}`);
  }, [match, updateMatch, p1Name, p2Name]);

  const handleTimeout = useCallback((player: 1 | 2) => {
    if (match.status !== 'in_progress') return;
    const used = player === 1 ? match.player1Timeouts : match.player2Timeouts;
    if (used >= 1) return;
    const up: Partial<typeof match> = {
      activeTimeout: { playerId: `player${player}`, startTime: Date.now() },
    };
    if (player === 1) up.player1Timeouts = match.player1Timeouts + 1;
    else up.player2Timeouts = match.player2Timeouts + 1;
    updateMatch(up);
    addAction({ type: 'timeout', player });
  }, [match, updateMatch, addAction]);

  // ===== PENDING =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>연습 경기</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{p1Name}</span>
          <span className="text-gray-500">vs</span>
          <span className="text-cyan-400 font-bold">{p2Name}</span>
        </div>
        <p className="text-gray-400">
          {matchType === 'team' ? '31점 단판' : `${config.POINTS_TO_WIN}점 | ${config.SETS_TO_WIN}세트 선승`}
        </p>

        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center text-gray-300">첫 서브 선택</h2>
          <div className="flex gap-4">
            <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => startMatch('player1')}>
              🎾 {p1Name}
            </button>
            <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => startMatch('player2')}>
              🎾 {p2Name}
            </button>
          </div>
        </div>

        <button className="btn btn-accent" onClick={() => navigate('/referee/practice/setup')}>설정으로</button>
      </div>
    );
  }

  // ===== COMPLETED =====
  if (match.status === 'completed') {
    const winnerName = match.winnerId === 'player1' ? p1Name : p2Name;
    const setWins = countSetWins(match.sets, config);
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>연습 경기 종료</h1>
        <div className="text-4xl font-bold text-green-400">{winnerName} 승리!</div>
        <div className="text-2xl text-gray-300">세트 스코어: {setWins.player1} - {setWins.player2}</div>
        {match.sets.map((s: SetScore, i: number) => {
          const winner = s.player1Score > s.player2Score ? p1Name : p2Name;
          return (
            <div key={i} className="text-lg text-gray-400">
              세트 {i + 1}: {s.player1Score} - {s.player2Score} ({winner} 승)
            </div>
          );
        })}
        <p className="text-gray-400">총 조작: {match.actionLog.length}회 | 소요시간: {Math.floor((match.completedAt! - match.startedAt) / 1000)}초</p>

        {match.scoreHistory.length > 0 && (
          <div className="w-full max-w-lg">
            <h3 className="text-lg font-bold text-gray-300 mb-2">경기 기록 ({match.scoreHistory.length})</h3>
            <div className="max-h-60 overflow-y-auto">
              <SetGroupedHistory history={match.scoreHistory} sets={match.sets} showAll />
            </div>
          </div>
        )}

        <div className="flex gap-4">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/practice/setup')}>다시 하기</button>
          <button className="btn btn-secondary btn-large" onClick={() => navigate('/referee/practice')}>홈으로</button>
        </div>
      </div>
    );
  }

  // ===== IN_PROGRESS =====
  const sets = match.sets;
  const ci = match.currentSet;
  const cs = sets[ci] ?? createEmptySet();
  const setWins = countSetWins(sets, config);
  const serverName = match.currentServe === 'player1' ? p1Name : p2Name;
  const maxServes = getMaxServes(matchType);

  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);
  const penaltyActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points >= 2);

  // Server-based score flip
  const isFlipped = match.currentServe === 'player2';
  const leftName = isFlipped ? p2Name : p1Name;
  const rightName = isFlipped ? p1Name : p2Name;
  const leftScore = isFlipped ? cs.player2Score : cs.player1Score;
  const rightScore = isFlipped ? cs.player1Score : cs.player2Score;
  const leftColor = isFlipped ? 'text-cyan-400' : 'text-yellow-400';
  const rightColor = isFlipped ? 'text-yellow-400' : 'text-cyan-400';

  return (
    <div className="min-h-screen flex flex-col">
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>
      <ActionToast message={lastAction} />

      {/* Warmup Timer Modal */}
      {showWarmup && warmupTimer.isRunning && (
        <TimerModal
          title="🔥 워밍업"
          seconds={warmupTimer.seconds}
          isWarning={warmupTimer.isWarning}
          subtitle={matchType === 'team' ? '팀전 워밍업 (90초)' : '개인전 워밍업 (60초)'}
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); }}
          closeLabel="워밍업 종료"
        />
      )}

      {/* Side Change Timer */}
      {showSideChange && (
        <TimerModal
          title="사이드 체인지!"
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle="1분 휴식"
          onClose={() => { sideChangeTimer.stop(); setShowSideChange(false); }}
          closeLabel="확인"
        />
      )}

      {/* Timeout Modal */}
      {match.activeTimeout && timeoutTimer.isRunning && (
        <TimerModal
          title="타임아웃"
          seconds={timeoutTimer.seconds}
          isWarning={timeoutTimer.isWarning}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); }}
          closeLabel="타임아웃 종료"
        />
      )}

      {/* Set End Confirmation */}
      {showSetEndConfirm && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} role="dialog" aria-modal="true" aria-label="세트 종료 확인">
          <div ref={setEndTrapRef} className="flex flex-col items-center gap-6 p-8 max-w-sm">
            <h2 className="text-2xl font-bold text-yellow-400">세트 종료 확인</h2>
            <p className="text-lg text-gray-300 text-center whitespace-pre-line">{setEndMessage}</p>
            <div className="flex gap-4 w-full">
              <button className="btn btn-success btn-large flex-1" onClick={handleConfirmSetEnd}>확인</button>
              <button className="btn btn-secondary btn-large flex-1" onClick={handleCancelSetEnd}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Banner */}
      {isPausedLocal && (
        <div className="bg-orange-900/80 px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-orange-300 font-bold">⏸️ 경기 일시정지</span>
            <span className="text-orange-200 ml-3">
              {Math.floor(pauseElapsed / 60)}:{(pauseElapsed % 60).toString().padStart(2, '0')}
            </span>
            {pauseReason && <span className="text-orange-200/70 ml-3 text-sm">({pauseReason})</span>}
          </div>
          <button className="btn btn-success text-sm px-4 py-1" onClick={handleResume}>▶ 재개</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/practice')}>← 연습 홈</button>
          <div className="text-center">
            <div className="text-lg font-bold" style={{ color: '#c084fc' }}>
              {matchType === 'team' ? '팀전 31점' : `세트 ${ci + 1}/${config.MAX_SETS}`}
            </div>
            {matchType === 'individual' && (
              <div className="text-sm text-gray-400">세트 스코어: {setWins.player1} - {setWins.player2}</div>
            )}
          </div>
          <div className="text-sm text-gray-500">연습</div>
        </div>
      </div>

      {/* Serve */}
      <div className="bg-blue-900/50 px-4 py-2 text-center">
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {match.serveCount + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe}>
          서브권 변경
        </button>
      </div>

      {/* Score display - server on left */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-4 px-2 border-r border-gray-700">
          <h2 className={`text-xl font-bold ${leftColor}`}>
            🎾 {leftName}
          </h2>
          <div key={`left-${scoreFlash}`} className={`text-7xl font-bold my-2 ${leftColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${leftName} ${leftScore}점`}>
            {leftScore}
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-4 px-2">
          <h2 className={`text-xl font-bold ${rightColor}`}>
            {rightName}
          </h2>
          <div key={`right-${scoreFlash}`} className={`text-7xl font-bold my-2 ${rightColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${rightName} ${rightScore}점`}>
            {rightScore}
          </div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* Scoring area (buttons always p1 left, p2 right - muscle memory) */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center text-yellow-400 font-bold text-lg">{p1Name}</div>
          <div className="text-center text-cyan-400 font-bold text-lg">{p2Name}</div>
        </div>

        {/* Goal */}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn bg-green-800 hover:bg-green-700 text-white text-lg py-5 font-bold rounded-xl"
            disabled={!!match.activeTimeout || isPausedLocal}
            onClick={() => handleIBSAScore(1, 'goal', 2, false, `${p1Name} 골`)}
          >
            ⚽ 골 +2
          </button>
          <button
            className="btn bg-green-800 hover:bg-green-700 text-white text-lg py-5 font-bold rounded-xl"
            disabled={!!match.activeTimeout || isPausedLocal}
            onClick={() => handleIBSAScore(2, 'goal', 2, false, `${p2Name} 골`)}
          >
            ⚽ 골 +2
          </button>
        </div>

        {/* Fouls */}
        <div className="text-center text-xs text-gray-500 font-semibold">파울 (상대에게 +1점)</div>
        {foulActions.map(action => (
          <div key={action.type} className="grid grid-cols-2 gap-2">
            <button
              className="btn bg-yellow-900/80 hover:bg-yellow-800 text-yellow-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal}
              onClick={() => handleIBSAScore(1, action.type, action.points, true, `${p1Name} ${action.label}`)}
            >
              🟡 {p1Name} {action.label}<br/>
              <span className="text-xs opacity-75">→ {p2Name} +1점</span>
            </button>
            <button
              className="btn bg-yellow-900/80 hover:bg-yellow-800 text-yellow-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal}
              onClick={() => handleIBSAScore(2, action.type, action.points, true, `${p2Name} ${action.label}`)}
            >
              🟡 {p2Name} {action.label}<br/>
              <span className="text-xs opacity-75">→ {p1Name} +1점</span>
            </button>
          </div>
        ))}

        {/* Penalties */}
        <div className="text-center text-xs text-gray-500 font-semibold">벌점 (상대에게 +2점)</div>
        {penaltyActions.map(action => (
          <div key={action.type} className="grid grid-cols-2 gap-2">
            <button
              className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal}
              onClick={() => handleIBSAScore(1, action.type, action.points, true, `${p1Name} ${action.label}`)}
            >
              🔴 {p1Name} {action.label}<br/>
              <span className="text-xs opacity-75">→ {p2Name} +{action.points}점</span>
            </button>
            <button
              className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal}
              onClick={() => handleIBSAScore(2, action.type, action.points, true, `${p2Name} ${action.label}`)}
            >
              🔴 {p2Name} {action.label}<br/>
              <span className="text-xs opacity-75">→ {p1Name} +{action.points}점</span>
            </button>
          </div>
        ))}

        {/* History (set-grouped) */}
        <div>
          <button
            className="text-sm text-gray-400 underline mb-2"
            onClick={() => setShowHistory(!showHistory)}
          >
            {showHistory ? '▲ 경기 기록 닫기' : `▼ 경기 기록 (${match.scoreHistory.length})`}
          </button>
          {showHistory && match.scoreHistory.length > 0 && (
            <div className="max-h-48 overflow-y-auto">
              <SetGroupedHistory history={match.scoreHistory} sets={sets} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom fixed action bar */}
      <div className="bg-gray-900 border-t border-gray-700 px-3 py-2">
        <div className="flex gap-2">
          <button
            className="btn btn-danger flex-1 py-3"
            onClick={handleUndo}
            disabled={match.scoreHistory.length === 0}
          >
            ↩️ 취소
          </button>
          <button
            className="btn btn-secondary flex-1 py-3 text-sm"
            onClick={() => handleTimeout(1)}
            disabled={match.player1Timeouts >= 1 || !!match.activeTimeout}
            aria-label={`${p1Name} 타임아웃 요청, 남은 횟수 ${1 - match.player1Timeouts}회`}
          >
            {p1Name} 타임아웃
            <span className="block text-xs opacity-75">남은 횟수: {1 - match.player1Timeouts}</span>
          </button>
          <button
            className="btn btn-secondary flex-1 py-3 text-sm"
            onClick={() => handleTimeout(2)}
            disabled={match.player2Timeouts >= 1 || !!match.activeTimeout}
            aria-label={`${p2Name} 타임아웃 요청, 남은 횟수 ${1 - match.player2Timeouts}회`}
          >
            {p2Name} 타임아웃
            <span className="block text-xs opacity-75">남은 횟수: {1 - match.player2Timeouts}</span>
          </button>
        </div>
        {/* Warmup + Pause */}
        <div className="flex gap-2 mt-2">
          {!match.warmupUsed && (
            <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white py-2 text-sm" onClick={handleWarmup}>
              🔥 워밍업 {matchType === 'team' ? '90초' : '60초'}
            </button>
          )}
          {!isPausedLocal && (
            <button className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white py-2 text-sm" onClick={handlePause}>
              ⏸️ 일시정지
            </button>
          )}
        </div>
      </div>

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <div className="flex gap-4 overflow-x-auto">
            {sets.map((s: SetScore, i: number) => (
              <div key={i} className={`text-center px-3 py-1 rounded ${i === ci ? 'bg-gray-700' : ''}`}>
                <div className="text-xs text-gray-500">세트 {i + 1}</div>
                <div className="text-lg font-bold">
                  <span className="text-yellow-400">{s.player1Score}</span>
                  <span className="text-gray-500"> - </span>
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
