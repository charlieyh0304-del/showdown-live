import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatch, useTournament } from '@shared/hooks/useFirebase';
import {
  checkSetWinner,
  checkMatchWinner,
  createEmptySet,
  getEffectiveGameConfig,
  countSetWins,
  advanceServe,
  revertServe,
  shouldSideChange,
  createScoreHistoryEntry,
  getMaxServes,
} from '@shared/utils/scoring';
import { useAudioFeedback } from '@shared/hooks/useAudioFeedback';
import { useKeyboardShortcuts } from '@shared/hooks/useKeyboardShortcuts';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { vibrate, hapticPatterns } from '@shared/utils/haptic';
import { IBSA_SCORE_ACTIONS } from '@shared/types';
import type { SetScore, ScoreActionType, ScoreHistoryEntry } from '@shared/types';
import { autoBackupDebounced, autoBackupToLocal } from '@shared/utils/backup';
import { useCountdownTimer } from '../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../hooks/useDoubleClickGuard';
import { useFocusTrap } from '../hooks/useFocusTrap';
import TimerModal from '../components/TimerModal';
import SetGroupedHistory from '../components/SetGroupedHistory';
import ActionToast from '../components/ActionToast';

export default function IndividualScoring() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);
  const audio = useAudioFeedback();
  const { canAct } = useDoubleClickGuard();

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

  const gameConfig = getEffectiveGameConfig(tournament?.scoringRules || tournament?.gameConfig);
  useNavigationGuard(match?.status === 'in_progress');
  const setEndTrapRef = useFocusTrap(showSetEndConfirm);

  // Timers
  const sideChangeTimer = useCountdownTimer(() => setShowSideChange(false));
  const warmupTimer = useCountdownTimer(() => setShowWarmup(false));
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
  });

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

  // Start timeout timer when activeTimeout changes
  useEffect(() => {
    if (match?.activeTimeout) {
      const elapsed = Math.floor((Date.now() - match.activeTimeout.startTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      if (remaining > 0) timeoutTimer.start(remaining);
    } else {
      timeoutTimer.stop();
    }
  }, [match?.activeTimeout]);

  // Pause elapsed time counter
  useEffect(() => {
    if (!isPausedLocal) return;
    const interval = setInterval(() => setPauseElapsed(p => p + 1), 1000);
    return () => clearInterval(interval);
  }, [isPausedLocal]);

  // Sync pause state from match
  useEffect(() => {
    if (match?.isPaused && !isPausedLocal) {
      setIsPausedLocal(true);
      setPauseReason(match.pauseReason ?? '');
      setPauseElapsed(match.pauseStartTime ? Math.floor((Date.now() - match.pauseStartTime) / 1000) : 0);
    }
  }, [match?.isPaused]);

  const handleStartMatch = useCallback(async (firstServe: 'player1' | 'player2') => {
    if (!match) return;
    await updateMatch({
      status: 'in_progress',
      sets: [createEmptySet()],
      currentSet: 0,
      player1Timeouts: 0,
      player2Timeouts: 0,
      activeTimeout: null,
      currentServe: firstServe,
      serveCount: 0,
      serveSelected: true,
      sideChangeUsed: false,
      scoreHistory: [],
      warmupUsed: false,
    });
  }, [match, updateMatch]);

  // Warmup
  const handleWarmup = useCallback(() => {
    if (!match || match.warmupUsed) return;
    updateMatch({ warmupUsed: true });
    warmupTimer.start(60); // Individual: 60 seconds
    setShowWarmup(true);
  }, [match, updateMatch, warmupTimer]);

  // Pause
  const handlePause = useCallback(async () => {
    if (!match || match.status !== 'in_progress' || isPausedLocal) return;
    const reason = prompt('일시정지 사유를 입력하세요:\n(예: 부상, 장비 문제, 기타)');
    if (reason === null) return;
    setIsPausedLocal(true);
    setPauseReason(reason || '사유 없음');
    setPauseElapsed(0);
    const pauseEntry = {
      time: new Date().toLocaleTimeString('ko-KR'),
      reason: reason || '사유 없음',
      set: (match.currentSet ?? 0) + 1,
    };
    const prevPauseHistory = match.pauseHistory ?? [];
    await updateMatch({
      isPaused: true, pauseReason: reason || '사유 없음', pauseStartTime: Date.now(),
      pauseHistory: [...prevPauseHistory, pauseEntry],
    });
  }, [match, updateMatch, isPausedLocal]);

  const handleResume = useCallback(async () => {
    if (!match) return;
    setIsPausedLocal(false);
    const prevPauseHistory = match.pauseHistory ?? [];
    const updated = [...prevPauseHistory];
    if (updated.length > 0) {
      updated[updated.length - 1] = { ...updated[updated.length - 1], duration: pauseElapsed };
    }
    setPauseElapsed(0);
    setPauseReason('');
    await updateMatch({ isPaused: false, pauseReason: '', pauseStartTime: undefined, pauseHistory: updated });
  }, [match, updateMatch, pauseElapsed]);

  // IBSA score
  const handleIBSAScore = useCallback(async (
    actingPlayer: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!canAct()) return;
    if (!match?.sets || match.currentSet === undefined) return;
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

    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
    const currentServe = match.currentServe ?? 'player1';
    const serveCount = match.serveCount ?? 0;
    const serverName = currentServe === 'player1' ? p1Name : p2Name;
    const serveNumber = serveCount + 1;

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: scoringPlayer === 1 ? p1Name : p2Name,
      actionPlayer: actingPlayer === 1 ? p1Name : p2Name,
      actionType, actionLabel: label, points,
      set: ci + 1,
      server: serverName, serveNumber,
      scoreBefore, scoreAfter,
    });

    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    const newHistory = [historyEntry, ...prevHistory];

    const { currentServe: nextServe, serveCount: nextCount } = advanceServe(
      currentServe, serveCount, 'individual',
    );

    audio.scoreUp();
    vibrate(hapticPatterns.scoreUp);
    setScoreFlash(f => f + 1);

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;

    // 시각적 피드백: 누가 무엇을 했고 → 누가 득점했는지 명확히 표시
    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${pName} +${points}점`
      : `${pName} 골! +${points}점`;
    setLastAction(`${actionDesc} | ${scoreAfter.player1} : ${scoreAfter.player2}`);

    const serverScore = nextServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = nextServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;
    setAnnouncement(
      `${pName} ${points}점. 스코어 ${serverScore} 대 ${receiverScore}. ${nextServerName} ${nextCount + 1}번째 서브`
    );

    // Set winner check with confirmation dialog
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, gameConfig);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, gameConfig);

      // Save state first
      await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
      });

      // Show confirmation after 500ms delay
      setTimeout(() => {
        if (matchWinner) {
          const winnerName = matchWinner === 1 ? p1Name : p2Name;
          const setWinsCalc = countSetWins(sets, gameConfig);
          setSetEndMessage(`경기 종료!\n\n${winnerName} 승리! (세트 ${setWinsCalc.player1}:${setWinsCalc.player2})\n현재 점수: ${cs.player1Score} - ${cs.player2Score}`);
        } else {
          const setWinsCalc = countSetWins(sets, gameConfig);
          setSetEndMessage(`세트 ${ci + 1}을(를) 종료하시겠습니까?\n\n현재 점수: ${cs.player1Score} - ${cs.player2Score}\n세트 스코어: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
        }
        setShowSetEndConfirm(true);
      }, 500);
      return;
    }

    // Side change check
    if (shouldSideChange('individual', cs, match.sideChangeUsed ?? false, sets, gameConfig) && !match.activeTimeout) {
      await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
      });
      sideChangeTimer.start(60);
      setShowSideChange(true);
      return;
    }

    await updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
    });
    if (tournamentId) autoBackupDebounced(tournamentId);
  }, [match, gameConfig, updateMatch, audio, canAct, sideChangeTimer, tournamentId]);

  // Confirm set end
  const handleConfirmSetEnd = useCallback(async () => {
    if (!match?.sets) return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet ?? 0;

    const matchWinner = checkMatchWinner(sets, gameConfig);
    if (matchWinner) {
      const winnerId = matchWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      audio.matchComplete();
      vibrate(hapticPatterns.matchComplete);
      await updateMatch({ sets, status: 'completed', winnerId });
      if (tournamentId) autoBackupToLocal(tournamentId);
    } else {
      audio.setComplete();
      vibrate(hapticPatterns.setComplete);
      sets.push(createEmptySet());
      await updateMatch({
        sets, currentSet: ci + 1,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        sideChangeUsed: false,
      });
    }
    setShowSetEndConfirm(false);
  }, [match, gameConfig, updateMatch, audio]);

  const handleCancelSetEnd = useCallback(() => {
    setShowSetEndConfirm(false);
  }, []);

  // Undo
  const handleUndo = useCallback(async () => {
    if (!match) return;
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    if (history.length === 0) return;

    const lastEntry = history[0];
    const sets = [...(match.sets ?? []).map(s => ({ ...s }))];
    const ci = match.currentSet ?? 0;
    const cs = { ...sets[ci] };

    cs.player1Score = lastEntry.scoreBefore.player1;
    cs.player2Score = lastEntry.scoreBefore.player2;
    cs.winnerId = null;
    sets[ci] = cs;

    const { currentServe, serveCount } = revertServe(
      match.currentServe ?? 'player1', match.serveCount ?? 0, 'individual',
    );

    await updateMatch({
      sets, currentServe, serveCount, scoreHistory: history.slice(1),
    });

    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
    const undoServerName = currentServe === 'player1' ? p1Name : p2Name;
    const msg = `취소됨. ${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}. ${undoServerName} 서브`;
    setAnnouncement(msg);
    setLastAction(`↩️ ${msg}`);
  }, [match, updateMatch]);

  const handleChangeServe = useCallback(async () => {
    if (!match || match.status !== 'in_progress') return;
    await updateMatch({
      currentServe: (match.currentServe ?? 'player1') === 'player1' ? 'player2' : 'player1',
      serveCount: 0,
    });
  }, [match, updateMatch]);

  const handleTimeout = useCallback(async (player: 1 | 2) => {
    if (!match || match.status !== 'in_progress') return;
    const usedTimeouts = player === 1 ? (match.player1Timeouts ?? 0) : (match.player2Timeouts ?? 0);
    if (usedTimeouts >= 1) return;
    const playerId = player === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
    const timeoutUpdate: Record<string, unknown> = {
      activeTimeout: { playerId, startTime: Date.now() },
    };
    if (player === 1) timeoutUpdate.player1Timeouts = (match.player1Timeouts ?? 0) + 1;
    else timeoutUpdate.player2Timeouts = (match.player2Timeouts ?? 0) + 1;
    await updateMatch(timeoutUpdate);
  }, [match, updateMatch]);

  // Debug: log match data to help diagnose rendering errors
  useEffect(() => {
    if (match) {
      console.log('[IndividualScoring] match loaded:', {
        id: match.id,
        status: match.status,
        setsType: typeof match.sets,
        setsIsArray: Array.isArray(match.sets),
        sets: match.sets,
        currentSet: match.currentSet,
        player1Name: match.player1Name,
        player2Name: match.player2Name,
      });
    }
  }, [match]);

  if (matchLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-2xl text-gray-400 animate-pulse">경기 로딩 중...</p>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-2xl text-red-400">경기를 찾을 수 없습니다.</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>목록으로</button>
      </div>
    );
  }

  const player1Name = match.player1Name ?? '선수1';
  const player2Name = match.player2Name ?? '선수2';

  // ===== PENDING: serve selection =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">경기 준비</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{player1Name}</span>
          <span className="text-gray-500">vs</span>
          <span className="text-cyan-400 font-bold">{player2Name}</span>
        </div>
        {match.courtName && <p className="text-gray-400 text-lg">코트: {match.courtName}</p>}

        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center text-gray-300">첫 서브 선택</h2>
          <div className="flex gap-4">
            <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => handleStartMatch('player1')}>
              🎾 {player1Name}
            </button>
            <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => handleStartMatch('player2')}>
              🎾 {player2Name}
            </button>
          </div>
        </div>

        <button className="btn btn-accent" onClick={() => navigate('/referee/games')}>목록으로</button>
      </div>
    );
  }

  // ===== COMPLETED =====
  if (match.status === 'completed') {
    const winnerName = match.winnerId === match.player1Id ? player1Name : player2Name;
    const setWins = Array.isArray(match.sets) && match.sets.length > 0 ? countSetWins(match.sets, gameConfig) : { player1: 0, player2: 0 };
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">경기 종료</h1>
        <div className="text-4xl font-bold text-green-400">{winnerName} 승리!</div>
        <div className="text-2xl text-gray-300">세트 스코어: {setWins.player1} - {setWins.player2}</div>
        {match.sets && match.sets.map((s: SetScore, i: number) => {
          const winner = s.player1Score > s.player2Score ? player1Name : player2Name;
          return (
            <div key={i} className="text-lg text-gray-400">
              세트 {i + 1}: {s.player1Score} - {s.player2Score} ({winner} 승)
            </div>
          );
        })}
        {history.length > 0 && (
          <div className="w-full max-w-lg">
            <h3 className="text-lg font-bold text-gray-300 mb-2">경기 기록 ({history.length})</h3>
            <div className="max-h-60 overflow-y-auto">
              <SetGroupedHistory history={history} sets={match.sets ?? []} showAll />
            </div>
          </div>
        )}
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>목록으로</button>
      </div>
    );
  }

  // ===== IN_PROGRESS =====
  const sets = Array.isArray(match.sets) && match.sets.length > 0 ? match.sets : [createEmptySet()];
  const currentSetIndex = match.currentSet ?? 0;
  const currentSet = sets[currentSetIndex] ?? createEmptySet();
  const setWins = countSetWins(sets, gameConfig);
  const currentServe = match.currentServe ?? 'player1';
  const serveCountVal = match.serveCount ?? 0;
  const serverName = currentServe === 'player1' ? player1Name : player2Name;
  const maxServes = getMaxServes('individual');
  const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];

  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);
  const penaltyActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points >= 2);

  // Server-based score display flip (server = left side)
  const isFlipped = currentServe === 'player2';
  const leftName = isFlipped ? player2Name : player1Name;
  const rightName = isFlipped ? player1Name : player2Name;
  const leftScore = isFlipped ? currentSet.player2Score : currentSet.player1Score;
  const rightScore = isFlipped ? currentSet.player1Score : currentSet.player2Score;
  const leftColor = isFlipped ? 'text-cyan-400' : 'text-yellow-400';
  const rightColor = isFlipped ? 'text-yellow-400' : 'text-cyan-400';

  const p1TimeoutsUsed = match.player1Timeouts ?? 0;
  const p2TimeoutsUsed = match.player2Timeouts ?? 0;

  // Keyboard shortcuts
  const shortcuts = useMemo(() => ({
    'ArrowLeft': () => handleIBSAScore(1, 'goal', 2, false, `${player1Name} 골`),
    'ArrowRight': () => handleIBSAScore(2, 'goal', 2, false, `${player2Name} 골`),
    'KeyZ': () => handleUndo(),
  }), [handleIBSAScore, handleUndo, player1Name, player2Name]);
  useKeyboardShortcuts(shortcuts, match.status === 'in_progress');

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
          subtitle="개인전 워밍업 (60초)"
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); }}
          closeLabel="워밍업 종료"
        />
      )}

      {/* Side Change Timer Modal */}
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
          subtitle={match.activeTimeout.playerId === match.player1Id ? player1Name : player2Name}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); }}
          closeLabel="타임아웃 종료"
        />
      )}

      {/* Set End Confirmation Dialog */}
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
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/games')}>← 목록</button>
          <div className="text-center">
            <div className="text-lg font-bold text-yellow-400">세트 {currentSetIndex + 1}/{gameConfig.MAX_SETS}</div>
            <div className="text-sm text-gray-400">세트 스코어: {setWins.player1} - {setWins.player2}</div>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{match.refereeName}</div>}
          </div>
        </div>
      </div>

      {/* Serve display */}
      <div className="bg-blue-900/50 px-4 py-2 text-center">
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {serveCountVal + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe}>
          서브권 변경
        </button>
      </div>

      {/* Score display - server on left */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-4 px-2 border-r border-gray-700" style={{ border: isFlipped ? undefined : '3px solid rgba(234,179,8,0.3)', borderRadius: 0 }}>
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

      {/* Scoring area (buttons always player1 left, player2 right - muscle memory) */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Goal +2 */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">⚽ 골 득점 (+2점)</h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="btn btn-success text-lg py-4 font-bold"
              disabled={!!match.activeTimeout || isPausedLocal}
              onClick={() => handleIBSAScore(1, 'goal', 2, false, `${player1Name} 골`)}
            >
              {player1Name}<br/>골 +2점
            </button>
            <button
              className="btn btn-success text-lg py-4 font-bold"
              disabled={!!match.activeTimeout || isPausedLocal}
              onClick={() => handleIBSAScore(2, 'goal', 2, false, `${player2Name} 골`)}
            >
              {player2Name}<br/>골 +2점
            </button>
          </div>
        </div>

        {/* Foul +1 (opponent scores) */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">🟡 파울 +1점 (상대 득점)</h3>
          <div className="space-y-2">
            {foulActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                {(action.type !== 'irregular_serve' || currentServe === 'player1') ? (
                  <button
                    className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                    disabled={!!match.activeTimeout || isPausedLocal}
                    onClick={() => handleIBSAScore(1, action.type, action.points, true, `${player1Name} ${action.label}`)}
                  >
                    {player1Name} {action.label}<br/>
                    <span className="text-xs opacity-75">→ {player2Name} +1점</span>
                  </button>
                ) : <div />}
                {(action.type !== 'irregular_serve' || currentServe === 'player2') ? (
                  <button
                    className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                    disabled={!!match.activeTimeout || isPausedLocal}
                    onClick={() => handleIBSAScore(2, action.type, action.points, true, `${player2Name} ${action.label}`)}
                  >
                    {player2Name} {action.label}<br/>
                    <span className="text-xs opacity-75">→ {player1Name} +1점</span>
                  </button>
                ) : <div />}
              </div>
            ))}
          </div>
        </div>

        {/* Penalty +2 (opponent scores) */}
        <div>
          <h3 className="text-sm font-bold text-red-400 mb-2">🔴 벌점 +2점 (상대 득점)</h3>
          <div className="space-y-2">
            {penaltyActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                <button
                  className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                  disabled={!!match.activeTimeout || isPausedLocal}
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${player1Name} ${action.label}`)}
                >
                  {player1Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {player2Name} +{action.points}점</span>
                </button>
                <button
                  className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                  disabled={!!match.activeTimeout || isPausedLocal}
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${player2Name} ${action.label}`)}
                >
                  {player2Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {player1Name} +{action.points}점</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button className="btn btn-danger flex-1" onClick={handleUndo} disabled={history.length === 0}>
            ↩️ 취소
          </button>
          <button
            className="btn btn-secondary flex-1"
            onClick={() => handleTimeout(1)}
            disabled={p1TimeoutsUsed >= 1 || !!match.activeTimeout}
            aria-label={`${player1Name} 타임아웃 요청, 남은 횟수 ${1 - p1TimeoutsUsed}회`}
          >
            {player1Name} 타임아웃
            <span className="block text-xs opacity-75">남은 횟수: {1 - p1TimeoutsUsed}</span>
          </button>
          <button
            className="btn btn-secondary flex-1"
            onClick={() => handleTimeout(2)}
            disabled={p2TimeoutsUsed >= 1 || !!match.activeTimeout}
            aria-label={`${player2Name} 타임아웃 요청, 남은 횟수 ${1 - p2TimeoutsUsed}회`}
          >
            {player2Name} 타임아웃
            <span className="block text-xs opacity-75">남은 횟수: {1 - p2TimeoutsUsed}</span>
          </button>
        </div>

        {/* Warmup + Pause */}
        <div className="flex gap-3">
          {!match.warmupUsed && (
            <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white" onClick={handleWarmup}>
              🔥 워밍업 60초
            </button>
          )}
          {!isPausedLocal && (
            <button className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white" onClick={handlePause}>
              ⏸️ 일시정지
            </button>
          )}
        </div>

        {/* History (set-grouped) */}
        <div>
          <button className="text-sm text-gray-400 underline mb-2" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? '▲ 경기 기록 닫기' : `▼ 경기 기록 (${history.length})`}
          </button>
          {showHistory && history.length > 0 && (
            <div className="max-h-48 overflow-y-auto">
              <SetGroupedHistory history={history} sets={sets} />
            </div>
          )}
        </div>
      </div>

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2">세트 기록</h3>
          <div className="flex gap-4 overflow-x-auto">
            {sets.map((s: SetScore, i: number) => (
              <div key={i} className={`text-center px-3 py-1 rounded ${i === currentSetIndex ? 'bg-gray-700' : ''}`}>
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
