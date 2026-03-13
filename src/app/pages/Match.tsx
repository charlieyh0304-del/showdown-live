import { useCallback, useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, update, get, onValue } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { usePlayers, useMatch, useReferees, useCourts } from '@shared/hooks/useFirebase';
import { checkSetWinner, checkMatchWinner, createEmptySet, getEffectiveGameConfig } from '@shared/types';
import type { Match as MatchType, MatchEvent, Tournament } from '@shared/types';

const MAX_TIMEOUTS = 1; // 세트당 타임아웃 횟수
const TIMEOUT_DURATION = 60; // 타임아웃 시간 (초)

export default function Match() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { players } = usePlayers();
  const { referees } = useReferees();
  const { courts } = useCourts();
  const { match, loading, updateMatch } = useMatch(tournamentId || null, matchId || null);

  // 대회별 게임 설정 로드
  const [tournament, setTournament] = useState<Tournament | null>(null);
  useEffect(() => {
    if (!tournamentId) return;
    const tournamentRef = ref(database, `tournaments/${tournamentId}`);
    const unsubscribe = onValue(tournamentRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setTournament({ id: tournamentId, ...data });
    });
    return () => unsubscribe();
  }, [tournamentId]);

  const gameConfig = useMemo(
    () => getEffectiveGameConfig(tournament?.gameConfig),
    [tournament?.gameConfig]
  );

  const getPlayer = useCallback((playerId: string | null) => {
    if (!playerId) return null;
    return players.find(p => p.id === playerId);
  }, [players]);

  const player1 = getPlayer(match?.player1Id || null);
  const player2 = getPlayer(match?.player2Id || null);

  const currentSet = match?.sets?.[match.currentSet] || createEmptySet();

  // 이벤트 생성 헬퍼
  const createEvent = useCallback((
    type: MatchEvent['type'],
    playerId: string | null,
    description?: string,
    data?: MatchEvent['data']
  ): MatchEvent => ({
    id: Date.now().toString(),
    type,
    playerId,
    timestamp: Date.now(),
    description,
    data,
  }), []);

  // 다음 라운드로 승자 진출
  const advanceWinner = useCallback(async (winnerId: string | null) => {
    if (!match || !tournamentId || !winnerId) return;

    const nextRound = match.round + 1;
    const nextPosition = Math.floor(match.position / 2);

    const matchesRef = ref(database, `matches/${tournamentId}`);

    try {
      const snapshot = await get(matchesRef);
      const data = snapshot.val();
      if (!data) return;

      const allMatches = Object.entries(data).map(([id, m]) => ({
        id,
        ...(m as Omit<MatchType, 'id'>),
      }));

      const nextMatch = allMatches.find(
        m => m.round === nextRound && m.position === nextPosition
      );

      if (nextMatch) {
        const isPlayer1 = match.position % 2 === 0;
        const updateData = isPlayer1
          ? { player1Id: winnerId }
          : { player2Id: winnerId };

        const nextMatchRef = ref(database, `matches/${tournamentId}/${nextMatch.id}`);
        await update(nextMatchRef, updateData);
      }
    } catch (error) {
      console.error('Failed to advance winner:', error);
    }
  }, [match, tournamentId]);

  // 점수 증감
  const updateScore = useCallback(async (
    player: 'player1' | 'player2',
    delta: number
  ) => {
    if (!match) return;

    const sets = [...match.sets];
    const current = { ...sets[match.currentSet] };
    const scoreKey = `${player}Score` as const;

    const newScore = Math.max(0, current[scoreKey] + delta);
    current[scoreKey] = newScore;
    sets[match.currentSet] = current;

    const playerId = player === 'player1' ? match.player1Id : match.player2Id;
    const playerName = getPlayer(playerId)?.name || '선수';

    // 득점 이벤트
    const lastEvent = delta > 0
      ? createEvent('score', playerId, `${playerName} 득점!`, {
          player1Score: current.player1Score,
          player2Score: current.player2Score,
          setNumber: match.currentSet + 1,
        })
      : undefined;

    // 세트 승자 확인
    const setWinner = checkSetWinner(current.player1Score, current.player2Score, gameConfig);

    if (setWinner) {
      current.winnerId = setWinner === 1 ? match.player1Id : match.player2Id;
      sets[match.currentSet] = current;

      // 경기 승자 확인
      const matchWinner = checkMatchWinner(sets, gameConfig);

      if (matchWinner) {
        // 경기 종료
        const winnerId = matchWinner === 1 ? match.player1Id : match.player2Id;
        const winnerName = getPlayer(winnerId)?.name || '선수';

        await updateMatch({
          sets,
          winnerId,
          status: 'completed',
          endTime: Date.now(),
          lastEvent: createEvent('match_end', winnerId, `${winnerName} 경기 승리!`),
        });

        // 다음 라운드 경기 업데이트
        await advanceWinner(winnerId);
        return;
      } else {
        // 세트 종료, 다음 세트
        const setWinnerName = getPlayer(current.winnerId)?.name || '선수';
        if (sets.length < gameConfig.MAX_SETS) {
          sets.push(createEmptySet());
          await updateMatch({
            sets,
            currentSet: match.currentSet + 1,
            lastEvent: createEvent('set_end', current.winnerId,
              `세트 ${match.currentSet + 1} 종료! ${setWinnerName} 세트 승리`),
          });
          return;
        }
      }
    }

    await updateMatch({ sets, lastEvent });
  }, [match, updateMatch, getPlayer, createEvent, advanceWinner, gameConfig]);

  // 평터 기록
  const recordFault = useCallback(async (player: 'player1' | 'player2') => {
    if (!match) return;

    const sets = [...match.sets];
    const current = { ...sets[match.currentSet] };
    const faultKey = `${player}Faults` as const;

    current[faultKey] = (current[faultKey] || 0) + 1;
    sets[match.currentSet] = current;

    const playerId = player === 'player1' ? match.player1Id : match.player2Id;
    const playerName = getPlayer(playerId)?.name || '선수';

    await updateMatch({
      sets,
      lastEvent: createEvent('fault', playerId, `${playerName} 평터`),
    });
  }, [match, updateMatch, getPlayer, createEvent]);

  // 반칙 기록
  const recordViolation = useCallback(async (player: 'player1' | 'player2') => {
    if (!match) return;

    const sets = [...match.sets];
    const current = { ...sets[match.currentSet] };
    const violationKey = `${player}Violations` as const;

    current[violationKey] = (current[violationKey] || 0) + 1;
    sets[match.currentSet] = current;

    const playerId = player === 'player1' ? match.player1Id : match.player2Id;
    const playerName = getPlayer(playerId)?.name || '선수';

    await updateMatch({
      sets,
      lastEvent: createEvent('violation', playerId, `${playerName} 반칙`),
    });
  }, [match, updateMatch, getPlayer, createEvent]);

  // 타임아웃 시작
  const startTimeout = useCallback(async (player: 'player1' | 'player2') => {
    if (!match) return;

    const timeoutKey = `${player}Timeouts` as const;
    const currentTimeouts = match[timeoutKey] || 0;

    if (currentTimeouts >= MAX_TIMEOUTS) return;

    const playerId = player === 'player1' ? match.player1Id : match.player2Id;
    const playerName = getPlayer(playerId)?.name || '선수';

    await updateMatch({
      [timeoutKey]: currentTimeouts + 1,
      activeTimeout: {
        playerId: playerId!,
        startTime: Date.now(),
      },
      lastEvent: createEvent('timeout_start', playerId, `${playerName} 타임아웃`),
    });
  }, [match, updateMatch, getPlayer, createEvent]);

  // 타임아웃 종료
  const endTimeout = useCallback(async () => {
    if (!match) return;

    await updateMatch({
      activeTimeout: null,
      lastEvent: createEvent('timeout_end', null, '타임아웃 종료'),
    });
  }, [match, updateMatch, createEvent]);

  // 경기 시작
  const startMatch = useCallback(async () => {
    if (!match) return;
    await updateMatch({
      status: 'in_progress',
      startTime: Date.now(),
      player1Timeouts: 0,
      player2Timeouts: 0,
    });
  }, [match, updateMatch]);

  // 세트 점수 요약
  const setScores = useMemo(() => {
    if (!match?.sets) return { player1: 0, player2: 0 };
    let p1 = 0, p2 = 0;
    for (const set of match.sets) {
      const winner = checkSetWinner(set.player1Score, set.player2Score, gameConfig);
      if (winner === 1) p1++;
      if (winner === 2) p2++;
    }
    return { player1: p1, player2: p2 };
  }, [match?.sets, gameConfig]);

  // 타임아웃 남은 시간 (1초마다 자동 업데이트)
  const [timeoutRemaining, setTimeoutRemaining] = useState(() => {
    if (!match?.activeTimeout) return 0;
    const elapsed = Math.floor((Date.now() - match.activeTimeout.startTime) / 1000);
    return Math.max(0, TIMEOUT_DURATION - elapsed);
  });

  useEffect(() => {
    if (!match?.activeTimeout) {
      // Reset via a microtask to avoid synchronous setState in effect
      const id = setTimeout(() => setTimeoutRemaining(0), 0);
      return () => clearTimeout(id);
    }

    const calcRemaining = () => {
      const elapsed = Math.floor((Date.now() - match.activeTimeout!.startTime) / 1000);
      return Math.max(0, TIMEOUT_DURATION - elapsed);
    };

    // Set initial value via microtask
    const initId = setTimeout(() => setTimeoutRemaining(calcRemaining()), 0);

    const interval = setInterval(() => {
      const remaining = calcRemaining();
      setTimeoutRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => {
      clearTimeout(initId);
      clearInterval(interval);
    };
  }, [match?.activeTimeout]);

  if (loading) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-3xl" role="status" aria-live="polite">로딩 중...</div>;
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <p className="text-2xl mb-4">경기를 찾을 수 없습니다</p>
        <button onClick={() => navigate(-1)} className="btn btn-primary">
          뒤로가기
        </button>
      </div>
    );
  }

  const isTimeout = !!match.activeTimeout;

  return (
    <div className="min-h-screen bg-black p-4 flex flex-col">
      {/* 타임아웃 오버레이 */}
      {isTimeout && (
        <div className="fixed inset-0 bg-blue-900/90 flex flex-col items-center justify-center z-50" role="alert" aria-live="assertive">
          <div className="text-4xl text-white mb-4">타임아웃</div>
          <div className="text-8xl font-bold text-primary mb-8" aria-label={`남은 시간 ${timeoutRemaining}초`}>
            {timeoutRemaining}초
          </div>
          <div className="text-2xl text-white mb-8">
            {getPlayer(match.activeTimeout?.playerId || null)?.name}
          </div>
          <button onClick={endTimeout} className="btn btn-danger btn-large">
            타임아웃 종료
          </button>
        </div>
      )}

      {/* 헤더 */}
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={() => navigate(-1)}
          className="btn bg-gray-800"
          aria-label="뒤로가기"
        >
          ← 뒤로
        </button>
        <div className="text-center" aria-live="polite">
          <div className="text-xl text-gray-400">
            세트 {match.currentSet + 1} / {gameConfig.MAX_SETS}
          </div>
          <div className="text-3xl font-bold text-primary" aria-label={`세트 점수 ${setScores.player1} 대 ${setScores.player2}`}>
            {setScores.player1} - {setScores.player2}
          </div>
          {/* 심판/경기장/시간 정보 */}
          {(match.refereeId || match.courtId || match.scheduledTime) && (
            <div className="flex items-center justify-center gap-3 mt-1 text-sm text-gray-400">
              {match.refereeId && (() => {
                const referee = referees.find(r => r.id === match.refereeId);
                return referee ? (
                  <span aria-label={`심판: ${referee.name}`}>심판: {referee.name}</span>
                ) : null;
              })()}
              {match.courtId && (() => {
                const court = courts.find(c => c.id === match.courtId);
                return court ? (
                  <span aria-label={`경기장: ${court.name}`}>| 경기장: {court.name}</span>
                ) : null;
              })()}
              {match.scheduledTime && (
                <span aria-label={`시간: ${match.scheduledTime}`}>| 시간: {match.scheduledTime}</span>
              )}
            </div>
          )}
        </div>
        <div className="w-24"></div>
      </div>

      {match.status === 'pending' ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-3xl mb-8 text-center">
            <span className="text-primary">{player1?.name}</span>
            <span className="text-gray-500 mx-4">VS</span>
            <span className="text-secondary">{player2?.name}</span>
          </div>
          <button onClick={startMatch} className="btn btn-accent btn-large">
            경기 시작
          </button>
        </div>
      ) : match.status === 'completed' ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-4xl font-bold text-primary mb-4">경기 종료</div>
          <div className="text-3xl mb-8">
            {getPlayer(match.winnerId)?.name} 승리
          </div>
          <div className="text-2xl text-gray-400 mb-8">
            {setScores.player1} - {setScores.player2}
          </div>
          <button
            onClick={() => navigate(-1)}
            className="btn btn-primary btn-large"
          >
            뒤로가기
          </button>
        </div>
      ) : (
        <>
          {/* 점수판 */}
          <div className="flex-1 grid grid-cols-2 gap-4">
            {/* Player 1 */}
            <div className="flex flex-col items-center bg-gray-900 rounded-2xl p-6">
              <div className="text-2xl font-bold mb-2 text-primary">
                {player1?.name}
              </div>
              <div className="score-display text-8xl my-6" aria-live="polite" aria-label={`${player1?.name} 점수 ${currentSet.player1Score}`}>
                {currentSet.player1Score}
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                <button
                  onClick={() => updateScore('player1', 1)}
                  className="btn btn-success btn-large text-4xl"
                  aria-label={`${player1?.name} 1점 추가`}
                >
                  +1
                </button>
                <button
                  onClick={() => updateScore('player1', -1)}
                  className="btn btn-danger btn-large text-4xl"
                  disabled={currentSet.player1Score === 0}
                  aria-label={`${player1?.name} 1점 감소`}
                >
                  -1
                </button>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => recordFault('player1')}
                  className="btn bg-yellow-700 hover:bg-yellow-600 text-sm"
                >
                  평터 ({currentSet.player1Faults || 0})
                </button>
                <button
                  onClick={() => recordViolation('player1')}
                  className="btn bg-red-700 hover:bg-red-600 text-sm"
                >
                  반칙 ({currentSet.player1Violations || 0})
                </button>
              </div>
              <button
                onClick={() => startTimeout('player1')}
                disabled={(match.player1Timeouts || 0) >= MAX_TIMEOUTS}
                className="btn bg-blue-700 hover:bg-blue-600 mt-3 w-full max-w-xs"
              >
                타임아웃 ({MAX_TIMEOUTS - (match.player1Timeouts || 0)} 남음)
              </button>
            </div>

            {/* Player 2 */}
            <div className="flex flex-col items-center bg-gray-900 rounded-2xl p-6">
              <div className="text-2xl font-bold mb-2 text-secondary">
                {player2?.name}
              </div>
              <div className="score-display text-8xl my-6" aria-live="polite" aria-label={`${player2?.name} 점수 ${currentSet.player2Score}`}>
                {currentSet.player2Score}
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                <button
                  onClick={() => updateScore('player2', 1)}
                  className="btn btn-success btn-large text-4xl"
                  aria-label={`${player2?.name} 1점 추가`}
                >
                  +1
                </button>
                <button
                  onClick={() => updateScore('player2', -1)}
                  className="btn btn-danger btn-large text-4xl"
                  disabled={currentSet.player2Score === 0}
                  aria-label={`${player2?.name} 1점 감소`}
                >
                  -1
                </button>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => recordFault('player2')}
                  className="btn bg-yellow-700 hover:bg-yellow-600 text-sm"
                >
                  평터 ({currentSet.player2Faults || 0})
                </button>
                <button
                  onClick={() => recordViolation('player2')}
                  className="btn bg-red-700 hover:bg-red-600 text-sm"
                >
                  반칙 ({currentSet.player2Violations || 0})
                </button>
              </div>
              <button
                onClick={() => startTimeout('player2')}
                disabled={(match.player2Timeouts || 0) >= MAX_TIMEOUTS}
                className="btn bg-blue-700 hover:bg-blue-600 mt-3 w-full max-w-xs"
              >
                타임아웃 ({MAX_TIMEOUTS - (match.player2Timeouts || 0)} 남음)
              </button>
            </div>
          </div>

          {/* 세트 기록 */}
          <div className="mt-4 bg-gray-900 rounded-xl p-4">
            <div className="text-lg text-gray-400 mb-2">세트 기록</div>
            <div className="flex gap-4 justify-center">
              {match.sets.map((set, idx) => (
                <div
                  key={idx}
                  className={`text-center px-4 py-2 rounded-lg ${
                    idx === match.currentSet ? 'bg-gray-700' : 'bg-gray-800'
                  }`}
                >
                  <div className="text-sm text-gray-400">세트 {idx + 1}</div>
                  <div className="text-2xl font-bold">
                    {set.player1Score} - {set.player2Score}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
