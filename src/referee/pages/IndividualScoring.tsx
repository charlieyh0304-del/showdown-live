import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatch, useTournament } from '@shared/hooks/useFirebase';
import {
  checkSetWinner,
  checkMatchWinner,
  createEmptySet,
  getEffectiveGameConfig,
  countSetWins,
} from '@shared/utils/scoring';
import { useAudioFeedback } from '@shared/hooks/useAudioFeedback';
import { useKeyboardShortcuts } from '@shared/hooks/useKeyboardShortcuts';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { vibrate, hapticPatterns } from '@shared/utils/haptic';
import type { SetScore } from '@shared/types';

export default function IndividualScoring() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);
  const audio = useAudioFeedback();

  const [timeoutRemaining, setTimeoutRemaining] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // 커스텀 ScoringRules가 있으면 우선 사용
  const gameConfig = getEffectiveGameConfig(tournament?.scoringRules || tournament?.gameConfig);

  // 경기 진행 중 이탈 방지
  useNavigationGuard(match?.status === 'in_progress');

  // Timeout countdown
  useEffect(() => {
    if (!match?.activeTimeout) {
      setTimeoutRemaining(null);
      return;
    }
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - match.activeTimeout!.startTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      setTimeoutRemaining(remaining);
      if (remaining <= 0) {
        updateMatch({ activeTimeout: null });
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [match?.activeTimeout, updateMatch]);

  const handleStartMatch = useCallback(async () => {
    if (!match) return;
    await updateMatch({
      status: 'in_progress',
      sets: [createEmptySet()],
      currentSet: 0,
      player1Timeouts: 0,
      player2Timeouts: 0,
      activeTimeout: null,
    });
  }, [match, updateMatch]);

  const handleScore = useCallback(async (player: 1 | 2, delta: number) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const currentSetIndex = match.currentSet;
    const currentSet = { ...sets[currentSetIndex] };

    if (player === 1) {
      currentSet.player1Score = Math.max(0, currentSet.player1Score + delta);
    } else {
      currentSet.player2Score = Math.max(0, currentSet.player2Score + delta);
    }

    sets[currentSetIndex] = currentSet;

    // Audio/haptic feedback
    if (delta > 0) { audio.scoreUp(); vibrate(hapticPatterns.scoreUp); }
    else { audio.scoreDown(); vibrate(hapticPatterns.scoreDown); }

    const pName = player === 1 ? (match.player1Name ?? '선수1') : (match.player2Name ?? '선수2');
    setAnnouncement(`${pName} ${delta > 0 ? '득점' : '감점'}. ${match.player1Name ?? '선수1'} ${currentSet.player1Score}점, ${match.player2Name ?? '선수2'} ${currentSet.player2Score}점`);

    // Check set winner
    const setWinner = checkSetWinner(currentSet.player1Score, currentSet.player2Score, gameConfig);
    if (setWinner && delta > 0) {
      currentSet.winnerId = setWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      sets[currentSetIndex] = currentSet;

      // Check match winner
      const matchWinner = checkMatchWinner(sets, gameConfig);
      if (matchWinner) {
        const winnerId = matchWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
        audio.matchComplete();
        vibrate(hapticPatterns.matchComplete);
        await updateMatch({
          sets,
          status: 'completed',
          winnerId,
        });
        return;
      }

      // New set
      audio.setComplete();
      vibrate(hapticPatterns.setComplete);
      sets.push(createEmptySet());
      await updateMatch({
        sets,
        currentSet: currentSetIndex + 1,
        player1Timeouts: 0,
        player2Timeouts: 0,
        activeTimeout: null,
      });
      return;
    }

    await updateMatch({ sets });
  }, [match, gameConfig, updateMatch, audio]);

  const handleFault = useCallback(async (player: 1 | 2) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const currentSet = { ...sets[match.currentSet] };
    if (player === 1) {
      currentSet.player1Faults += 1;
    } else {
      currentSet.player2Faults += 1;
    }
    sets[match.currentSet] = currentSet;
    await updateMatch({ sets });
  }, [match, updateMatch]);

  const handleViolation = useCallback(async (player: 1 | 2) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const currentSet = { ...sets[match.currentSet] };
    if (player === 1) {
      currentSet.player1Violations += 1;
    } else {
      currentSet.player2Violations += 1;
    }
    sets[match.currentSet] = currentSet;
    await updateMatch({ sets });
  }, [match, updateMatch]);

  const handleTimeout = useCallback(async (player: 1 | 2) => {
    if (!match || match.status !== 'in_progress') return;
    const usedTimeouts = player === 1 ? (match.player1Timeouts ?? 0) : (match.player2Timeouts ?? 0);
    if (usedTimeouts >= 1) return;

    const playerId = player === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
    const timeoutUpdate: Record<string, unknown> = {
      activeTimeout: { playerId, startTime: Date.now() },
    };
    if (player === 1) {
      timeoutUpdate.player1Timeouts = (match.player1Timeouts ?? 0) + 1;
    } else {
      timeoutUpdate.player2Timeouts = (match.player2Timeouts ?? 0) + 1;
    }
    await updateMatch(timeoutUpdate);
  }, [match, updateMatch]);

  const handleEndTimeout = useCallback(async () => {
    await updateMatch({ activeTimeout: null });
  }, [updateMatch]);

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
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>
          목록으로
        </button>
      </div>
    );
  }

  const player1Name = match.player1Name ?? '선수1';
  const player2Name = match.player2Name ?? '선수2';

  // PENDING state
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">경기 준비</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{player1Name}</span>
          <span className="text-gray-500">vs</span>
          <span className="text-cyan-400 font-bold">{player2Name}</span>
        </div>
        {match.courtName && (
          <p className="text-gray-400 text-lg">코트: {match.courtName}</p>
        )}
        <button
          className="btn btn-success btn-large text-4xl px-16 py-8"
          onClick={handleStartMatch}
          aria-label="경기 시작"
        >
          경기 시작
        </button>
        <button
          className="btn btn-accent"
          onClick={() => navigate('/referee/games')}
          aria-label="목록으로 돌아가기"
        >
          목록으로
        </button>
      </div>
    );
  }

  // COMPLETED state
  if (match.status === 'completed') {
    const winnerName = match.winnerId === match.player1Id ? player1Name : player2Name;
    const setWins = match.sets ? countSetWins(match.sets, gameConfig) : { player1: 0, player2: 0 };
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">경기 종료</h1>
        <div className="text-4xl font-bold text-green-400">
          {winnerName} 승리!
        </div>
        <div className="text-2xl text-gray-300">
          세트 스코어: {setWins.player1} - {setWins.player2}
        </div>
        {match.sets && (
          <div className="flex flex-col gap-2">
            {match.sets.map((s: SetScore, i: number) => (
              <div key={i} className="text-lg text-gray-400">
                세트 {i + 1}: {s.player1Score} - {s.player2Score}
              </div>
            ))}
          </div>
        )}
        <button
          className="btn btn-primary btn-large"
          onClick={() => navigate('/referee/games')}
          aria-label="목록으로 돌아가기"
        >
          목록으로
        </button>
      </div>
    );
  }

  // 키보드 단축키
  const shortcuts = useMemo(() => ({
    'ArrowLeft': () => handleScore(1, 1),
    'ArrowRight': () => handleScore(2, 1),
    'KeyQ': () => handleScore(1, -1),
    'KeyP': () => handleScore(2, -1),
    'KeyF': () => handleFault(1),
    'KeyJ': () => handleFault(2),
  }), [handleScore, handleFault]);

  useKeyboardShortcuts(shortcuts, match.status === 'in_progress');

  // IN_PROGRESS state
  const sets = match.sets ?? [createEmptySet()];
  const currentSetIndex = match.currentSet ?? 0;
  const currentSet = sets[currentSetIndex] ?? createEmptySet();
  const setWins = countSetWins(sets, gameConfig);
  const p1TimeoutsUsed = match.player1Timeouts ?? 0;
  const p2TimeoutsUsed = match.player2Timeouts ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Screen reader announcements */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>

      {/* Timeout overlay */}
      {match.activeTimeout && timeoutRemaining !== null && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-8">
            <h2 className="text-3xl font-bold text-yellow-400">타임아웃</h2>
            <div className="score-large text-white" aria-live="polite">
              {timeoutRemaining}
            </div>
            <p className="text-xl text-gray-300">
              {match.activeTimeout.playerId === match.player1Id ? player1Name : player2Name}
            </p>
            <button
              className="btn btn-danger btn-large"
              onClick={handleEndTimeout}
              aria-label="타임아웃 종료"
            >
              타임아웃 종료
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            className="btn btn-accent text-sm"
            onClick={() => navigate('/referee/games')}
            aria-label="목록으로"
          >
            ← 목록
          </button>
          <div className="text-center">
            <div className="text-lg font-bold text-yellow-400">
              세트 {currentSetIndex + 1}/{gameConfig.MAX_SETS}
            </div>
            <div className="text-sm text-gray-400">
              세트 스코어: {setWins.player1} - {setWins.player2}
            </div>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{match.refereeName}</div>}
          </div>
        </div>
      </div>

      {/* Scoring area */}
      <div className="flex-1 flex" aria-live="polite">
        {/* Player 1 */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4 border-r border-gray-700">
          <h2 className="text-2xl font-bold text-yellow-400">{player1Name}</h2>
          <div className="score-display text-yellow-400" aria-label={`${player1Name} 점수 ${currentSet.player1Score}`}>
            {currentSet.player1Score}
          </div>
          <button
            className="btn btn-success btn-large w-full text-4xl"
            style={{ minHeight: '100px' }}
            onClick={() => handleScore(1, 1)}
            aria-label={`${player1Name} 득점`}
          >
            +1
          </button>
          <button
            className="btn btn-danger w-full text-2xl"
            onClick={() => handleScore(1, -1)}
            disabled={currentSet.player1Score <= 0}
            aria-label={`${player1Name} 점수 감소`}
          >
            -1
          </button>
          <div className="flex gap-2 w-full">
            <button
              className="btn btn-accent flex-1 text-sm"
              onClick={() => handleFault(1)}
              aria-label={`${player1Name} 폴트`}
            >
              폴트 ({currentSet.player1Faults})
            </button>
            <button
              className="btn btn-accent flex-1 text-sm"
              onClick={() => handleViolation(1)}
              aria-label={`${player1Name} 반칙`}
            >
              반칙 ({currentSet.player1Violations})
            </button>
          </div>
          <button
            className="btn btn-secondary w-full"
            onClick={() => handleTimeout(1)}
            disabled={p1TimeoutsUsed >= 1 || !!match.activeTimeout}
            aria-label={`${player1Name} 타임아웃`}
          >
            타임아웃 ({p1TimeoutsUsed}/1)
          </button>
        </div>

        {/* Player 2 */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
          <h2 className="text-2xl font-bold text-cyan-400">{player2Name}</h2>
          <div className="score-display text-cyan-400" aria-label={`${player2Name} 점수 ${currentSet.player2Score}`}>
            {currentSet.player2Score}
          </div>
          <button
            className="btn btn-success btn-large w-full text-4xl"
            style={{ minHeight: '100px' }}
            onClick={() => handleScore(2, 1)}
            aria-label={`${player2Name} 득점`}
          >
            +1
          </button>
          <button
            className="btn btn-danger w-full text-2xl"
            onClick={() => handleScore(2, -1)}
            disabled={currentSet.player2Score <= 0}
            aria-label={`${player2Name} 점수 감소`}
          >
            -1
          </button>
          <div className="flex gap-2 w-full">
            <button
              className="btn btn-accent flex-1 text-sm"
              onClick={() => handleFault(2)}
              aria-label={`${player2Name} 폴트`}
            >
              폴트 ({currentSet.player2Faults})
            </button>
            <button
              className="btn btn-accent flex-1 text-sm"
              onClick={() => handleViolation(2)}
              aria-label={`${player2Name} 반칙`}
            >
              반칙 ({currentSet.player2Violations})
            </button>
          </div>
          <button
            className="btn btn-secondary w-full"
            onClick={() => handleTimeout(2)}
            disabled={p2TimeoutsUsed >= 1 || !!match.activeTimeout}
            aria-label={`${player2Name} 타임아웃`}
          >
            타임아웃 ({p2TimeoutsUsed}/1)
          </button>
        </div>
      </div>

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2">세트 기록</h3>
          <div className="flex gap-4 overflow-x-auto">
            {sets.map((s: SetScore, i: number) => (
              <div
                key={i}
                className={`text-center px-3 py-1 rounded ${i === currentSetIndex ? 'bg-gray-700' : ''}`}
              >
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
