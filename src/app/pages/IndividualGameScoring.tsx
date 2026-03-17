import { useCallback, useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePlayers, useIndividualGame, useReferees, useCourts } from '@shared/hooks/useFirebase';
import { checkSetWinner, checkMatchWinner, createEmptySet, getEffectiveGameConfig } from '@shared/types';

const MAX_TIMEOUTS = 1;
const TIMEOUT_DURATION = 60;

export default function IndividualGameScoring() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { players } = usePlayers();
  const { referees } = useReferees();
  const { courts } = useCourts();
  const { game, loading, updateGame } = useIndividualGame(id || null);

  const gameConfig = useMemo(
    () => getEffectiveGameConfig(game?.gameConfig),
    [game?.gameConfig]
  );

  const getPlayer = useCallback((playerId: string | null) => {
    if (!playerId) return null;
    return players.find(p => p.id === playerId);
  }, [players]);

  const player1 = getPlayer(game?.player1Id || null);
  const player2 = getPlayer(game?.player2Id || null);
  const currentSet = game?.sets?.[game.currentSet] || createEmptySet();

  // 점수 증감
  const updateScore = useCallback(async (player: 'player1' | 'player2', delta: number) => {
    if (!game) return;

    const sets = [...game.sets];
    const current = { ...sets[game.currentSet] };
    const scoreKey = `${player}Score` as const;
    current[scoreKey] = Math.max(0, current[scoreKey] + delta);
    sets[game.currentSet] = current;

    // 세트 승자 확인
    const setWinner = checkSetWinner(current.player1Score, current.player2Score, gameConfig);
    if (setWinner) {
      current.winnerId = setWinner === 1 ? game.player1Id : game.player2Id;
      sets[game.currentSet] = current;

      const matchWinner = checkMatchWinner(sets, gameConfig);
      if (matchWinner) {
        const winnerId = matchWinner === 1 ? game.player1Id : game.player2Id;
        await updateGame({ sets, winnerId, status: 'completed' });
        return;
      } else if (sets.length < gameConfig.MAX_SETS) {
        sets.push(createEmptySet());
        await updateGame({ sets, currentSet: game.currentSet + 1 });
        return;
      }
    }

    await updateGame({ sets });
  }, [game, updateGame, gameConfig]);

  // 평터 기록
  const recordFault = useCallback(async (player: 'player1' | 'player2') => {
    if (!game) return;
    const sets = [...game.sets];
    const current = { ...sets[game.currentSet] };
    const faultKey = `${player}Faults` as const;
    current[faultKey] = (current[faultKey] || 0) + 1;
    sets[game.currentSet] = current;
    await updateGame({ sets });
  }, [game, updateGame]);

  // 반칙 기록
  const recordViolation = useCallback(async (player: 'player1' | 'player2') => {
    if (!game) return;
    const sets = [...game.sets];
    const current = { ...sets[game.currentSet] };
    const violationKey = `${player}Violations` as const;
    current[violationKey] = (current[violationKey] || 0) + 1;
    sets[game.currentSet] = current;
    await updateGame({ sets });
  }, [game, updateGame]);

  // 타임아웃
  const startTimeout = useCallback(async (player: 'player1' | 'player2') => {
    if (!game) return;
    const timeoutKey = `${player}Timeouts` as const;
    const currentTimeouts = game[timeoutKey] || 0;
    if (currentTimeouts >= MAX_TIMEOUTS) return;

    const playerId = player === 'player1' ? game.player1Id : game.player2Id;
    await updateGame({
      [timeoutKey]: currentTimeouts + 1,
      activeTimeout: { playerId, startTime: Date.now() },
    });
  }, [game, updateGame]);

  const endTimeout = useCallback(async () => {
    if (!game) return;
    await updateGame({ activeTimeout: null });
  }, [game, updateGame]);

  // 경기 시작
  const startGame = useCallback(async () => {
    if (!game) return;
    await updateGame({ status: 'in_progress', player1Timeouts: 0, player2Timeouts: 0 });
  }, [game, updateGame]);

  // 세트 점수 요약
  const setScores = useMemo(() => {
    if (!game?.sets) return { player1: 0, player2: 0 };
    let p1 = 0, p2 = 0;
    for (const set of game.sets) {
      const winner = checkSetWinner(set.player1Score, set.player2Score, gameConfig);
      if (winner === 1) p1++;
      if (winner === 2) p2++;
    }
    return { player1: p1, player2: p2 };
  }, [game?.sets, gameConfig]);

  // 타임아웃 카운트다운
  const [timeoutRemaining, setTimeoutRemaining] = useState(0);
  useEffect(() => {
    if (!game?.activeTimeout) {
      const id = setTimeout(() => setTimeoutRemaining(0), 0);
      return () => clearTimeout(id);
    }
    const calcRemaining = () => {
      const elapsed = Math.floor((Date.now() - game.activeTimeout!.startTime) / 1000);
      return Math.max(0, TIMEOUT_DURATION - elapsed);
    };
    const initId = setTimeout(() => setTimeoutRemaining(calcRemaining()), 0);
    const interval = setInterval(() => {
      const remaining = calcRemaining();
      setTimeoutRemaining(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => { clearTimeout(initId); clearInterval(interval); };
  }, [game?.activeTimeout]);

  if (loading) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-3xl" role="status">로딩 중...</div>;
  }

  if (!game) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <p className="text-2xl mb-4">경기를 찾을 수 없습니다</p>
        <button onClick={() => navigate('/individual')} className="btn btn-primary">뒤로가기</button>
      </div>
    );
  }

  const isTimeout = !!game.activeTimeout;

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
            {getPlayer(game.activeTimeout?.playerId || null)?.name}
          </div>
          <button onClick={endTimeout} className="btn btn-danger btn-large">타임아웃 종료</button>
        </div>
      )}

      {/* 헤더 */}
      <div className="flex justify-between items-center mb-4">
        <button onClick={() => navigate('/individual')} className="btn bg-gray-800" aria-label="뒤로가기">
          ← 뒤로
        </button>
        <div className="text-center" aria-live="polite">
          <div className="text-xl text-gray-400">세트 {game.currentSet + 1} / {gameConfig.MAX_SETS}</div>
          <div className="text-3xl font-bold text-primary" aria-label={`세트 점수 ${setScores.player1} 대 ${setScores.player2}`}>
            {setScores.player1} - {setScores.player2}
          </div>
          {(game.refereeId || game.courtId) && (
            <div className="flex items-center justify-center gap-3 mt-1 text-sm text-gray-400">
              {game.refereeId && (() => {
                const referee = referees.find(r => r.id === game.refereeId);
                return referee ? <span>심판: {referee.name}</span> : null;
              })()}
              {game.courtId && (() => {
                const court = courts.find(c => c.id === game.courtId);
                return court ? <span>| {court.name}</span> : null;
              })()}
            </div>
          )}
        </div>
        <div className="w-24"></div>
      </div>

      {game.status === 'pending' ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-3xl mb-8 text-center">
            <span className="text-primary">{player1?.name}</span>
            <span className="text-gray-500 mx-4">VS</span>
            <span className="text-secondary">{player2?.name}</span>
          </div>
          <button onClick={startGame} className="btn btn-accent btn-large">경기 시작</button>
        </div>
      ) : game.status === 'completed' ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-4xl font-bold text-primary mb-4">경기 종료</div>
          <div className="text-3xl mb-8">{getPlayer(game.winnerId)?.name} 승리</div>
          <div className="text-2xl text-gray-400 mb-8">{setScores.player1} - {setScores.player2}</div>
          <button onClick={() => navigate('/individual')} className="btn btn-primary btn-large">목록으로</button>
        </div>
      ) : (
        <>
          {/* 점수판 */}
          <div className="flex-1 grid grid-cols-2 gap-4">
            {/* Player 1 */}
            <div className="flex flex-col items-center bg-gray-900 rounded-2xl p-6">
              <div className="text-2xl font-bold mb-2 text-primary">{player1?.name}</div>
              <div className="score-display text-8xl my-6" aria-live="polite" aria-label={`${player1?.name} 점수 ${currentSet.player1Score}`}>
                {currentSet.player1Score}
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                <button onClick={() => updateScore('player1', 1)} className="btn btn-success btn-large text-4xl" aria-label={`${player1?.name} 1점 추가`}>+1</button>
                <button onClick={() => updateScore('player1', -1)} className="btn btn-danger btn-large text-4xl" disabled={currentSet.player1Score === 0} aria-label={`${player1?.name} 1점 감소`}>-1</button>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => recordFault('player1')} className="btn bg-yellow-700 hover:bg-yellow-600 text-sm">
                  평터 ({currentSet.player1Faults || 0})
                </button>
                <button onClick={() => recordViolation('player1')} className="btn bg-red-700 hover:bg-red-600 text-sm">
                  반칙 ({currentSet.player1Violations || 0})
                </button>
              </div>
              <button
                onClick={() => startTimeout('player1')}
                disabled={(game.player1Timeouts || 0) >= MAX_TIMEOUTS}
                className="btn bg-blue-700 hover:bg-blue-600 mt-3 w-full max-w-xs"
              >
                타임아웃 ({MAX_TIMEOUTS - (game.player1Timeouts || 0)} 남음)
              </button>
            </div>

            {/* Player 2 */}
            <div className="flex flex-col items-center bg-gray-900 rounded-2xl p-6">
              <div className="text-2xl font-bold mb-2 text-secondary">{player2?.name}</div>
              <div className="score-display text-8xl my-6" aria-live="polite" aria-label={`${player2?.name} 점수 ${currentSet.player2Score}`}>
                {currentSet.player2Score}
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                <button onClick={() => updateScore('player2', 1)} className="btn btn-success btn-large text-4xl" aria-label={`${player2?.name} 1점 추가`}>+1</button>
                <button onClick={() => updateScore('player2', -1)} className="btn btn-danger btn-large text-4xl" disabled={currentSet.player2Score === 0} aria-label={`${player2?.name} 1점 감소`}>-1</button>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => recordFault('player2')} className="btn bg-yellow-700 hover:bg-yellow-600 text-sm">
                  평터 ({currentSet.player2Faults || 0})
                </button>
                <button onClick={() => recordViolation('player2')} className="btn bg-red-700 hover:bg-red-600 text-sm">
                  반칙 ({currentSet.player2Violations || 0})
                </button>
              </div>
              <button
                onClick={() => startTimeout('player2')}
                disabled={(game.player2Timeouts || 0) >= MAX_TIMEOUTS}
                className="btn bg-blue-700 hover:bg-blue-600 mt-3 w-full max-w-xs"
              >
                타임아웃 ({MAX_TIMEOUTS - (game.player2Timeouts || 0)} 남음)
              </button>
            </div>
          </div>

          {/* 세트 기록 */}
          <div className="mt-4 bg-gray-900 rounded-xl p-4">
            <div className="text-lg text-gray-400 mb-2">세트 기록</div>
            <div className="flex gap-4 justify-center">
              {game.sets.map((set, idx) => (
                <div
                  key={idx}
                  className={`text-center px-4 py-2 rounded-lg ${idx === game.currentSet ? 'bg-gray-700' : 'bg-gray-800'}`}
                >
                  <div className="text-sm text-gray-400">세트 {idx + 1}</div>
                  <div className="text-2xl font-bold">{set.player1Score} - {set.player2Score}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
