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

export default function IndividualScoring() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);
  const audio = useAudioFeedback();

  const [timeoutRemaining, setTimeoutRemaining] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showSideChange, setShowSideChange] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const gameConfig = getEffectiveGameConfig(tournament?.scoringRules || tournament?.gameConfig);
  useNavigationGuard(match?.status === 'in_progress');

  // 타임아웃 카운트다운
  useEffect(() => {
    if (!match?.activeTimeout) { setTimeoutRemaining(null); return; }
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - match.activeTimeout!.startTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      setTimeoutRemaining(remaining);
      if (remaining <= 0) updateMatch({ activeTimeout: null });
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [match?.activeTimeout, updateMatch]);

  // 경기 시작 (서브 선택 포함)
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
    });
  }, [match, updateMatch]);

  // IBSA 득점 처리
  const handleIBSAScore = useCallback(async (
    actingPlayer: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress' || match.isPaused) return;

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

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;
    setAnnouncement(
      `${pName} ${points}점. ${p1Name} ${scoreAfter.player1}점, ${p2Name} ${scoreAfter.player2}점. ${nextServerName} ${nextCount + 1}번째 서브`
    );

    // 세트 승자 체크
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, gameConfig);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, gameConfig);
      if (matchWinner) {
        const winnerId = matchWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
        audio.matchComplete();
        vibrate(hapticPatterns.matchComplete);
        await updateMatch({
          sets, status: 'completed', winnerId,
          currentServe: nextServe, serveCount: nextCount,
          scoreHistory: newHistory,
        });
        return;
      }

      audio.setComplete();
      vibrate(hapticPatterns.setComplete);
      sets.push(createEmptySet());
      await updateMatch({
        sets, currentSet: ci + 1,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: false,
        scoreHistory: newHistory,
      });
      return;
    }

    // 사이드 체인지 체크
    if (shouldSideChange('individual', cs, match.sideChangeUsed ?? false, sets, gameConfig)) {
      await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
      });
      setShowSideChange(true);
      return;
    }

    await updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
    });
  }, [match, gameConfig, updateMatch, audio]);

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
    setAnnouncement(`취소됨. ${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}`);
  }, [match, updateMatch]);

  // 서브권 수동 변경
  const handleChangeServe = useCallback(async () => {
    if (!match || match.status !== 'in_progress') return;
    await updateMatch({
      currentServe: (match.currentServe ?? 'player1') === 'player1' ? 'player2' : 'player1',
      serveCount: 0,
    });
  }, [match, updateMatch]);

  // 타임아웃
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

  // ===== PENDING: 서브 선택 =====
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
    const setWins = match.sets ? countSetWins(match.sets, gameConfig) : { player1: 0, player2: 0 };
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">경기 종료</h1>
        <div className="text-4xl font-bold text-green-400">{winnerName} 승리!</div>
        <div className="text-2xl text-gray-300">세트 스코어: {setWins.player1} - {setWins.player2}</div>
        {match.sets && match.sets.map((s: SetScore, i: number) => (
          <div key={i} className="text-lg text-gray-400">세트 {i + 1}: {s.player1Score} - {s.player2Score}</div>
        ))}
        {history.length > 0 && (
          <div className="w-full max-w-lg">
            <h3 className="text-lg font-bold text-gray-300 mb-2">경기 기록 ({history.length})</h3>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {history.map((h, i) => (
                <div key={i} className="text-sm text-gray-400 bg-gray-800 rounded px-3 py-2">
                  <span className="text-gray-500">{h.time}</span>{' '}
                  {h.actionType === 'goal' ? '⚽' : h.points >= 2 ? '🔴' : '🟡'}{' '}
                  {h.actionLabel} → {h.scoringPlayer} +{h.points} | {h.scoreAfter.player1}-{h.scoreAfter.player2}
                </div>
              ))}
            </div>
          </div>
        )}
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>목록으로</button>
      </div>
    );
  }

  // ===== IN_PROGRESS =====
  const sets = match.sets ?? [createEmptySet()];
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

  // 키보드 단축키 (간소화)
  const shortcuts = useMemo(() => ({
    'ArrowLeft': () => handleIBSAScore(1, 'goal', 2, false, `${player1Name} 골`),
    'ArrowRight': () => handleIBSAScore(2, 'goal', 2, false, `${player2Name} 골`),
    'KeyZ': () => handleUndo(),
  }), [handleIBSAScore, handleUndo, player1Name, player2Name]);
  useKeyboardShortcuts(shortcuts, match.status === 'in_progress');

  return (
    <div className="min-h-screen flex flex-col">
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>

      {/* 사이드 체인지 모달 */}
      {showSideChange && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-6 p-8">
            <h2 className="text-3xl font-bold text-yellow-400">사이드 체인지!</h2>
            <p className="text-xl text-gray-300">1분 휴식</p>
            <button className="btn btn-primary btn-large" onClick={() => setShowSideChange(false)}>확인</button>
          </div>
        </div>
      )}

      {/* 타임아웃 오버레이 */}
      {match.activeTimeout && timeoutRemaining !== null && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-8">
            <h2 className="text-3xl font-bold text-yellow-400">타임아웃</h2>
            <div className="score-large text-white" aria-live="polite">{timeoutRemaining}</div>
            <p className="text-xl text-gray-300">
              {match.activeTimeout.playerId === match.player1Id ? player1Name : player2Name}
            </p>
            <button className="btn btn-danger btn-large" onClick={() => updateMatch({ activeTimeout: null })}>
              타임아웃 종료
            </button>
          </div>
        </div>
      )}

      {/* 헤더 */}
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

      {/* 서브 표시 */}
      <div className="bg-blue-900/50 px-4 py-2 text-center">
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {serveCountVal + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe}>
          서브권 변경
        </button>
      </div>

      {/* 점수판 */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        {[
          { player: 1 as const, name: player1Name, color: 'text-yellow-400', key: 'player1' as const },
          { player: 2 as const, name: player2Name, color: 'text-cyan-400', key: 'player2' as const },
        ].map(({ player, name, color, key }) => {
          const score = player === 1 ? currentSet.player1Score : currentSet.player2Score;
          const isServing = currentServe === key;
          return (
            <div key={player} className={`flex-1 flex flex-col items-center py-4 px-2 ${player === 1 ? 'border-r border-gray-700' : ''}`}>
              <h2 className={`text-xl font-bold ${color}`}>
                {isServing && '🎾 '}{name}
              </h2>
              <div className={`text-7xl font-bold my-2 ${color}`} aria-label={`${name} ${score}점`}>
                {score}
              </div>
            </div>
          );
        })}
      </div>

      {/* 득점 영역 (스크롤) */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* 골 +2 */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">⚽ 골 득점 (+2점)</h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="btn btn-success text-lg py-4 font-bold"
              onClick={() => handleIBSAScore(1, 'goal', 2, false, `${player1Name} 골`)}
            >
              {player1Name}<br/>골 +2점
            </button>
            <button
              className="btn btn-success text-lg py-4 font-bold"
              onClick={() => handleIBSAScore(2, 'goal', 2, false, `${player2Name} 골`)}
            >
              {player2Name}<br/>골 +2점
            </button>
          </div>
        </div>

        {/* 파울 +1 */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">🟡 파울 +1점 (상대 득점)</h3>
          <div className="space-y-2">
            {foulActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                <button
                  className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${player1Name} ${action.label}`)}
                >
                  {player1Name}<br/>{action.label}
                </button>
                <button
                  className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${player2Name} ${action.label}`)}
                >
                  {player2Name}<br/>{action.label}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 벌점 +2 */}
        <div>
          <h3 className="text-sm font-bold text-red-400 mb-2">🔴 벌점 +2점 (상대 득점)</h3>
          <div className="space-y-2">
            {penaltyActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                <button
                  className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${player1Name} ${action.label}`)}
                >
                  {player1Name}<br/>{action.label}
                </button>
                <button
                  className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${player2Name} ${action.label}`)}
                >
                  {player2Name}<br/>{action.label}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 액션 */}
        <div className="flex gap-3">
          <button className="btn btn-danger flex-1" onClick={handleUndo} disabled={history.length === 0}>
            ↩️ 취소
          </button>
          <button className="btn btn-secondary flex-1" onClick={() => handleTimeout(1)}
            disabled={(match.player1Timeouts ?? 0) >= 1 || !!match.activeTimeout}>
            {player1Name} T/O
          </button>
          <button className="btn btn-secondary flex-1" onClick={() => handleTimeout(2)}
            disabled={(match.player2Timeouts ?? 0) >= 1 || !!match.activeTimeout}>
            {player2Name} T/O
          </button>
        </div>

        {/* 경기 기록 */}
        <div>
          <button className="text-sm text-gray-400 underline mb-2" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? '▲ 경기 기록 닫기' : `▼ 경기 기록 (${history.length})`}
          </button>
          {showHistory && history.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {history.map((h, i) => (
                <div key={i} className="text-xs text-gray-400 bg-gray-800 rounded px-3 py-2">
                  <span className="text-gray-500">{h.time}</span>{' '}
                  {h.actionType === 'goal' ? '⚽' : h.points >= 2 ? '🔴' : '🟡'}{' '}
                  {h.actionLabel} → {h.scoringPlayer} +{h.points}{' '}
                  <span className="text-gray-500">| {h.scoreAfter.player1}-{h.scoreAfter.player2} | 서브: {h.server} {h.serveNumber}회차</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 세트 기록 */}
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
