import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatch } from '@shared/hooks/useFirebase';
import {
  checkSetWinner,
  createEmptySet,
  advanceServe,
  revertServe,
  shouldSideChange,
  createScoreHistoryEntry,
  getMaxServes,
} from '@shared/utils/scoring';
import { IBSA_SCORE_ACTIONS } from '@shared/types';
import type { ScoreActionType, ScoreHistoryEntry } from '@shared/types';
import { useCountdownTimer } from '../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../hooks/useDoubleClickGuard';
import { useAudioFeedback } from '@shared/hooks/useAudioFeedback';
import { useKeyboardShortcuts } from '@shared/hooks/useKeyboardShortcuts';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { vibrate, hapticPatterns } from '@shared/utils/haptic';
import TimerModal from '../components/TimerModal';
import SetGroupedHistory from '../components/SetGroupedHistory';
import ActionToast from '../components/ActionToast';

const TEAM_GAME_CONFIG = {
  SETS_TO_WIN: 1,
  MAX_SETS: 1,
  POINTS_TO_WIN: 31,
  MIN_POINT_DIFF: 2,
} as const;

export default function TeamMatchScoring() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { canAct } = useDoubleClickGuard();
  const audio = useAudioFeedback();

  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);
  const [showSideChange, setShowSideChange] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Warmup
  const [showWarmup, setShowWarmup] = useState(false);
  // Pause
  const [isPausedLocal, setIsPausedLocal] = useState(false);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const [pauseReason, setPauseReason] = useState('');

  // Timers
  const sideChangeTimer = useCountdownTimer(() => setShowSideChange(false));
  const warmupTimer = useCountdownTimer(() => setShowWarmup(false));
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
  });

  // Navigation guard
  useNavigationGuard(match?.status === 'in_progress');

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

  // Pause elapsed counter
  useEffect(() => {
    if (!isPausedLocal) return;
    const interval = setInterval(() => setPauseElapsed(p => p + 1), 1000);
    return () => clearInterval(interval);
  }, [isPausedLocal]);

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

  // Warmup (team: 90 seconds)
  const handleWarmup = useCallback(() => {
    if (!match || match.warmupUsed) return;
    updateMatch({ warmupUsed: true });
    warmupTimer.start(90);
    setShowWarmup(true);
  }, [match, updateMatch, warmupTimer]);

  // Pause (GAP-5: pauseHistory)
  const handlePause = useCallback(async () => {
    if (!match || match.status !== 'in_progress' || isPausedLocal) return;
    const reason = prompt('일시정지 사유를 입력하세요:\n(예: 부상, 장비 문제, 기타)');
    if (reason === null) return;
    const reasonText = reason || '사유 없음';
    setIsPausedLocal(true);
    setPauseReason(reasonText);
    setPauseElapsed(0);
    const prevHistory = match.pauseHistory ?? [];
    const newEntry = {
      time: new Date().toLocaleTimeString('ko-KR'),
      reason: reasonText,
      set: (match.currentSet ?? 0) + 1,
    };
    await updateMatch({
      isPaused: true,
      pauseReason: reasonText,
      pauseStartTime: Date.now(),
      pauseHistory: [...prevHistory, newEntry],
    });
  }, [match, updateMatch, isPausedLocal]);

  const handleResume = useCallback(async () => {
    if (!match) return;
    const prevHistory = match.pauseHistory ?? [];
    const updatedHistory = [...prevHistory];
    if (updatedHistory.length > 0) {
      const last = { ...updatedHistory[updatedHistory.length - 1] };
      last.duration = pauseElapsed;
      updatedHistory[updatedHistory.length - 1] = last;
    }
    setIsPausedLocal(false);
    setPauseElapsed(0);
    setPauseReason('');
    await updateMatch({
      isPaused: false,
      pauseReason: '',
      pauseStartTime: undefined,
      pauseHistory: updatedHistory,
    });
  }, [match, updateMatch, pauseElapsed]);

  // IBSA score
  const handleIBSAScore = useCallback(async (
    actingTeam: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!canAct()) return;
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout) return; // GAP-2

    const sets = [...match.sets.map(s => ({ ...s }))];
    const cs = { ...sets[0] };

    const scoreBefore = { player1: cs.player1Score, player2: cs.player2Score };
    const scoringTeam = toOpponent ? (actingTeam === 1 ? 2 : 1) : actingTeam;

    if (scoringTeam === 1) cs.player1Score += points;
    else cs.player2Score += points;
    sets[0] = cs;

    const scoreAfter = { player1: cs.player1Score, player2: cs.player2Score };

    const t1Name = match.team1Name ?? '팀1';
    const t2Name = match.team2Name ?? '팀2';
    const currentServe = match.currentServe ?? 'player1';
    const serveCount = match.serveCount ?? 0;
    const serverName = currentServe === 'player1' ? t1Name : t2Name;
    const serveNumber = serveCount + 1;

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: scoringTeam === 1 ? t1Name : t2Name,
      actionPlayer: actingTeam === 1 ? t1Name : t2Name,
      actionType, actionLabel: label, points,
      set: 1,
      server: serverName, serveNumber,
      scoreBefore, scoreAfter,
    });

    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    const newHistory = [historyEntry, ...prevHistory];

    const { currentServe: nextServe, serveCount: nextCount } = advanceServe(
      currentServe, serveCount, 'team',
    );

    const tName = scoringTeam === 1 ? t1Name : t2Name;
    const actorName = actingTeam === 1 ? t1Name : t2Name;
    const nextServerName = nextServe === 'player1' ? t1Name : t2Name;
    setScoreFlash(f => f + 1);

    // GAP-1: server-based score order for announce and lastAction
    const serverScore = nextServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = nextServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;

    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${tName} +${points}점`
      : `${tName} 골! +${points}점`;
    setLastAction(`${actionDesc} | 스코어 ${serverScore} 대 ${receiverScore}`);

    setAnnouncement(
      `${tName} ${points}점. 스코어 ${serverScore} 대 ${receiverScore}. ${nextServerName} ${nextCount + 1}번째 서브`
    );

    // Audio & haptic feedback (GAP-12)
    audio.scoreUp();
    vibrate(hapticPatterns.scoreUp);

    // Winner check
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, TEAM_GAME_CONFIG);
    if (setWinner) {
      const winnerId = setWinner === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
      cs.winnerId = winnerId;
      sets[0] = cs;
      audio.matchComplete();
      vibrate(hapticPatterns.matchComplete);
      await updateMatch({
        sets, status: 'completed', winnerId,
        currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
      });
      return;
    }

    // Side change (16 points)
    if (shouldSideChange('team', cs, match.sideChangeUsed ?? false, sets, TEAM_GAME_CONFIG)) {
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
  }, [match, updateMatch, canAct, sideChangeTimer, audio]);

  // Undo (GAP-10: include serve info in announce)
  const handleUndo = useCallback(async () => {
    if (!match) return;
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    if (history.length === 0) return;

    const lastEntry = history[0];
    const sets = [...(match.sets ?? []).map(s => ({ ...s }))];
    const cs = { ...sets[0] };
    cs.player1Score = lastEntry.scoreBefore.player1;
    cs.player2Score = lastEntry.scoreBefore.player2;
    cs.winnerId = null;
    sets[0] = cs;

    const { currentServe, serveCount } = revertServe(
      match.currentServe ?? 'player1', match.serveCount ?? 0, 'team',
    );

    await updateMatch({ sets, currentServe, serveCount, scoreHistory: history.slice(1) });
    const t1Name = match.team1Name ?? '팀1';
    const t2Name = match.team2Name ?? '팀2';
    const serverName = currentServe === 'player1' ? t1Name : t2Name;
    const msg = `취소됨. ${t1Name} ${cs.player1Score}, ${t2Name} ${cs.player2Score}. ${serverName} 서브`;
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

  const handleTimeout = useCallback(async (team: 1 | 2) => {
    if (!match || match.status !== 'in_progress') return;
    const usedTimeouts = team === 1 ? (match.player1Timeouts ?? 0) : (match.player2Timeouts ?? 0);
    if (usedTimeouts >= 1) return;
    const teamId = team === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
    const up: Record<string, unknown> = { activeTimeout: { playerId: teamId, startTime: Date.now() } };
    if (team === 1) up.player1Timeouts = (match.player1Timeouts ?? 0) + 1;
    else up.player2Timeouts = (match.player2Timeouts ?? 0) + 1;
    await updateMatch(up);
  }, [match, updateMatch]);

  // Keyboard shortcuts (GAP-12)
  const team1Name = match?.team1Name ?? '팀1';
  const team2Name = match?.team2Name ?? '팀2';

  const shortcuts = useMemo(() => ({
    'ArrowLeft': () => handleIBSAScore(1, 'goal', 2, false, `${team1Name} 골`),
    'ArrowRight': () => handleIBSAScore(2, 'goal', 2, false, `${team2Name} 골`),
    'KeyZ': () => handleUndo(),
  }), [handleIBSAScore, handleUndo, team1Name, team2Name]);
  useKeyboardShortcuts(shortcuts, match?.status === 'in_progress');

  if (matchLoading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-2xl text-gray-400 animate-pulse">경기 로딩 중...</p></div>;
  }

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-2xl text-red-400">경기를 찾을 수 없습니다.</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>목록으로</button>
      </div>
    );
  }

  // ===== PENDING =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">팀전 경기 준비</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{team1Name}</span>
          <span className="text-gray-500">vs</span>
          <span className="text-cyan-400 font-bold">{team2Name}</span>
        </div>
        <p className="text-lg text-gray-400">31점 단판 승부 | 서브 3회 교대</p>
        {match.courtName && <p className="text-gray-400">코트: {match.courtName}</p>}

        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center text-gray-300">첫 서브 선택</h2>
          <div className="flex gap-4">
            <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => handleStartMatch('player1')}>
              🎾 {team1Name}
            </button>
            <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => handleStartMatch('player2')}>
              🎾 {team2Name}
            </button>
          </div>
        </div>
        <button className="btn btn-accent" onClick={() => navigate('/referee/games')}>목록으로</button>
      </div>
    );
  }

  // ===== COMPLETED (GAP-14: showAll) =====
  if (match.status === 'completed') {
    const winnerName = match.winnerId === match.team1Id ? team1Name : team2Name;
    const finalSet = match.sets?.[0];
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">팀전 경기 종료</h1>
        <div className="text-4xl font-bold text-green-400">{winnerName} 승리!</div>
        {finalSet && <div className="text-2xl text-gray-300">최종: {finalSet.player1Score} - {finalSet.player2Score}</div>}
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
  const sets = match.sets ?? [createEmptySet()];
  const currentSet = sets[0] ?? createEmptySet();
  const currentServe = match.currentServe ?? 'player1';
  const serveCountVal = match.serveCount ?? 0;
  const serverName = currentServe === 'player1' ? team1Name : team2Name;
  const maxServes = getMaxServes('team');
  const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];

  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);
  const penaltyActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points >= 2);

  // Server-based score flip
  const isFlipped = currentServe === 'player2';
  const leftName = isFlipped ? team2Name : team1Name;
  const rightName = isFlipped ? team1Name : team2Name;
  const leftScore = isFlipped ? currentSet.player2Score : currentSet.player1Score;
  const rightScore = isFlipped ? currentSet.player1Score : currentSet.player2Score;
  const leftColor = isFlipped ? 'text-cyan-400' : 'text-yellow-400';
  const rightColor = isFlipped ? 'text-yellow-400' : 'text-cyan-400';

  const t1TimeoutsUsed = match.player1Timeouts ?? 0;
  const t2TimeoutsUsed = match.player2Timeouts ?? 0;

  // GAP-2: disabled condition for scoring buttons
  const scoringDisabled = !!match.activeTimeout || isPausedLocal;

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
          subtitle="팀전 워밍업 (90초)"
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); }}
          closeLabel="워밍업 종료"
        />
      )}

      {/* Side Change Timer */}
      {showSideChange && (
        <TimerModal
          title="사이드 체인지! (16점)"
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
          subtitle={match.activeTimeout.playerId === match.team1Id ? team1Name : team2Name}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); }}
          closeLabel="타임아웃 종료"
        />
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
            <div className="text-lg font-bold text-yellow-400">팀전 (31점 단판)</div>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{match.refereeName}</div>}
          </div>
        </div>
      </div>

      {/* Serve */}
      <div className="bg-blue-900/50 px-4 py-2 text-center">
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {serveCountVal + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe}>서브권 변경</button>
      </div>

      {/* Score display - server on left */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-4 px-2 border-r border-gray-700">
          <h2 className={`text-xl font-bold ${leftColor}`}>🎾 {leftName}</h2>
          <div key={`left-${scoreFlash}`} className={`text-7xl font-bold my-2 ${leftColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${leftName} ${leftScore}점`}>{leftScore}</div>
        </div>
        <div className="flex-1 flex flex-col items-center py-4 px-2">
          <h2 className={`text-xl font-bold ${rightColor}`}>{rightName}</h2>
          <div key={`right-${scoreFlash}`} className={`text-7xl font-bold my-2 ${rightColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${rightName} ${rightScore}점`}>{rightScore}</div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* Scoring area (buttons always team1 left, team2 right) */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">⚽ 골 득점 (+2점)</h3>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-success text-lg py-4 font-bold"
              disabled={scoringDisabled}
              onClick={() => handleIBSAScore(1, 'goal', 2, false, `${team1Name} 골`)}>
              {team1Name}<br/>골 +2점
            </button>
            <button className="btn btn-success text-lg py-4 font-bold"
              disabled={scoringDisabled}
              onClick={() => handleIBSAScore(2, 'goal', 2, false, `${team2Name} 골`)}>
              {team2Name}<br/>골 +2점
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">🟡 파울 +1점 (상대 득점)</h3>
          <div className="space-y-2">
            {foulActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  disabled={scoringDisabled}
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${team1Name} ${action.label}`)}>
                  {team1Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {team2Name} +1점</span>
                </button>
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  disabled={scoringDisabled}
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${team2Name} ${action.label}`)}>
                  {team2Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {team1Name} +1점</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-red-400 mb-2">🔴 벌점 +2점 (상대 득점)</h3>
          <div className="space-y-2">
            {penaltyActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                  disabled={scoringDisabled}
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${team1Name} ${action.label}`)}>
                  {team1Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {team2Name} +{action.points}점</span>
                </button>
                <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                  disabled={scoringDisabled}
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${team2Name} ${action.label}`)}>
                  {team2Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {team1Name} +{action.points}점</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button className="btn btn-danger flex-1" onClick={handleUndo} disabled={history.length === 0}>↩️ 취소</button>
          <button className="btn btn-secondary flex-1" onClick={() => handleTimeout(1)}
            disabled={t1TimeoutsUsed >= 1 || !!match.activeTimeout}>
            {team1Name} T/O{t1TimeoutsUsed < 1 ? ` (남은: ${1 - t1TimeoutsUsed})` : ''}
          </button>
          <button className="btn btn-secondary flex-1" onClick={() => handleTimeout(2)}
            disabled={t2TimeoutsUsed >= 1 || !!match.activeTimeout}>
            {team2Name} T/O{t2TimeoutsUsed < 1 ? ` (남은: ${1 - t2TimeoutsUsed})` : ''}
          </button>
        </div>

        {/* Warmup + Pause */}
        <div className="flex gap-3">
          {!match.warmupUsed && (
            <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white" onClick={handleWarmup}>
              🔥 워밍업 90초
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
    </div>
  );
}
