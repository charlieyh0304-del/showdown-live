import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePracticeMatch } from '../../hooks/usePracticeMatch';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';
import {
  checkSetWinner,
  checkMatchWinner,
  createEmptySet,
  countSetWins,
} from '@shared/utils/scoring';
import type { SetScore } from '@shared/types';

export default function PracticeScoring() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addSession } = usePracticeHistory();

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

  const [timeoutRemaining, setTimeoutRemaining] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // 관람 모드와 연습 경기 공유 (localStorage)
  useEffect(() => {
    if (match.status === 'in_progress') {
      localStorage.setItem('showdown_practice_live', JSON.stringify([match]));
    } else if (match.status === 'completed') {
      localStorage.removeItem('showdown_practice_live');
    }
    return () => { localStorage.removeItem('showdown_practice_live'); };
  }, [match]);

  useEffect(() => {
    if (!match.activeTimeout) { setTimeoutRemaining(null); return; }
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - match.activeTimeout!.startTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      setTimeoutRemaining(remaining);
      if (remaining <= 0) updateMatch({ activeTimeout: null });
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [match.activeTimeout, updateMatch]);

  const handleScore = useCallback((player: 1 | 2, delta: number) => {
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    if (player === 1) cs.player1Score = Math.max(0, cs.player1Score + delta);
    else cs.player2Score = Math.max(0, cs.player2Score + delta);
    sets[ci] = cs;

    addAction({ type: 'score', player, detail: delta > 0 ? '+1' : '-1' });

    const pName = player === 1 ? p1Name : p2Name;
    setAnnouncement(`${pName} ${delta > 0 ? '득점' : '감점'}. ${p1Name} ${cs.player1Score}점, ${p2Name} ${cs.player2Score}점`);

    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, config);
    if (setWinner && delta > 0) {
      cs.winnerId = setWinner === 1 ? 'player1' : 'player2';
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, config);
      if (matchWinner) {
        const winnerId = matchWinner === 1 ? 'player1' : 'player2';
        updateMatch({ sets, status: 'completed', winnerId, completedAt: Date.now() });
        setAnnouncement(`경기 종료! ${matchWinner === 1 ? p1Name : p2Name} 승리!`);

        const setWins = countSetWins(sets, config);
        addSession({
          id: crypto.randomUUID(),
          date: Date.now(),
          matchType,
          sessionType: 'free',
          duration: Math.floor((Date.now() - match.startedAt) / 1000),
          totalActions: match.actionLog.length + 1,
          finalScore: sets.map(s => `${s.player1Score}-${s.player2Score}`).join(', '),
        });
        return;
      }

      sets.push(createEmptySet());
      updateMatch({ sets, currentSet: ci + 1, player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null });
      setAnnouncement(`세트 종료! ${setWinner === 1 ? p1Name : p2Name} 세트 승리. 다음 세트 시작`);
      return;
    }

    updateMatch({ sets });
  }, [match, config, updateMatch, addAction, p1Name, p2Name, addSession, matchType]);

  const handleFault = useCallback((player: 1 | 2) => {
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const cs = { ...sets[match.currentSet] };
    if (player === 1) cs.player1Faults += 1;
    else cs.player2Faults += 1;
    sets[match.currentSet] = cs;
    updateMatch({ sets });
    addAction({ type: 'fault', player });
    setAnnouncement(`${player === 1 ? p1Name : p2Name} 폴트`);
  }, [match, updateMatch, addAction, p1Name, p2Name]);

  const handleViolation = useCallback((player: 1 | 2) => {
    if (match.status !== 'in_progress') return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const cs = { ...sets[match.currentSet] };
    if (player === 1) cs.player1Violations += 1;
    else cs.player2Violations += 1;
    sets[match.currentSet] = cs;
    updateMatch({ sets });
    addAction({ type: 'violation', player });
  }, [match, updateMatch, addAction]);

  const handleTimeout = useCallback((player: 1 | 2) => {
    if (match.status !== 'in_progress') return;
    const used = player === 1 ? match.player1Timeouts : match.player2Timeouts;
    if (used >= 1) return;
    const up: Record<string, unknown> = { activeTimeout: { playerId: `player${player}`, startTime: Date.now() } };
    if (player === 1) up.player1Timeouts = match.player1Timeouts + 1;
    else up.player2Timeouts = match.player2Timeouts + 1;
    updateMatch(up as any);
    addAction({ type: 'timeout', player });
  }, [match, updateMatch, addAction]);

  // PENDING
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>연습 경기 준비</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{p1Name}</span>
          <span className="text-gray-500">vs</span>
          <span className="text-cyan-400 font-bold">{p2Name}</span>
        </div>
        <p className="text-gray-400">{config.POINTS_TO_WIN}점 | {config.SETS_TO_WIN}세트 선승</p>
        <button className="btn btn-success btn-large text-4xl px-16 py-8" onClick={startMatch} aria-label="경기 시작">
          경기 시작
        </button>
        <button className="btn btn-accent" onClick={() => navigate('/referee/practice/setup')} aria-label="설정으로">설정으로</button>
      </div>
    );
  }

  // COMPLETED
  if (match.status === 'completed') {
    const winnerName = match.winnerId === 'player1' ? p1Name : p2Name;
    const setWins = countSetWins(match.sets, config);
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>연습 경기 종료</h1>
        <div className="text-4xl font-bold text-green-400">{winnerName} 승리!</div>
        <div className="text-2xl text-gray-300">세트 스코어: {setWins.player1} - {setWins.player2}</div>
        {match.sets.map((s: SetScore, i: number) => (
          <div key={i} className="text-lg text-gray-400">세트 {i + 1}: {s.player1Score} - {s.player2Score}</div>
        ))}
        <p className="text-gray-400">총 조작: {match.actionLog.length}회 | 소요시간: {Math.floor((match.completedAt! - match.startedAt) / 1000)}초</p>
        <div className="flex gap-4">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/practice/setup')} aria-label="다시 하기">다시 하기</button>
          <button className="btn btn-secondary btn-large" onClick={() => navigate('/referee/practice')} aria-label="홈으로">홈으로</button>
        </div>
      </div>
    );
  }

  // IN_PROGRESS
  const sets = match.sets;
  const ci = match.currentSet;
  const cs = sets[ci] ?? createEmptySet();
  const setWins = countSetWins(sets, config);

  return (
    <div className="min-h-screen flex flex-col">
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>

      {match.activeTimeout && timeoutRemaining !== null && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-8">
            <h2 className="text-3xl font-bold text-yellow-400">타임아웃</h2>
            <div className="score-large text-white" aria-live="polite">{timeoutRemaining}</div>
            <button className="btn btn-danger btn-large" onClick={() => updateMatch({ activeTimeout: null })} aria-label="타임아웃 종료">
              타임아웃 종료
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/practice')} aria-label="목록으로">← 연습 홈</button>
          <div className="text-center">
            <div className="text-lg font-bold" style={{ color: '#c084fc' }}>세트 {ci + 1}/{config.MAX_SETS}</div>
            <div className="text-sm text-gray-400">세트 스코어: {setWins.player1} - {setWins.player2}</div>
          </div>
          <div className="text-sm text-gray-500">연습</div>
        </div>
      </div>

      <div className="flex-1 flex" aria-live="polite">
        {[{ player: 1 as const, name: p1Name, color: 'text-yellow-400' }, { player: 2 as const, name: p2Name, color: 'text-cyan-400' }].map(({ player, name, color }) => {
          const score = player === 1 ? cs.player1Score : cs.player2Score;
          const faults = player === 1 ? cs.player1Faults : cs.player2Faults;
          const violations = player === 1 ? cs.player1Violations : cs.player2Violations;
          const timeoutsUsed = player === 1 ? match.player1Timeouts : match.player2Timeouts;

          return (
            <div key={player} className={`flex-1 flex flex-col items-center justify-center gap-4 p-4 ${player === 1 ? 'border-r border-gray-700' : ''}`}>
              <h2 className={`text-2xl font-bold ${color}`}>{name}</h2>
              <div className={`score-display ${color}`} aria-label={`${name} 점수 ${score}`}>{score}</div>
              <button className="btn btn-success btn-large w-full text-4xl" style={{ minHeight: '100px' }}
                onClick={() => handleScore(player, 1)} aria-label={`${name} 득점`}>+1</button>
              <button className="btn btn-danger w-full text-2xl" onClick={() => handleScore(player, -1)}
                disabled={score <= 0} aria-label={`${name} 점수 감소`}>-1</button>
              <div className="flex gap-2 w-full">
                <button className="btn btn-accent flex-1 text-sm" onClick={() => handleFault(player)} aria-label={`${name} 폴트`}>
                  폴트 ({faults})
                </button>
                <button className="btn btn-accent flex-1 text-sm" onClick={() => handleViolation(player)} aria-label={`${name} 반칙`}>
                  반칙 ({violations})
                </button>
              </div>
              <button className="btn btn-secondary w-full" onClick={() => handleTimeout(player)}
                disabled={timeoutsUsed >= 1 || !!match.activeTimeout} aria-label={`${name} 타임아웃`}>
                타임아웃 ({timeoutsUsed}/1)
              </button>
            </div>
          );
        })}
      </div>

      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2">세트 기록</h3>
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
