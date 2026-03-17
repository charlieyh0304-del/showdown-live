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
import type { SetScore, ScoreActionType, ScoreHistoryEntry } from '@shared/types';

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
  const [showSideChange, setShowSideChange] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // localStorage 공유 (관람 모드)
  useEffect(() => {
    if (match.status === 'in_progress') {
      localStorage.setItem('showdown_practice_live', JSON.stringify([match]));
    } else if (match.status === 'completed') {
      localStorage.removeItem('showdown_practice_live');
    }
    return () => { localStorage.removeItem('showdown_practice_live'); };
  }, [match]);

  // 타임아웃 카운트다운
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

  // IBSA 득점 처리
  const handleIBSAScore = useCallback((
    actingPlayer: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (match.status !== 'in_progress' || match.isPaused) return;

    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    const scoreBefore = { player1: cs.player1Score, player2: cs.player2Score };

    // 점수를 받는 선수 결정
    const scoringPlayer = toOpponent
      ? (actingPlayer === 1 ? 2 : 1)
      : actingPlayer;

    if (scoringPlayer === 1) cs.player1Score += points;
    else cs.player2Score += points;
    sets[ci] = cs;

    const scoreAfter = { player1: cs.player1Score, player2: cs.player2Score };

    // 서브 정보 기록
    const serverName = match.currentServe === 'player1' ? p1Name : p2Name;
    const serveNumber = match.serveCount + 1;

    // 히스토리 항목 생성
    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: scoringPlayer === 1 ? p1Name : p2Name,
      actionPlayer: actingPlayer === 1 ? p1Name : p2Name,
      actionType,
      actionLabel: label,
      points,
      set: ci + 1,
      server: serverName,
      serveNumber,
      scoreBefore,
      scoreAfter,
    });

    const newHistory = [historyEntry, ...match.scoreHistory];

    // 서브 카운트 진행
    const { currentServe: nextServe, serveCount: nextCount } = advanceServe(
      match.currentServe, match.serveCount, matchType,
    );

    addAction({ type: 'score', player: actingPlayer, detail: `${label} (${points}점)` });

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;
    setAnnouncement(
      `${pName} ${points}점. ${p1Name} ${scoreAfter.player1}점, ${p2Name} ${scoreAfter.player2}점. ${nextServerName} ${nextCount + 1}번째 서브`
    );

    // 세트 승자 체크
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, config);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? 'player1' : 'player2';
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, config);
      if (matchWinner) {
        const winnerId = matchWinner === 1 ? 'player1' : 'player2';
        updateMatch({
          sets, status: 'completed', winnerId, completedAt: Date.now(),
          currentServe: nextServe, serveCount: nextCount,
          scoreHistory: newHistory,
        });

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

      // 다음 세트
      sets.push(createEmptySet());
      updateMatch({
        sets, currentSet: ci + 1,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: false,
        scoreHistory: newHistory,
      });
      return;
    }

    // 사이드 체인지 체크
    if (shouldSideChange(matchType, cs, match.sideChangeUsed, sets, config)) {
      updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
      });
      setShowSideChange(true);
      return;
    }

    updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
    });
  }, [match, config, updateMatch, addAction, p1Name, p2Name, matchType]);

  // 취소 (Undo)
  const handleUndo = useCallback(() => {
    if (match.status !== 'in_progress' || match.scoreHistory.length === 0) return;

    const lastEntry = match.scoreHistory[0];
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    // 점수 복원
    cs.player1Score = lastEntry.scoreBefore.player1;
    cs.player2Score = lastEntry.scoreBefore.player2;
    cs.winnerId = null;
    sets[ci] = cs;

    // 서브 되돌리기
    const { currentServe, serveCount } = revertServe(
      match.currentServe, match.serveCount, matchType,
    );

    const newHistory = match.scoreHistory.slice(1);

    updateMatch({
      sets, currentServe, serveCount, scoreHistory: newHistory,
    });

    setAnnouncement(`취소됨. ${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}`);
  }, [match, updateMatch, p1Name, p2Name, matchType]);

  // 서브권 수동 변경
  const handleChangeServe = useCallback(() => {
    if (match.status !== 'in_progress') return;
    updateMatch({
      currentServe: match.currentServe === 'player1' ? 'player2' : 'player1',
      serveCount: 0,
    });
    const newServer = match.currentServe === 'player1' ? p2Name : p1Name;
    setAnnouncement(`서브권 변경: ${newServer}`);
  }, [match, updateMatch, p1Name, p2Name]);

  // 타임아웃
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

  // ===== PENDING (서브 선택) =====
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
            <button
              className="btn btn-success btn-large flex-1 text-xl py-6"
              onClick={() => startMatch('player1')}
            >
              🎾 {p1Name}
            </button>
            <button
              className="btn btn-success btn-large flex-1 text-xl py-6"
              onClick={() => startMatch('player2')}
            >
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
        {match.sets.map((s: SetScore, i: number) => (
          <div key={i} className="text-lg text-gray-400">세트 {i + 1}: {s.player1Score} - {s.player2Score}</div>
        ))}
        <p className="text-gray-400">총 조작: {match.actionLog.length}회 | 소요시간: {Math.floor((match.completedAt! - match.startedAt) / 1000)}초</p>

        {/* 경기 기록 */}
        {match.scoreHistory.length > 0 && (
          <div className="w-full max-w-lg">
            <h3 className="text-lg font-bold text-gray-300 mb-2">경기 기록 ({match.scoreHistory.length})</h3>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {match.scoreHistory.map((h: ScoreHistoryEntry, i: number) => (
                <div key={i} className="text-sm text-gray-400 bg-gray-800 rounded px-3 py-2">
                  <span className="text-gray-500">{h.time}</span>{' '}
                  {h.actionType === 'goal' ? '⚽' : h.points >= 2 ? '🔴' : '🟡'}{' '}
                  {h.actionLabel} → {h.scoringPlayer} +{h.points} |{' '}
                  {h.scoreAfter.player1}-{h.scoreAfter.player2}
                </div>
              ))}
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

  // 파울/벌점 액션 분류
  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);
  const penaltyActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points >= 2);

  return (
    <div className="min-h-screen flex flex-col">
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>

      {/* 사이드 체인지 모달 */}
      {showSideChange && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-6 p-8">
            <h2 className="text-3xl font-bold text-yellow-400">사이드 체인지!</h2>
            <p className="text-xl text-gray-300">1분 휴식</p>
            <button className="btn btn-primary btn-large" onClick={() => setShowSideChange(false)}>
              확인
            </button>
          </div>
        </div>
      )}

      {/* 타임아웃 오버레이 */}
      {match.activeTimeout && timeoutRemaining !== null && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-8">
            <h2 className="text-3xl font-bold text-yellow-400">타임아웃</h2>
            <div className="score-large text-white" aria-live="polite">{timeoutRemaining}</div>
            <button className="btn btn-danger btn-large" onClick={() => updateMatch({ activeTimeout: null })}>
              타임아웃 종료
            </button>
          </div>
        </div>
      )}

      {/* 헤더 */}
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

      {/* 서브 표시 */}
      <div className="bg-blue-900/50 px-4 py-2 text-center">
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {match.serveCount + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe}>
          서브권 변경
        </button>
      </div>

      {/* 점수판 */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        {[
          { player: 1 as const, name: p1Name, color: 'text-yellow-400', key: 'player1' },
          { player: 2 as const, name: p2Name, color: 'text-cyan-400', key: 'player2' },
        ].map(({ player, name, color, key }) => {
          const score = player === 1 ? cs.player1Score : cs.player2Score;
          const isServing = match.currentServe === key;
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
              onClick={() => handleIBSAScore(1, 'goal', 2, false, `${p1Name} 골`)}
            >
              {p1Name}<br/>골 +2점
            </button>
            <button
              className="btn btn-success text-lg py-4 font-bold"
              onClick={() => handleIBSAScore(2, 'goal', 2, false, `${p2Name} 골`)}
            >
              {p2Name}<br/>골 +2점
            </button>
          </div>
        </div>

        {/* 파울 +1 (상대 득점) */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">🟡 파울 +1점 (상대 득점)</h3>
          <div className="space-y-2">
            {foulActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                <button
                  className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${p1Name} ${action.label}`)}
                >
                  {p1Name}<br/>{action.label}
                </button>
                <button
                  className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${p2Name} ${action.label}`)}
                >
                  {p2Name}<br/>{action.label}
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
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${p1Name} ${action.label}`)}
                >
                  {p1Name}<br/>{action.label}
                </button>
                <button
                  className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${p2Name} ${action.label}`)}
                >
                  {p2Name}<br/>{action.label}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-3">
          <button
            className="btn btn-danger flex-1"
            onClick={handleUndo}
            disabled={match.scoreHistory.length === 0}
          >
            ↩️ 취소
          </button>
          <button
            className="btn btn-secondary flex-1"
            onClick={() => handleTimeout(1)}
            disabled={match.player1Timeouts >= 1 || !!match.activeTimeout}
          >
            {p1Name} 타임아웃
          </button>
          <button
            className="btn btn-secondary flex-1"
            onClick={() => handleTimeout(2)}
            disabled={match.player2Timeouts >= 1 || !!match.activeTimeout}
          >
            {p2Name} 타임아웃
          </button>
        </div>

        {/* 경기 기록 (토글) */}
        <div>
          <button
            className="text-sm text-gray-400 underline mb-2"
            onClick={() => setShowHistory(!showHistory)}
          >
            {showHistory ? '▲ 경기 기록 닫기' : `▼ 경기 기록 (${match.scoreHistory.length})`}
          </button>
          {showHistory && match.scoreHistory.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {match.scoreHistory.map((h: ScoreHistoryEntry, i: number) => (
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
