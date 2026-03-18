import { useState, useEffect, useCallback } from 'react';
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
  const [announcement, setAnnouncement] = useState('');
  const [showSideChange, setShowSideChange] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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

  // IBSA 득점
  const handleIBSAScore = useCallback(async (
    actingTeam: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress' || match.isPaused) return;

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
    const nextServerName = nextServe === 'player1' ? t1Name : t2Name;
    setAnnouncement(
      `${tName} ${points}점. ${t1Name} ${scoreAfter.player1}점, ${t2Name} ${scoreAfter.player2}점. ${nextServerName} ${nextCount + 1}번째 서브`
    );

    // 승자 체크
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, TEAM_GAME_CONFIG);
    if (setWinner) {
      const winnerId = setWinner === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
      cs.winnerId = winnerId;
      sets[0] = cs;
      await updateMatch({
        sets, status: 'completed', winnerId,
        currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
      });
      return;
    }

    // 사이드 체인지 (16점)
    if (shouldSideChange('team', cs, match.sideChangeUsed ?? false, sets, TEAM_GAME_CONFIG)) {
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
  }, [match, updateMatch]);

  // Undo
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
    setAnnouncement(`취소됨. ${t1Name} ${cs.player1Score}, ${t2Name} ${cs.player2Score}`);
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

  const team1Name = match.team1Name ?? '팀1';
  const team2Name = match.team2Name ?? '팀2';

  // ===== PENDING: 서브 선택 =====
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

  // ===== COMPLETED =====
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
  const currentSet = sets[0] ?? createEmptySet();
  const currentServe = match.currentServe ?? 'player1';
  const serveCountVal = match.serveCount ?? 0;
  const serverName = currentServe === 'player1' ? team1Name : team2Name;
  const maxServes = getMaxServes('team');
  const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];

  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);
  const penaltyActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points >= 2);

  return (
    <div className="min-h-screen flex flex-col">
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>

      {showSideChange && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-6 p-8">
            <h2 className="text-3xl font-bold text-yellow-400">사이드 체인지! (16점)</h2>
            <p className="text-xl text-gray-300">1분 휴식</p>
            <button className="btn btn-primary btn-large" onClick={() => setShowSideChange(false)}>확인</button>
          </div>
        </div>
      )}

      {match.activeTimeout && timeoutRemaining !== null && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="flex flex-col items-center gap-8">
            <h2 className="text-3xl font-bold text-yellow-400">타임아웃</h2>
            <div className="score-large text-white" aria-live="polite">{timeoutRemaining}</div>
            <p className="text-xl text-gray-300">{match.activeTimeout.playerId === match.team1Id ? team1Name : team2Name}</p>
            <button className="btn btn-danger btn-large" onClick={() => updateMatch({ activeTimeout: null })}>타임아웃 종료</button>
          </div>
        </div>
      )}

      {/* 헤더 */}
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

      {/* 서브 표시 */}
      <div className="bg-blue-900/50 px-4 py-2 text-center">
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {serveCountVal + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe}>서브권 변경</button>
      </div>

      {/* 점수판 */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        {[
          { team: 1 as const, name: team1Name, color: 'text-yellow-400', key: 'player1' as const },
          { team: 2 as const, name: team2Name, color: 'text-cyan-400', key: 'player2' as const },
        ].map(({ team, name, color, key }) => {
          const score = team === 1 ? currentSet.player1Score : currentSet.player2Score;
          const isServing = currentServe === key;
          return (
            <div key={team} className={`flex-1 flex flex-col items-center py-4 px-2 ${team === 1 ? 'border-r border-gray-700' : ''}`}>
              <h2 className={`text-xl font-bold ${color}`}>{isServing && '🎾 '}{name}</h2>
              <div className={`text-7xl font-bold my-2 ${color}`} aria-label={`${name} ${score}점`}>{score}</div>
            </div>
          );
        })}
      </div>

      {/* 득점 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">⚽ 골 득점 (+2점)</h3>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-success text-lg py-4 font-bold"
              onClick={() => handleIBSAScore(1, 'goal', 2, false, `${team1Name} 골`)}>
              {team1Name}<br/>골 +2점
            </button>
            <button className="btn btn-success text-lg py-4 font-bold"
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
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${team1Name} ${action.label}`)}>
                  {team1Name}<br/>{action.label}
                </button>
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${team2Name} ${action.label}`)}>
                  {team2Name}<br/>{action.label}
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
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${team1Name} ${action.label}`)}>
                  {team1Name}<br/>{action.label}
                </button>
                <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${team2Name} ${action.label}`)}>
                  {team2Name}<br/>{action.label}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button className="btn btn-danger flex-1" onClick={handleUndo} disabled={history.length === 0}>↩️ 취소</button>
          <button className="btn btn-secondary flex-1" onClick={() => handleTimeout(1)}
            disabled={(match.player1Timeouts ?? 0) >= 1 || !!match.activeTimeout}>
            {team1Name} T/O
          </button>
          <button className="btn btn-secondary flex-1" onClick={() => handleTimeout(2)}
            disabled={(match.player2Timeouts ?? 0) >= 1 || !!match.activeTimeout}>
            {team2Name} T/O
          </button>
        </div>

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
    </div>
  );
}
