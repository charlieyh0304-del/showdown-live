import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatch } from '@shared/hooks/useFirebase';
import {
  checkSetWinner,
  createEmptySet,
} from '@shared/utils/scoring';

// 팀전: 31점, 1세트, 2점 차
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

  const [timeoutRemaining, setTimeoutRemaining] = useState<number | null>(null);

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

  const handleScore = useCallback(async (team: 1 | 2, delta: number) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const currentSet = { ...sets[0] };

    if (team === 1) {
      currentSet.player1Score = Math.max(0, currentSet.player1Score + delta);
    } else {
      currentSet.player2Score = Math.max(0, currentSet.player2Score + delta);
    }

    sets[0] = currentSet;

    // Check set winner (= match winner for team match, since 1 set)
    const setWinner = checkSetWinner(currentSet.player1Score, currentSet.player2Score, TEAM_GAME_CONFIG);
    if (setWinner && delta > 0) {
      const winnerId = setWinner === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
      currentSet.winnerId = winnerId;
      sets[0] = currentSet;

      await updateMatch({
        sets,
        status: 'completed',
        winnerId,
      });
      return;
    }

    await updateMatch({ sets });
  }, [match, updateMatch]);

  const handleFault = useCallback(async (team: 1 | 2) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const currentSet = { ...sets[0] };
    if (team === 1) {
      currentSet.player1Faults += 1;
    } else {
      currentSet.player2Faults += 1;
    }
    sets[0] = currentSet;
    await updateMatch({ sets });
  }, [match, updateMatch]);

  const handleViolation = useCallback(async (team: 1 | 2) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const currentSet = { ...sets[0] };
    if (team === 1) {
      currentSet.player1Violations += 1;
    } else {
      currentSet.player2Violations += 1;
    }
    sets[0] = currentSet;
    await updateMatch({ sets });
  }, [match, updateMatch]);

  const handleTimeout = useCallback(async (team: 1 | 2) => {
    if (!match || match.status !== 'in_progress') return;
    const usedTimeouts = team === 1 ? (match.player1Timeouts ?? 0) : (match.player2Timeouts ?? 0);
    if (usedTimeouts >= 1) return;

    const teamId = team === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
    const timeoutUpdate: Record<string, unknown> = {
      activeTimeout: { playerId: teamId, startTime: Date.now() },
    };
    if (team === 1) {
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

  const team1Name = match.team1Name ?? '팀1';
  const team2Name = match.team2Name ?? '팀2';

  // PENDING state
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">팀전 경기 준비</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{team1Name}</span>
          <span className="text-gray-500">vs</span>
          <span className="text-cyan-400 font-bold">{team2Name}</span>
        </div>
        <p className="text-lg text-gray-400">31점 단판 승부</p>
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
    const winnerName = match.winnerId === match.team1Id ? team1Name : team2Name;
    const finalSet = match.sets?.[0];
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">팀전 경기 종료</h1>
        <div className="text-4xl font-bold text-green-400">
          {winnerName} 승리!
        </div>
        {finalSet && (
          <div className="text-2xl text-gray-300">
            최종 스코어: {finalSet.player1Score} - {finalSet.player2Score}
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

  // IN_PROGRESS state
  const sets = match.sets ?? [createEmptySet()];
  const currentSet = sets[0] ?? createEmptySet();
  const t1TimeoutsUsed = match.player1Timeouts ?? 0;
  const t2TimeoutsUsed = match.player2Timeouts ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Timeout overlay */}
      {match.activeTimeout && timeoutRemaining !== null && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-8">
            <h2 className="text-3xl font-bold text-yellow-400">타임아웃</h2>
            <div className="score-large text-white" aria-live="polite">
              {timeoutRemaining}
            </div>
            <p className="text-xl text-gray-300">
              {match.activeTimeout.playerId === match.team1Id ? team1Name : team2Name}
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
              팀전 (31점 단판)
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
        {/* Team 1 */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4 border-r border-gray-700">
          <h2 className="text-2xl font-bold text-yellow-400">{team1Name}</h2>
          <div className="score-display text-yellow-400" aria-label={`${team1Name} 점수 ${currentSet.player1Score}`}>
            {currentSet.player1Score}
          </div>
          <button
            className="btn btn-success btn-large w-full text-4xl"
            style={{ minHeight: '100px' }}
            onClick={() => handleScore(1, 1)}
            aria-label={`${team1Name} 득점`}
          >
            +1
          </button>
          <button
            className="btn btn-danger w-full text-2xl"
            onClick={() => handleScore(1, -1)}
            disabled={currentSet.player1Score <= 0}
            aria-label={`${team1Name} 점수 감소`}
          >
            -1
          </button>
          <div className="flex gap-2 w-full">
            <button
              className="btn btn-accent flex-1 text-sm"
              onClick={() => handleFault(1)}
              aria-label={`${team1Name} 폴트`}
            >
              폴트 ({currentSet.player1Faults})
            </button>
            <button
              className="btn btn-accent flex-1 text-sm"
              onClick={() => handleViolation(1)}
              aria-label={`${team1Name} 반칙`}
            >
              반칙 ({currentSet.player1Violations})
            </button>
          </div>
          <button
            className="btn btn-secondary w-full"
            onClick={() => handleTimeout(1)}
            disabled={t1TimeoutsUsed >= 1 || !!match.activeTimeout}
            aria-label={`${team1Name} 타임아웃`}
          >
            타임아웃 ({t1TimeoutsUsed}/1)
          </button>
        </div>

        {/* Team 2 */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
          <h2 className="text-2xl font-bold text-cyan-400">{team2Name}</h2>
          <div className="score-display text-cyan-400" aria-label={`${team2Name} 점수 ${currentSet.player2Score}`}>
            {currentSet.player2Score}
          </div>
          <button
            className="btn btn-success btn-large w-full text-4xl"
            style={{ minHeight: '100px' }}
            onClick={() => handleScore(2, 1)}
            aria-label={`${team2Name} 득점`}
          >
            +1
          </button>
          <button
            className="btn btn-danger w-full text-2xl"
            onClick={() => handleScore(2, -1)}
            disabled={currentSet.player2Score <= 0}
            aria-label={`${team2Name} 점수 감소`}
          >
            -1
          </button>
          <div className="flex gap-2 w-full">
            <button
              className="btn btn-accent flex-1 text-sm"
              onClick={() => handleFault(2)}
              aria-label={`${team2Name} 폴트`}
            >
              폴트 ({currentSet.player2Faults})
            </button>
            <button
              className="btn btn-accent flex-1 text-sm"
              onClick={() => handleViolation(2)}
              aria-label={`${team2Name} 반칙`}
            >
              반칙 ({currentSet.player2Violations})
            </button>
          </div>
          <button
            className="btn btn-secondary w-full"
            onClick={() => handleTimeout(2)}
            disabled={t2TimeoutsUsed >= 1 || !!match.activeTimeout}
            aria-label={`${team2Name} 타임아웃`}
          >
            타임아웃 ({t2TimeoutsUsed}/1)
          </button>
        </div>
      </div>
    </div>
  );
}
