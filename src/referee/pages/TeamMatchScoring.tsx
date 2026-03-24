import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatch, useTournament } from '@shared/hooks/useFirebase';
import {
  checkSetWinner,
  createEmptySet,
  advanceServe,
  revertServe,
  shouldSideChange,
  createScoreHistoryEntry,
  getMaxServes,
  getEffectiveGameConfig,
} from '@shared/utils/scoring';
import { IBSA_SCORE_ACTIONS } from '@shared/types';
import type { ScoreActionType, ScoreHistoryEntry } from '@shared/types';
import { useCountdownTimer } from '../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../hooks/useDoubleClickGuard';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { autoBackupDebounced, autoBackupToLocal } from '@shared/utils/backup';
import TimerModal from '../components/TimerModal';
import SetGroupedHistory from '../components/SetGroupedHistory';
import ActionToast from '../components/ActionToast';

const DEFAULT_TEAM_CONFIG = {
  SETS_TO_WIN: 1,
  MAX_SETS: 1,
  POINTS_TO_WIN: 31,
  MIN_POINT_DIFF: 2,
} as const;

export default function TeamMatchScoring() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);
  const gameConfig = tournament
    ? getEffectiveGameConfig(tournament.scoringRules || tournament.gameConfig)
    : DEFAULT_TEAM_CONFIG;
  const { canAct } = useDoubleClickGuard();
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
  // Substitution (선수 교체)
  const [showSubstitution, setShowSubstitution] = useState(false);
  const [subTeam, setSubTeam] = useState<1 | 2 | null>(null);
  const [subOutIndex, setSubOutIndex] = useState<number | null>(null);
  const [subInIndex, setSubInIndex] = useState<number | null>(null);

  // Coin toss flow
  const [coinTossStep, setCoinTossStep] = useState<'toss' | 'choice'>('toss');
  const [tossWinner, setTossWinner] = useState<'team1' | 'team2' | null>(null);

  // Timers
  const sideChangeTimer = useCountdownTimer(() => setShowSideChange(false));
  const warmupTimer = useCountdownTimer(() => setShowWarmup(false));
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
  });

  // Navigation guard
  useNavigationGuard(match?.status === 'in_progress');

  // 15초 안내 (타임아웃)
  useEffect(() => {
    if (timeoutTimer.seconds === 15 && timeoutTimer.isRunning) {
      setLastAction('⚠️ 15초 남았습니다');
      setAnnouncement('15초 남았습니다');
    }
  }, [timeoutTimer.seconds, timeoutTimer.isRunning]);

  // 15초 안내 (사이드 체인지)
  useEffect(() => {
    if (sideChangeTimer.seconds === 15 && sideChangeTimer.isRunning) {
      setLastAction('⚠️ 사이드 체인지 15초 남았습니다');
      setAnnouncement('15초 남았습니다');
    }
  }, [sideChangeTimer.seconds, sideChangeTimer.isRunning]);

  // 팀전 워밍업 90초: 60초 남음(30초 경과), 30초 남음(60초 경과) 알림
  useEffect(() => {
    if (warmupTimer.isRunning) {
      if (warmupTimer.seconds === 60) {
        setLastAction('⚠️ 30초');
        setAnnouncement('30초');
      }
      if (warmupTimer.seconds === 30) {
        setLastAction('⚠️ 30초');
        setAnnouncement('30초');
      }
    }
  }, [warmupTimer.seconds, warmupTimer.isRunning]);

  // Start timeout timer when activeTimeout changes
  useEffect(() => {
    if (match?.activeTimeout) {
      const type = match.activeTimeout.type ?? 'player';
      const totalDuration = type === 'player' ? 60 : type === 'medical' ? 300 : 0;
      if (totalDuration > 0) {
        const elapsed = Math.floor((Date.now() - match.activeTimeout.startTime) / 1000);
        const remaining = Math.max(0, totalDuration - elapsed);
        if (remaining > 0) timeoutTimer.start(remaining);
      }
      // referee timeout: no auto-timer (manual end)
    } else {
      timeoutTimer.stop();
    }
  }, [match?.activeTimeout, timeoutTimer]);

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

  const team1Name = match?.team1Name ?? '팀1';
  const team2Name = match?.team2Name ?? '팀2';

  const handleStartMatch = useCallback(async (tossWinnerVal: 'team1' | 'team2', choice: 'serve' | 'receive') => {
    if (!match) return;

    // Determine who serves first
    const firstServe = choice === 'serve'
      ? (tossWinnerVal === 'team1' ? 'player1' : 'player2')  // Winner serves
      : (tossWinnerVal === 'team1' ? 'player2' : 'player1'); // Winner receives = opponent serves

    const t1n = match.team1Name ?? '팀1';
    const t2n = match.team2Name ?? '팀2';
    const servingTeamName = firstServe === 'player1' ? t1n : t2n;
    const tossWinnerName = tossWinnerVal === 'team1' ? t1n : t2n;

    // Build initial history entries
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ko-KR');
    const initialHistory: ScoreHistoryEntry[] = [
      {
        time: timeStr,
        scoringPlayer: tossWinnerName,
        actionPlayer: tossWinnerName,
        actionType: 'coin_toss' as ScoreActionType,
        actionLabel: `동전던지기: ${tossWinnerName} 승리 → ${choice === 'serve' ? '서브' : '리시브'} 선택`,
        points: 0,
        set: 1,
        server: servingTeamName,
        serveNumber: 1,
        scoreBefore: { player1: 0, player2: 0 },
        scoreAfter: { player1: 0, player2: 0 },
        serverSide: firstServe,
      },
      {
        time: timeStr,
        scoringPlayer: servingTeamName,
        actionPlayer: servingTeamName,
        actionType: 'match_start' as ScoreActionType,
        actionLabel: `${servingTeamName} 첫 서브`,
        points: 0,
        set: 1,
        server: servingTeamName,
        serveNumber: 1,
        scoreBefore: { player1: 0, player2: 0 },
        scoreAfter: { player1: 0, player2: 0 },
        serverSide: firstServe,
      },
    ];

    // Set player order from team member arrays
    const t1 = match.team1;
    const t2 = match.team2;

    await updateMatch({
      status: 'in_progress',
      sets: [createEmptySet()],
      currentSet: 0,
      player1Timeouts: 0,
      player2Timeouts: 0,
      currentServe: firstServe,
      serveCount: 0,
      serveSelected: true,
      scoreHistory: initialHistory,
      warmupUsed: false,
      coinTossWinner: tossWinnerVal,
      coinTossChoice: choice,
      team1PlayerOrder: t1?.memberIds || [],
      team2PlayerOrder: t2?.memberIds || [],
      team1CurrentPlayerIndex: 0,
      team2CurrentPlayerIndex: 0,
    });
  }, [match, updateMatch]);

  // Warmup (team: 90 seconds)
  const handleWarmup = useCallback(() => {
    if (!match || match.warmupUsed) return;
    const timeStr = new Date().toLocaleTimeString('ko-KR');
    const warmupEntry: ScoreHistoryEntry = {
      time: timeStr,
      scoringPlayer: '',
      actionPlayer: '',
      actionType: 'warmup_start' as ScoreActionType,
      actionLabel: '워밍업 시작 (90초)',
      points: 0,
      set: 1,
      server: '',
      serveNumber: 0,
      scoreBefore: { player1: 0, player2: 0 },
      scoreAfter: { player1: 0, player2: 0 },
    };
    updateMatch({
      warmupUsed: true,
      scoreHistory: [...(match.scoreHistory || []), warmupEntry],
    });
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
    const currentSetData = match.sets?.[0];
    const pauseHistoryEntry: ScoreHistoryEntry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      set: (match.currentSet ?? 0) + 1,
      scoringPlayer: '',
      actionPlayer: reasonText,
      actionType: 'pause' as ScoreActionType,
      actionLabel: '일시정지',
      points: 0,
      scoreBefore: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      scoreAfter: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      server: match.currentServe === 'player1' ? (match.team1Name ?? '') : (match.team2Name ?? ''),
      serveNumber: (match.serveCount ?? 0) + 1,
    };
    const prevScoreHistory = match.scoreHistory ?? [];
    await updateMatch({
      isPaused: true,
      pauseReason: reasonText,
      pauseStartTime: Date.now(),
      pauseHistory: [...prevHistory, newEntry],
      scoreHistory: [pauseHistoryEntry, ...prevScoreHistory],
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
    const currentSetData = match.sets?.[0];
    const resumeHistoryEntry: ScoreHistoryEntry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      set: (match.currentSet ?? 0) + 1,
      scoringPlayer: '',
      actionPlayer: `${Math.floor(pauseElapsed / 60)}분 ${pauseElapsed % 60}초`,
      actionType: 'resume' as ScoreActionType,
      actionLabel: '재개',
      points: 0,
      scoreBefore: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      scoreAfter: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      server: match.currentServe === 'player1' ? (match.team1Name ?? '') : (match.team2Name ?? ''),
      serveNumber: (match.serveCount ?? 0) + 1,
    };
    const prevScoreHistory = match.scoreHistory ?? [];
    setIsPausedLocal(false);
    setPauseElapsed(0);
    setPauseReason('');
    await updateMatch({
      isPaused: false,
      pauseReason: '',
      pauseStartTime: undefined,
      pauseHistory: updatedHistory,
      scoreHistory: [resumeHistoryEntry, ...prevScoreHistory],
    });
  }, [match, updateMatch, pauseElapsed]);

  // Walkover (부전승)
  const handleWalkover = useCallback(async (winnerTeam: 1 | 2) => {
    if (!match) return;
    const t1Name = match.team1Name ?? '팀1';
    const t2Name = match.team2Name ?? '팀2';
    const winnerName = winnerTeam === 1 ? t1Name : t2Name;
    const loserName = winnerTeam === 1 ? t2Name : t1Name;

    if (!window.confirm(`${loserName} 기권으로 ${winnerName} 부전승 처리하시겠습니까?`)) return;

    const reason = prompt('부전승 사유를 입력하세요:\n(예: 부상, 기권, 미출석)') || '기권';

    const winnerId = winnerTeam === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: winnerName,
      actionPlayer: loserName,
      actionType: 'walkover',
      actionLabel: `부전승 (${reason})`,
      points: 0,
      set: (match.currentSet ?? 0) + 1,
      server: (match.currentServe ?? 'player1') === 'player1' ? t1Name : t2Name,
      serveNumber: (match.serveCount ?? 0) + 1,
      scoreBefore: { player1: match.sets?.[0]?.player1Score ?? 0, player2: match.sets?.[0]?.player2Score ?? 0 },
      scoreAfter: { player1: match.sets?.[0]?.player1Score ?? 0, player2: match.sets?.[0]?.player2Score ?? 0 },
    });

    const prevHistory = match.scoreHistory ?? [];
    const updateData: Record<string, unknown> = {
      status: 'completed',
      winnerId,
      walkover: true,
      walkoverReason: reason,
      scoreHistory: [historyEntry, ...prevHistory],
    };

    // If match is pending, create initial sets
    if (match.status === 'pending') {
      updateData.sets = [createEmptySet()];
      updateData.currentSet = 0;
    }

    await updateMatch(updateData);

    setLastAction(`부전승: ${winnerName} 승리 (${reason})`);
    setAnnouncement(`${loserName} ${reason}. ${winnerName} 부전승`);
  }, [match, updateMatch]);

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
      serverSide: currentServe,
    });

    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    let newHistory = [historyEntry, ...prevHistory];

    const { currentServe: nextServe, serveCount: nextCount } = advanceServe(
      currentServe, serveCount, 'team',
    );

    // Player rotation: 서브를 마친 팀이 선수 교체 (로테이션)
    let rotationUpdate: Record<string, unknown> = {};
    if (nextCount === 0 && nextServe !== currentServe) {
      // 서브를 마친 팀 = currentServe 쪽 팀이 로테이션
      const teamKey = currentServe === 'player1' ? 'team1' : 'team2';
      const orderKey = `${teamKey}PlayerOrder` as 'team1PlayerOrder' | 'team2PlayerOrder';
      const indexKey = `${teamKey}CurrentPlayerIndex` as 'team1CurrentPlayerIndex' | 'team2CurrentPlayerIndex';
      const currentIdx = (match[indexKey] as number | undefined) ?? 0;
      const order = (match[orderKey] as string[] | undefined) ?? [];
      const activeCount = Math.min(3, order.length);
      const nextIdx = activeCount > 0 ? (currentIdx + 1) % activeCount : 0;
      const rotTeamName = currentServe === 'player1' ? t1Name : t2Name;

      const rotationEntry: ScoreHistoryEntry = {
        time: new Date().toLocaleTimeString('ko-KR'),
        scoringPlayer: '',
        actionPlayer: rotTeamName,
        actionType: 'player_rotation' as ScoreActionType,
        actionLabel: `선수 로테이션 (${rotTeamName})`,
        points: 0,
        set: 1,
        server: nextServe === 'player1' ? t1Name : t2Name,
        serveNumber: 1,
        scoreBefore: scoreAfter,
        scoreAfter: scoreAfter,
        serverSide: nextServe,
      };
      newHistory = [rotationEntry, ...newHistory];
      rotationUpdate = { [indexKey]: nextIdx };
    }

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

    // Winner check
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, gameConfig);
    if (setWinner) {
      const winnerId = setWinner === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
      cs.winnerId = winnerId;
      sets[0] = cs;
      await updateMatch({
        sets, status: 'completed', winnerId,
        currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
        ...rotationUpdate,
      });
      if (tournamentId) autoBackupToLocal(tournamentId);
      return;
    }

    // Side change (16 points)
    if (shouldSideChange('team', cs, match.sideChangeUsed ?? false, sets, gameConfig)) {
      await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
        ...rotationUpdate,
      });
      sideChangeTimer.start(60);
      setShowSideChange(true);
      return;
    }

    await updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
      ...rotationUpdate,
    });
    if (tournamentId) autoBackupDebounced(tournamentId);
  }, [match, gameConfig, updateMatch, canAct, sideChangeTimer, tournamentId]);

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

  // Dead Ball - 양쪽 모두 가능
  const handleDeadBall = useCallback(async (team: 1 | 2) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout) return;

    const currentSetData = match.sets?.[0];
    const t1Name = match.team1Name ?? '팀1';
    const t2Name = match.team2Name ?? '팀2';
    const currentServe = match.currentServe ?? 'player1';
    const serveCount = match.serveCount ?? 0;
    const serverTeamName = currentServe === 'player1' ? t1Name : t2Name;
    const actionTeamName = team === 1 ? t1Name : t2Name;
    const scoreBefore = { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 };

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: '',
      actionPlayer: actionTeamName,
      actionType: 'dead_ball',
      actionLabel: `${actionTeamName} 데드볼 → 재서브`,
      points: 0,
      set: 1,
      server: serverTeamName,
      serveNumber: serveCount + 1,
      scoreBefore,
      scoreAfter: scoreBefore,
      serverSide: currentServe,
    });

    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    await updateMatch({
      scoreHistory: [historyEntry, ...prevHistory],
    });

    setLastAction(`${actionTeamName} 데드볼 - ${serverTeamName} 재서브`);
    setAnnouncement(`${actionTeamName} 데드볼. ${serverTeamName} 재서브`);
  }, [match, updateMatch]);

  const handleTimeout = useCallback(async (team: 1 | 2, type: 'player' | 'medical' | 'referee' = 'player') => {
    if (!match || match.status !== 'in_progress') return;
    // player timeout: 1회 제한
    if (type === 'player') {
      const usedTimeouts = team === 1 ? (match.player1Timeouts ?? 0) : (match.player2Timeouts ?? 0);
      if (usedTimeouts >= 1) return;
    }
    // medical timeout: 1회 제한
    if (type === 'medical') {
      const tName = team === 1 ? (match.team1Name ?? '팀1') : (match.team2Name ?? '팀2');
      const medUsed = (match.scoreHistory || []).filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === tName).length;
      if (medUsed >= 1) return;
    }
    const teamId = team === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
    const tName = team === 1 ? (match.team1Name ?? '팀1') : (match.team2Name ?? '팀2');
    const currentSetData = match.sets?.[0];
    const actionType = type === 'player' ? 'timeout_player' : type === 'medical' ? 'timeout_medical' : 'timeout_referee';
    const actionLabel = type === 'player' ? '선수 타임아웃' : type === 'medical' ? '메디컬 타임아웃' : '레프리 타임아웃';
    const timeoutEntry: ScoreHistoryEntry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      set: 1,
      scoringPlayer: '',
      actionPlayer: type === 'referee' ? '' : tName,
      actionType: actionType as ScoreActionType,
      actionLabel,
      points: 0,
      scoreBefore: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      scoreAfter: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      server: match.currentServe === 'player1' ? (match.team1Name ?? '') : (match.team2Name ?? ''),
      serveNumber: (match.serveCount ?? 0) + 1,
    };
    const prevHistory = match.scoreHistory ?? [];
    const duration = type === 'player' ? 60 : type === 'medical' ? 300 : 0;
    const up: Record<string, unknown> = {
      activeTimeout: { playerId: teamId, startTime: Date.now(), type },
      scoreHistory: [timeoutEntry, ...prevHistory],
    };
    if (type === 'player') {
      if (team === 1) up.player1Timeouts = (match.player1Timeouts ?? 0) + 1;
      else up.player2Timeouts = (match.player2Timeouts ?? 0) + 1;
    }
    await updateMatch(up);
    if (duration > 0) timeoutTimer.start(duration);
  }, [match, updateMatch, timeoutTimer]);

  // 벌점 핸들러: 경고 카운트를 scoreHistory에서 동적 계산
  const handlePenalty = useCallback(async (
    actingTeam: 1 | 2,
    penaltyType: 'penalty_table_pushing' | 'penalty_electronic' | 'penalty_talking',
  ) => {
    if (!canAct()) return;
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout) return;

    const t1Name = match.team1Name ?? '팀1';
    const t2Name = match.team2Name ?? '팀2';
    const actorName = actingTeam === 1 ? t1Name : t2Name;

    // penalty_electronic은 즉시 2점
    if (penaltyType === 'penalty_electronic') {
      const label = `${actorName} 전자기기 소리`;
      handleIBSAScore(actingTeam, penaltyType, 2, true, label);
      return;
    }

    // penalty_table_pushing, penalty_talking: 1회 경고 → 2회 2점 실점
    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    const warningCount = prevHistory.filter(
      h => h.actionType === penaltyType && h.actionPlayer === actorName && h.penaltyWarning === true
    ).length;

    if (warningCount === 0) {
      // 첫 번째: 경고만
      const currentSetData = match.sets?.[0];
      const scoreBefore = { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 };
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? '테이블 푸싱' : '경기 중 말하기';
      const warningEntry: ScoreHistoryEntry = {
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        set: 1,
        scoringPlayer: '',
        actionPlayer: actorName,
        actionType: penaltyType as ScoreActionType,
        actionLabel: penaltyLabel,
        points: 0,
        penaltyWarning: true,
        scoreBefore,
        scoreAfter: scoreBefore,
        server: match.currentServe === 'player1' ? t1Name : t2Name,
        serveNumber: (match.serveCount ?? 0) + 1,
        serverSide: match.currentServe ?? 'player1',
      };
      await updateMatch({ scoreHistory: [warningEntry, ...prevHistory] });
      setLastAction(`⚠️ ${actorName} ${penaltyLabel} 경고 (1회)`);
      setAnnouncement(`${actorName} ${penaltyLabel} 경고`);
    } else {
      // 2회 이상: 2점 실점
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? '테이블 푸싱' : '경기 중 말하기';
      const label = `${actorName} ${penaltyLabel}`;
      handleIBSAScore(actingTeam, penaltyType, 2, true, label);
    }
  }, [match, canAct, handleIBSAScore, updateMatch]);

  // Substitution helpers
  const teamSize = tournament?.teamRules?.teamSize ?? 3;

  const getTeamActivePlayers = useCallback((teamNum: 1 | 2) => {
    if (!match) return { ids: [] as string[], names: [] as string[] };
    const team = teamNum === 1 ? match.team1 : match.team2;
    const activeIds = teamNum === 1 ? match.team1ActivePlayerIds : match.team2ActivePlayerIds;
    const activeNames = teamNum === 1 ? match.team1ActivePlayerNames : match.team2ActivePlayerNames;
    if (activeIds && activeNames) {
      return { ids: activeIds, names: activeNames };
    }
    const allIds = team?.memberIds ?? [];
    const allNames = team?.memberNames ?? [];
    return {
      ids: allIds.slice(0, teamSize),
      names: allNames.slice(0, teamSize),
    };
  }, [match, teamSize]);

  const getTeamReservePlayers = useCallback((teamNum: 1 | 2) => {
    if (!match) return { ids: [] as string[], names: [] as string[] };
    const team = teamNum === 1 ? match.team1 : match.team2;
    const activeIds = teamNum === 1 ? match.team1ActivePlayerIds : match.team2ActivePlayerIds;
    const allIds = team?.memberIds ?? [];
    const allNames = team?.memberNames ?? [];
    if (activeIds) {
      const reserveIds: string[] = [];
      const reserveNames: string[] = [];
      allIds.forEach((id, i) => {
        if (!activeIds.includes(id)) {
          reserveIds.push(id);
          reserveNames.push(allNames[i] ?? id);
        }
      });
      return { ids: reserveIds, names: reserveNames };
    }
    return {
      ids: allIds.slice(teamSize),
      names: allNames.slice(teamSize),
    };
  }, [match, teamSize]);

  const hasReserves = useCallback((teamNum: 1 | 2) => {
    return getTeamReservePlayers(teamNum).ids.length > 0;
  }, [getTeamReservePlayers]);

  const openSubstitution = useCallback((teamNum: 1 | 2) => {
    setSubTeam(teamNum);
    setSubOutIndex(null);
    setSubInIndex(null);
    setShowSubstitution(true);
  }, []);

  const handleSubstitution = useCallback(async () => {
    if (!match || subTeam === null || subOutIndex === null || subInIndex === null) return;

    const active = getTeamActivePlayers(subTeam);
    const reserves = getTeamReservePlayers(subTeam);

    const outId = active.ids[subOutIndex];
    const outName = active.names[subOutIndex] ?? outId;
    const inId = reserves.ids[subInIndex];
    const inName = reserves.names[subInIndex] ?? inId;

    const newActiveIds = [...active.ids];
    const newActiveNames = [...active.names];
    newActiveIds[subOutIndex] = inId;
    newActiveNames[subOutIndex] = inName;

    const t1Name = match.team1Name ?? '팀1';
    const t2Name = match.team2Name ?? '팀2';
    const currentServeVal = match.currentServe ?? 'player1';
    const serveCountVal = match.serveCount ?? 0;
    const serverNameVal = currentServeVal === 'player1' ? t1Name : t2Name;
    const cs = match.sets?.[0];
    const scoreBefore = {
      player1: cs?.player1Score ?? 0,
      player2: cs?.player2Score ?? 0,
    };

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: subTeam === 1 ? t1Name : t2Name,
      actionPlayer: subTeam === 1 ? t1Name : t2Name,
      actionType: 'substitution',
      actionLabel: `선수 교체: ${outName} → ${inName}`,
      points: 0,
      set: 1,
      server: serverNameVal,
      serveNumber: serveCountVal + 1,
      scoreBefore,
      scoreAfter: scoreBefore,
    });

    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    const newHistory = [historyEntry, ...prevHistory];

    const update: Record<string, unknown> = {
      scoreHistory: newHistory,
    };

    if (subTeam === 1) {
      update.team1SubUsed = true;
      update.team1ActivePlayerIds = newActiveIds;
      update.team1ActivePlayerNames = newActiveNames;
    } else {
      update.team2SubUsed = true;
      update.team2ActivePlayerIds = newActiveIds;
      update.team2ActivePlayerNames = newActiveNames;
    }

    await updateMatch(update);

    const teamLabel = subTeam === 1 ? t1Name : t2Name;
    setLastAction(`🔄 ${teamLabel} 선수 교체: ${outName} → ${inName}`);
    setAnnouncement(`${teamLabel} 선수 교체. ${outName} 퇴장, ${inName} 입장`);
    setShowSubstitution(false);
    setSubTeam(null);
    setSubOutIndex(null);
    setSubInIndex(null);
  }, [match, subTeam, subOutIndex, subInIndex, updateMatch, getTeamActivePlayers, getTeamReservePlayers]);

  // Keyboard shortcuts (GAP-12)

  // Keyboard shortcuts - useEffect directly (useMemo + useKeyboardShortcuts causes React #310)
  useEffect(() => {
    if (match?.status !== 'in_progress') return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'ArrowLeft') { e.preventDefault(); handleIBSAScore(1, 'goal', 2, false, `${team1Name} 골`); }
      if (e.code === 'ArrowRight') { e.preventDefault(); handleIBSAScore(2, 'goal', 2, false, `${team2Name} 골`); }
      if (e.code === 'KeyZ') { e.preventDefault(); handleUndo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [match?.status, handleIBSAScore, handleUndo, team1Name, team2Name]);

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
          <div className="text-center">
            <span className="text-yellow-400 font-bold">{team1Name}</span>
            {match.team1?.coachName && <div className="text-sm text-gray-400">코치: {match.team1.coachName}</div>}
          </div>
          <span className="text-gray-400">vs</span>
          <div className="text-center">
            <span className="text-cyan-400 font-bold">{team2Name}</span>
            {match.team2?.coachName && <div className="text-sm text-gray-400">코치: {match.team2.coachName}</div>}
          </div>
        </div>
        <p className="text-lg text-gray-400">31점 단판 승부 | 서브 3회 교대</p>
        {match.courtName && <p className="text-gray-400">코트: {match.courtName}</p>}

        {coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">동전던지기 승자</h2>
            <div className="flex gap-4">
              <button className="btn btn-primary btn-large flex-1" onClick={() => { setTossWinner('team1'); setCoinTossStep('choice'); }}>
                {team1Name}
              </button>
              <button className="btn btn-primary btn-large flex-1" onClick={() => { setTossWinner('team2'); setCoinTossStep('choice'); }}>
                {team2Name}
              </button>
            </div>
          </div>
        )}
        {coinTossStep === 'choice' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">
              {tossWinner === 'team1' ? team1Name : team2Name} 승리!
            </h2>
            <p className="text-gray-400 text-center">서브 또는 리시브를 선택하세요</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1" onClick={() => handleStartMatch(tossWinner, 'serve')} aria-label={`${tossWinner === 'team1' ? team1Name : team2Name}가 서브 선택`}>
                🎾 서브
              </button>
              <button className="btn btn-accent btn-large flex-1" onClick={() => handleStartMatch(tossWinner, 'receive')} aria-label={`${tossWinner === 'team1' ? team1Name : team2Name}가 리시브 선택`}>
                🏓 리시브
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }} aria-label="동전던지기 다시 선택" style={{ minHeight: '44px' }}>
              다시 선택
            </button>
          </div>
        )}
        <div className="card w-full max-w-md space-y-4">
          <div className="border-t border-gray-700 pt-3">
            <h3 className="text-sm font-bold text-gray-400 mb-2">부전승 처리</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
                onClick={() => handleWalkover(1)}
              >
                {team1Name} 부전승
              </button>
              <button
                className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
                onClick={() => handleWalkover(2)}
              >
                {team2Name} 부전승
              </button>
            </div>
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
      <div className="min-h-screen flex flex-col p-4">
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-yellow-400">팀전 경기 종료</h1>
          <div className="text-4xl font-bold text-green-400 mt-2" role="status" aria-live="assertive">🏆 {winnerName} 승리!</div>
          {finalSet && (
            <div className="mt-2">
              <div className="inline-flex items-center bg-gray-800 rounded-lg px-6 py-3 gap-4" aria-label={`최종 스코어 ${team1Name} ${finalSet.player1Score} 대 ${team2Name} ${finalSet.player2Score}`}>
                <span className="text-lg text-gray-300">{team1Name}</span>
                <span className="text-3xl font-bold">
                  <span className="text-yellow-400">{finalSet.player1Score}</span>
                  <span className="text-gray-400"> - </span>
                  <span className="text-cyan-400">{finalSet.player2Score}</span>
                </span>
                <span className="text-lg text-gray-300">{team2Name}</span>
              </div>
            </div>
          )}
        </div>
        {/* 상세 경기 기록 */}
        {history.length > 0 && (
          <div className="w-full max-w-lg mx-auto flex-1 flex flex-col min-h-0">
            <h3 className="text-lg font-bold text-gray-300 mb-2">상세 경기 기록 ({history.length})</h3>
            <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
              <SetGroupedHistory history={history} sets={match.sets ?? []} showAll />
            </div>
          </div>
        )}
        <div className="text-center mt-4">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>목록으로</button>
        </div>
      </div>
    );
  }

  // ===== IN_PROGRESS =====
  const sets = Array.isArray(match.sets) && match.sets.length > 0 ? match.sets : [createEmptySet()];
  const currentSet = sets[0] ?? createEmptySet();
  const currentServe = match.currentServe ?? 'player1';
  const serveCountVal = match.serveCount ?? 0;
  const serverName = currentServe === 'player1' ? team1Name : team2Name;
  const maxServes = getMaxServes('team');
  const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];

  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);

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
  const scoringDisabled = !!match.activeTimeout || isPausedLocal || showSideChange;

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
      {match.activeTimeout && (timeoutTimer.isRunning || match.activeTimeout.type === 'referee') && (
        <TimerModal
          title={match.activeTimeout.type === 'medical' ? '🏥 메디컬 타임아웃' : match.activeTimeout.type === 'referee' ? '🟨 레프리 타임아웃' : '⏱️ 선수 타임아웃'}
          seconds={timeoutTimer.seconds}
          isWarning={timeoutTimer.isWarning}
          subtitle={match.activeTimeout.type === 'referee' ? '수동 종료' : (match.activeTimeout.playerId === match.team1Id ? team1Name : team2Name)}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); }}
          closeLabel="타임아웃 종료"
        />
      )}

      {/* Substitution Modal (선수 교체) */}
      {showSubstitution && subTeam !== null && (() => {
        const active = getTeamActivePlayers(subTeam);
        const reserves = getTeamReservePlayers(subTeam);
        const subTeamName = subTeam === 1 ? team1Name : team2Name;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onKeyDown={e => { if (e.key === 'Escape') { setShowSubstitution(false); setSubTeam(null); } }}>
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4" role="dialog" aria-modal="true" aria-label={`${subTeamName} 선수 교체`}>
              <h2 className="text-xl font-bold text-indigo-300 text-center">
                🔄 {subTeamName} 선수 교체
              </h2>

              {/* Select player to remove */}
              <div>
                <h3 className="text-sm font-bold text-gray-400 mb-2">교체할 선수 (퇴장)</h3>
                <div className="space-y-1">
                  {active.names.map((name, i) => (
                    <button
                      key={active.ids[i] ?? i}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${
                        subOutIndex === i
                          ? 'bg-red-700 text-white'
                          : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      }`}
                      onClick={() => setSubOutIndex(i)}
                      aria-pressed={subOutIndex === i}
                      aria-label={`${name} 퇴장 선택${subOutIndex === i ? ' (선택됨)' : ''}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Select reserve to bring in */}
              <div>
                <h3 className="text-sm font-bold text-gray-400 mb-2">투입할 예비 선수 (입장)</h3>
                <div className="space-y-1">
                  {reserves.names.map((name, i) => (
                    <button
                      key={reserves.ids[i] ?? i}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${
                        subInIndex === i
                          ? 'bg-green-700 text-white'
                          : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      }`}
                      onClick={() => setSubInIndex(i)}
                      aria-pressed={subInIndex === i}
                      aria-label={`${name} 입장 선택${subInIndex === i ? ' (선택됨)' : ''}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Confirm / Cancel */}
              <div className="flex gap-3 pt-2">
                <button
                  className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white"
                  onClick={() => { setShowSubstitution(false); setSubTeam(null); }}
                >
                  취소
                </button>
                <button
                  className="btn flex-1 bg-indigo-600 hover:bg-indigo-500 text-white"
                  disabled={subOutIndex === null || subInIndex === null}
                  onClick={handleSubstitution}
                >
                  교체 확인
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pause Banner */}
      {isPausedLocal && (
        <div className="bg-orange-900/80 px-4 py-3 flex items-center justify-between" role="status" aria-live="polite" aria-label="경기 일시정지 중">
          <div>
            <span className="text-orange-300 font-bold">⏸️ 경기 일시정지</span>
            <span className="text-orange-200 ml-3" aria-label={`경과 시간 ${Math.floor(pauseElapsed / 60)}분 ${pauseElapsed % 60}초`}>
              {Math.floor(pauseElapsed / 60)}:{(pauseElapsed % 60).toString().padStart(2, '0')}
            </span>
            {pauseReason && <span className="text-orange-200/70 ml-3 text-sm">({pauseReason})</span>}
          </div>
          <button className="btn btn-success text-sm px-4 py-1" onClick={handleResume} aria-label="경기 재개">▶ 재개</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/games')} aria-label="경기 목록으로 돌아가기">← 목록</button>
          <div className="text-center">
            <h1 className="text-lg font-bold text-yellow-400">팀전 (31점 단판)</h1>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{match.refereeName}</div>}
          </div>
        </div>
      </div>

      {/* Serve */}
      <div className="bg-blue-900/50 px-4 py-2 text-center" role="status" aria-label={`${serverName} 서브 ${serveCountVal + 1}/${maxServes}회차`}>
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {serveCountVal + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label="서브권 수동 변경" style={{ minHeight: '44px', minWidth: '44px' }}>서브권 변경</button>
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
              onClick={() => handleIBSAScore(1, 'goal', 2, false, `${team1Name} 골`)}
              aria-label={`${team1Name} 골 득점. ${team1Name}에게 2점 추가`}>
              {team1Name}<br/>골 +2점
            </button>
            <button className="btn btn-success text-lg py-4 font-bold"
              disabled={scoringDisabled}
              onClick={() => handleIBSAScore(2, 'goal', 2, false, `${team2Name} 골`)}
              aria-label={`${team2Name} 골 득점. ${team2Name}에게 2점 추가`}>
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
                  disabled={scoringDisabled || (action.type === 'irregular_serve' && currentServe !== 'player1')}
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${team1Name} ${action.label}`)}
                  aria-label={`${team1Name} ${action.label}. ${team2Name}에게 1점 추가`}>
                  {team1Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {team2Name} +1점</span>
                </button>
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  disabled={scoringDisabled || (action.type === 'irregular_serve' && currentServe !== 'player2')}
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${team2Name} ${action.label}`)}
                  aria-label={`${team2Name} ${action.label}. ${team1Name}에게 1점 추가`}>
                  {team2Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {team1Name} +1점</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-red-400 mb-2">🔴 벌점 (경고/실점)</h3>
          <div className="space-y-2">
            {/* penalty_table_pushing: 1회 경고 → 2회 2점 */}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(1, 'penalty_table_pushing')}
                aria-label={`${team1Name} 테이블 푸싱. 1회 경고, 2회 ${team2Name}에게 2점`}>
                {team1Name} 테이블 푸싱<br/>
                <span className="text-xs opacity-75">1회 경고 → 2회 +2점</span>
              </button>
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(2, 'penalty_table_pushing')}
                aria-label={`${team2Name} 테이블 푸싱. 1회 경고, 2회 ${team1Name}에게 2점`}>
                {team2Name} 테이블 푸싱<br/>
                <span className="text-xs opacity-75">1회 경고 → 2회 +2점</span>
              </button>
            </div>
            {/* penalty_electronic: 즉시 2점 */}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(1, 'penalty_electronic')}
                aria-label={`${team1Name} 전자기기 소리. ${team2Name}에게 즉시 2점`}>
                {team1Name} 전자기기 소리<br/>
                <span className="text-xs opacity-75">→ {team2Name} 즉시 +2점</span>
              </button>
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(2, 'penalty_electronic')}
                aria-label={`${team2Name} 전자기기 소리. ${team1Name}에게 즉시 2점`}>
                {team2Name} 전자기기 소리<br/>
                <span className="text-xs opacity-75">→ {team1Name} 즉시 +2점</span>
              </button>
            </div>
            {/* penalty_talking: 1회 경고 → 2회 2점 */}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(1, 'penalty_talking')}
                aria-label={`${team1Name} 경기 중 말하기. 1회 경고, 2회 ${team2Name}에게 2점`}>
                {team1Name} 경기 중 말하기<br/>
                <span className="text-xs opacity-75">1회 경고 → 2회 +2점</span>
              </button>
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(2, 'penalty_talking')}
                aria-label={`${team2Name} 경기 중 말하기. 1회 경고, 2회 ${team1Name}에게 2점`}>
                {team2Name} 경기 중 말하기<br/>
                <span className="text-xs opacity-75">1회 경고 → 2회 +2점</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button className="btn btn-danger flex-1" onClick={handleUndo} disabled={history.length === 0} aria-label="마지막 점수 취소">↩️ 취소</button>
        </div>

        {/* 타임아웃 (3종류) */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">⏱️ 타임아웃</h3>
          <div className="space-y-2">
            {/* 선수 타임아웃 (1분, 1회) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn btn-secondary text-sm py-3"
                onClick={() => handleTimeout(1, 'player')}
                disabled={t1TimeoutsUsed >= 1 || !!match.activeTimeout}
                aria-label={`${team1Name} 선수 타임아웃 (1분), 남은 횟수 ${1 - t1TimeoutsUsed}회`}
              >
                ⏱️ {team1Name} 선수 타임아웃
                <span className="block text-xs opacity-75">1분 | 남은 횟수: {1 - t1TimeoutsUsed}</span>
              </button>
              <button
                className="btn btn-secondary text-sm py-3"
                onClick={() => handleTimeout(2, 'player')}
                disabled={t2TimeoutsUsed >= 1 || !!match.activeTimeout}
                aria-label={`${team2Name} 선수 타임아웃 (1분), 남은 횟수 ${1 - t2TimeoutsUsed}회`}
              >
                ⏱️ {team2Name} 선수 타임아웃
                <span className="block text-xs opacity-75">1분 | 남은 횟수: {1 - t2TimeoutsUsed}</span>
              </button>
            </div>
            {/* 메디컬 타임아웃 (5분, 1회) */}
            {(() => {
              const med1Used = (match.scoreHistory || []).filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team1Name).length;
              const med2Used = (match.scoreHistory || []).filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team2Name).length;
              return (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-3"
                    onClick={() => handleTimeout(1, 'medical')}
                    disabled={!!match.activeTimeout || med1Used >= 1}
                    aria-label={`${team1Name} 메디컬 타임아웃 (5분)`}
                  >
                    🏥 {team1Name} 메디컬
                    <span className="block text-xs opacity-75">{med1Used >= 1 ? '사용완료' : '5분 | 1회'}</span>
                  </button>
                  <button
                    className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-3"
                    onClick={() => handleTimeout(2, 'medical')}
                    disabled={!!match.activeTimeout || med2Used >= 1}
                    aria-label={`${team2Name} 메디컬 타임아웃 (5분)`}
                  >
                    🏥 {team2Name} 메디컬
                    <span className="block text-xs opacity-75">{med2Used >= 1 ? '사용완료' : '5분 | 1회'}</span>
                  </button>
                </div>
              );
            })()}
            {/* 레프리 타임아웃 (제한없음) */}
            <button
              className="btn bg-yellow-800 hover:bg-yellow-700 text-white text-sm py-3 w-full"
              onClick={() => handleTimeout(1, 'referee')}
              disabled={!!match.activeTimeout}
              aria-label="레프리 타임아웃 (제한없음)"
            >
              🟨 레프리 타임아웃
              <span className="block text-xs opacity-75">제한없음 (수동 종료)</span>
            </button>
          </div>
        </div>

        {/* Substitution (선수 교체) */}
        {(hasReserves(1) || hasReserves(2)) && (
          <div className="flex gap-3">
            {hasReserves(1) && (
              <button
                className="btn flex-1 bg-indigo-700 hover:bg-indigo-600 text-white text-sm py-3"
                disabled={!!match.team1SubUsed}
                onClick={() => openSubstitution(1)}
                aria-label={`${team1Name} 선수 교체. ${match.team1SubUsed ? '이미 교체 완료' : '1회 가능'}`}
              >
                🔄 {team1Name} 선수 교체
                <span className="block text-xs opacity-75">
                  {match.team1SubUsed ? '교체 완료' : '1회 가능'}
                </span>
              </button>
            )}
            {hasReserves(2) && (
              <button
                className="btn flex-1 bg-indigo-700 hover:bg-indigo-600 text-white text-sm py-3"
                disabled={!!match.team2SubUsed}
                onClick={() => openSubstitution(2)}
                aria-label={`${team2Name} 선수 교체. ${match.team2SubUsed ? '이미 교체 완료' : '1회 가능'}`}
              >
                🔄 {team2Name} 선수 교체
                <span className="block text-xs opacity-75">
                  {match.team2SubUsed ? '교체 완료' : '1회 가능'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Dead Ball - 양쪽 모두 가능 */}
        <div className="flex gap-3">
          <button
            className="btn flex-1 bg-purple-700 hover:bg-purple-600 text-white"
            disabled={scoringDisabled || match.status !== 'in_progress'}
            onClick={() => handleDeadBall(1)}
            aria-label={`${team1Name} 데드볼. 현재 서브를 무효로 하고 재서브`}
          >
            🔵 {team1Name} 데드볼
          </button>
          <button
            className="btn flex-1 bg-purple-700 hover:bg-purple-600 text-white"
            disabled={scoringDisabled || match.status !== 'in_progress'}
            onClick={() => handleDeadBall(2)}
            aria-label={`${team2Name} 데드볼. 현재 서브를 무효로 하고 재서브`}
          >
            🔵 {team2Name} 데드볼
          </button>
        </div>

        {/* Warmup + Pause */}
        <div className="flex gap-3">
          {!match.warmupUsed && (
            <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white" onClick={handleWarmup} aria-label="워밍업 90초 시작">
              🔥 워밍업 90초
            </button>
          )}
          {!isPausedLocal && (
            <button className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white" onClick={handlePause} aria-label="경기 일시정지">
              ⏸️ 일시정지
            </button>
          )}
        </div>

        {/* Walkover (부전승) */}
        <div className="border-t border-gray-700 pt-3 mt-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2">부전승 처리</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
              onClick={() => handleWalkover(1)}
              disabled={match.status !== 'in_progress' && match.status !== 'pending'}
              aria-label={`${team1Name} 부전승 처리`}
            >
              {team1Name} 부전승
            </button>
            <button
              className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
              onClick={() => handleWalkover(2)}
              disabled={match.status !== 'in_progress' && match.status !== 'pending'}
              aria-label={`${team2Name} 부전승 처리`}
            >
              {team2Name} 부전승
            </button>
          </div>
        </div>

        {/* History (set-grouped) */}
        <div>
          <button className="text-sm text-gray-400 underline mb-2" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} aria-label={showHistory ? '경기 기록 닫기' : `경기 기록 열기, ${history.length}건`} style={{ minHeight: '44px' }}>
            {showHistory ? '▲ 경기 기록 닫기' : `▼ 경기 기록 (${history.length})`}
          </button>
          {showHistory && history.length > 0 && (
            <div className="max-h-96 overflow-y-auto">
              <SetGroupedHistory history={history} sets={sets} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
