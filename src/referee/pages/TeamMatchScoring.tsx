import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { speak } from '@shared/utils/locale';
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
import { formatTime } from '@shared/utils/locale';
import { useCountdownTimer } from '../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../hooks/useDoubleClickGuard';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { useWhistle } from '@shared/hooks/useWhistle';
import { autoBackupDebounced, autoBackupToLocal } from '@shared/utils/backup';
import TimerModal from '../components/TimerModal';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import ActionToast from '../components/ActionToast';

const DEFAULT_TEAM_CONFIG = {
  SETS_TO_WIN: 1,
  MAX_SETS: 1,
  POINTS_TO_WIN: 31,
  MIN_POINT_DIFF: 2,
} as const;

export default function TeamMatchScoring() {
  const { t } = useTranslation();
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);
  const gameConfig = tournament
    ? getEffectiveGameConfig(tournament.scoringRules || tournament.gameConfig)
    : DEFAULT_TEAM_CONFIG;
  const { canAct, startProcessing, done } = useDoubleClickGuard();
  const { shortWhistle, longWhistle, goalWhistle } = useWhistle();
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
  // Substitution ({t('common.matchHistory.substitution')})
  const [showSubstitution, setShowSubstitution] = useState(false);
  const [subTeam, setSubTeam] = useState<1 | 2 | null>(null);
  const [subOutIndex, setSubOutIndex] = useState<number | null>(null);
  const [subInIndex, setSubInIndex] = useState<number | null>(null);

  // Team order (출전 순서)
  const [team1Order, setTeam1Order] = useState<{ ids: string[]; names: string[] }>({ ids: [], names: [] });
  const [team2Order, setTeam2Order] = useState<{ ids: string[]; names: string[] }>({ ids: [], names: [] });

  // Coin toss flow
  const [coinTossStep, setCoinTossStep] = useState<'team_order' | 'toss' | 'choice' | 'court_change' | 'warmup_ask'>('team_order');
  const [tossWinner, setTossWinner] = useState<'team1' | 'team2' | null>(null);
  const [courtChangeByLoser, setCourtChangeByLoser] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<'serve' | 'receive' | null>(null);

  // Initialize team order from match data
  useEffect(() => {
    if (match?.status === 'pending') {
      const t1 = match.team1;
      const t2 = match.team2;
      const teamSize = tournament?.teamRules?.teamSize ?? 3;
      if (t1?.memberIds && team1Order.ids.length === 0) {
        setTeam1Order({ ids: t1.memberIds.slice(0, teamSize), names: (t1.memberNames ?? []).slice(0, teamSize) });
      }
      if (t2?.memberIds && team2Order.ids.length === 0) {
        setTeam2Order({ ids: t2.memberIds.slice(0, teamSize), names: (t2.memberNames ?? []).slice(0, teamSize) });
      }
    }
  }, [match?.status, match?.team1?.memberIds, match?.team2?.memberIds, tournament?.teamRules?.teamSize]);

  // Timers
  const sideChangeTimer = useCountdownTimer(() => setShowSideChange(false));
  const warmupTimer = useCountdownTimer(() => setShowWarmup(false));
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
  });

  // Navigation guard
  useNavigationGuard(match?.status === 'in_progress');

  // 팀전 워밍업 30초마다 알림 (90초: 60초/30초 경과 시 교대 안내)
  useEffect(() => {
    if (warmupTimer.isRunning) {
      if (warmupTimer.seconds === 60) {
        setLastAction(`⚠️ 30${t('common.time.seconds')}`);
        setAnnouncement(`30${t('common.time.seconds')}`);
        speak(`30${t('common.time.seconds')}`);
      }
      if (warmupTimer.seconds === 30) {
        setLastAction(`⚠️ 30${t('common.time.seconds')}`);
        setAnnouncement(`30${t('common.time.seconds')}`);
        speak(`30${t('common.time.seconds')}`);
      }
    }
  }, [warmupTimer.seconds, warmupTimer.isRunning]);

  // 타임아웃 15초 알림
  useEffect(() => {
    if (timeoutTimer.seconds === 15 && timeoutTimer.isRunning) {
      setLastAction(`⚠️ ${t('referee.scoring.fifteenSecondsLeft')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [timeoutTimer.seconds, timeoutTimer.isRunning]);

  // 15초 안내 (사이드 체인지)
  useEffect(() => {
    if (sideChangeTimer.seconds === 15 && sideChangeTimer.isRunning) {
      setLastAction(`⚠️ ${t('referee.scoring.sideChangeFifteenSeconds')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [sideChangeTimer.seconds, sideChangeTimer.isRunning]);

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

  // Save/clear active match in localStorage for session recovery
  useEffect(() => {
    if (match?.status === 'in_progress') {
      localStorage.setItem('showdown_active_match', JSON.stringify({ tournamentId, matchId }));
    }
    if (match?.status === 'completed') {
      localStorage.removeItem('showdown_active_match');
    }
  }, [match?.status, tournamentId, matchId]);

  const team1Name = match?.team1Name ?? t('referee.home.team1Default');
  const team2Name = match?.team2Name ?? t('referee.home.team2Default');

  const handleStartMatch = useCallback(async (tossWinnerVal: 'team1' | 'team2', choice: 'serve' | 'receive') => {
    if (!match) return;

    // Determine who serves first
    const firstServe = choice === 'serve'
      ? (tossWinnerVal === 'team1' ? 'player1' : 'player2')  // Winner serves
      : (tossWinnerVal === 'team1' ? 'player2' : 'player1'); // Winner receives = opponent serves

    const t1n = match.team1Name ?? t('referee.home.team1Default');
    const t2n = match.team2Name ?? t('referee.home.team2Default');
    const servingTeamName = firstServe === 'player1' ? t1n : t2n;
    const tossWinnerName = tossWinnerVal === 'team1' ? t1n : t2n;

    // Build initial history entries
    const now = new Date();
    const timeStr = formatTime(now);
    const initialHistory: ScoreHistoryEntry[] = [
      {
        time: timeStr,
        scoringPlayer: tossWinnerName,
        actionPlayer: tossWinnerName,
        actionType: 'coin_toss' as ScoreActionType,
        actionLabel: (() => {
          const loserN = tossWinnerVal === 'team1' ? t2n : t1n;
          const courtLabel = t('referee.scoring.coinTossLoserCourtChange', {
            loser: loserN,
            decision: courtChangeByLoser ? t('referee.scoring.courtChangeYes') : t('referee.scoring.courtChangeNo'),
          });
          return `${t('referee.scoring.coinTossWinner', { winner: tossWinnerName, choice: choice === 'serve' ? t('referee.scoring.serveChoice') : t('referee.scoring.receiveChoice') })} / ${courtLabel}`;
        })(),
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
        actionLabel: t('referee.scoring.firstServe', { name: servingTeamName }),
        points: 0,
        set: 1,
        server: servingTeamName,
        serveNumber: 1,
        scoreBefore: { player1: 0, player2: 0 },
        scoreAfter: { player1: 0, player2: 0 },
        serverSide: firstServe,
      },
    ];

    // Set player order from custom order (set in team_order step)
    const t1 = match.team1;
    const t2 = match.team2;
    const t1Order = team1Order.ids.length > 0 ? team1Order.ids : (t1?.memberIds || []);
    const t2Order = team2Order.ids.length > 0 ? team2Order.ids : (t2?.memberIds || []);

    // 실제 시작 시간으로 스케줄 자동 업데이트
    const startNow = new Date();
    const actualTime = `${String(startNow.getHours()).padStart(2, '0')}:${String(startNow.getMinutes()).padStart(2, '0')}`;

    const ok = await updateMatch({
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
      courtChangeByLoser,
      team1PlayerOrder: t1Order,
      team2PlayerOrder: t2Order,
      team1CurrentPlayerIndex: 0,
      team2CurrentPlayerIndex: 0,
      actualStartTime: actualTime,
    });
    if (!ok) {
      throw new Error(t('referee.scoring.conflictError'));
    }
    longWhistle(); // match start whistle
  }, [match, updateMatch, courtChangeByLoser, t, longWhistle]);

  // Warmup (team: 90 seconds)
  const handleWarmup = useCallback(() => {
    if (!match || match.warmupUsed) return;
    const timeStr = formatTime();
    const warmupEntry: ScoreHistoryEntry = {
      time: timeStr,
      scoringPlayer: '',
      actionPlayer: '',
      actionType: 'warmup_start' as ScoreActionType,
      actionLabel: `${t('referee.scoring.warmupStart')} (90${t('common.time.seconds')})`,
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
    longWhistle(); // warmup start whistle
  }, [match, updateMatch, warmupTimer, longWhistle]);

  // Pause (GAP-5: pauseHistory)
  const handlePause = useCallback(async () => {
    if (!match || match.status !== 'in_progress' || isPausedLocal) return;
    const reason = prompt(t('referee.scoring.pausePrompt'));
    if (reason === null) return;
    const reasonText = reason || t('referee.scoring.noReason');
    setIsPausedLocal(true);
    setPauseReason(reasonText);
    setPauseElapsed(0);
    const prevHistory = match.pauseHistory ?? [];
    const newEntry = {
      time: formatTime(),
      reason: reasonText,
      set: (match.currentSet ?? 0) + 1,
    };
    const currentSetData = match.sets?.[0];
    const pauseHistoryEntry: ScoreHistoryEntry = {
      time: formatTime(),
      set: (match.currentSet ?? 0) + 1,
      scoringPlayer: '',
      actionPlayer: reasonText,
      actionType: 'pause' as ScoreActionType,
      actionLabel: t('common.matchHistory.pause', { player: '' }),
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
      time: formatTime(),
      set: (match.currentSet ?? 0) + 1,
      scoringPlayer: '',
      actionPlayer: `${Math.floor(pauseElapsed / 60)}${t('common.time.minutes')} ${pauseElapsed % 60}${t('common.time.seconds')}`,
      actionType: 'resume' as ScoreActionType,
      actionLabel: '',
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
    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
    const winnerName = winnerTeam === 1 ? t1Name : t2Name;
    const loserName = winnerTeam === 1 ? t2Name : t1Name;

    if (!window.confirm(`${loserName} → ${winnerName} ${t('common.scoreActions.walkover')}?`)) return;

    const reason = prompt(t('common.scoreActions.walkover')) || t('common.scoreActions.walkover');

    const winnerId = winnerTeam === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: winnerName,
      actionPlayer: loserName,
      actionType: 'walkover',
      actionLabel: `${t('common.scoreActions.walkover')} (${reason})`,
      points: 0,
      set: (match.currentSet ?? 0) + 1,
      server: (match.currentServe ?? 'player1') === 'player1' ? t1Name : t2Name,
      serveNumber: (match.serveCount ?? 0) + 1,
      scoreBefore: { player1: match.sets?.[0]?.player1Score ?? 0, player2: match.sets?.[0]?.player2Score ?? 0 },
      scoreAfter: { player1: match.sets?.[0]?.player1Score ?? 0, player2: match.sets?.[0]?.player2Score ?? 0 },
    });

    const prevHistory = match.scoreHistory ?? [];

    // 부전승 세트 점수: 팀전은 31:0 (setsToWin 만큼 생성)
    const gameConfig = getEffectiveGameConfig(tournament?.gameConfig, 'team');
    const winScore = gameConfig.POINTS_TO_WIN;
    const walkoverSets = Array.from({ length: gameConfig.SETS_TO_WIN }, () => ({
      ...createEmptySet(),
      player1Score: winnerTeam === 1 ? winScore : 0,
      player2Score: winnerTeam === 2 ? winScore : 0,
      winnerId,
    }));

    const updateData: Record<string, unknown> = {
      status: 'completed',
      winnerId,
      walkover: true,
      walkoverReason: reason,
      sets: walkoverSets,
      currentSet: 0,
      scoreHistory: [historyEntry, ...prevHistory],
    };

    const okWo = await updateMatch(updateData);
    if (!okWo) { setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨')); return; }

    setLastAction(`${t('common.scoreActions.walkover')}: ${winnerName} (${reason})`);
    setAnnouncement(`${loserName} ${reason}. ${winnerName} ${t('common.scoreActions.walkover')}`);
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

    startProcessing();
    try {

    const sets = [...match.sets.map(s => ({ ...s }))];
    const cs = { ...sets[0] };

    const scoreBefore = { player1: cs.player1Score, player2: cs.player2Score };
    const scoringTeam = toOpponent ? (actingTeam === 1 ? 2 : 1) : actingTeam;

    if (scoringTeam === 1) cs.player1Score += points;
    else cs.player2Score += points;
    sets[0] = cs;

    const scoreAfter = { player1: cs.player1Score, player2: cs.player2Score };

    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
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

    // Player rotation: 서브를 마친 팀이 {t('common.matchHistory.substitution')} (로테이션)
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
        time: formatTime(),
        scoringPlayer: '',
        actionPlayer: rotTeamName,
        actionType: 'player_rotation' as ScoreActionType,
        actionLabel: `${t('common.matchHistory.playerRotation')} (${rotTeamName})`,
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

    // Whistle: goal (2pt) = goalWhistle, foul/1pt = shortWhistle
    if (actionType === 'goal') goalWhistle();
    else shortWhistle();

    // GAP-1: server-based score order for announce and lastAction (서브권 기준)
    const serverScore = currentServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = currentServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;

    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${tName} +${points}${t('common.units.point')}`
      : `${tName} ${t('common.scoreActions.goal')}! +${points}${t('common.units.point')}`;
    setLastAction(`${actionDesc} | ${t('common.matchHistory.score')} ${serverScore} : ${receiverScore}`);

    setAnnouncement(
      `${tName} ${points}${t('common.units.point')}. ${t('common.matchHistory.score')} ${serverScore} : ${receiverScore}. ${t('referee.scoring.firstServe', { name: nextServerName })}`
    );

    // Winner check
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, gameConfig);
    if (setWinner) {
      const winnerId = setWinner === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
      cs.winnerId = winnerId;
      sets[0] = cs;
      const ok1 = await updateMatch({
        sets, status: 'completed', winnerId,
        currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
        ...rotationUpdate,
      });
      if (!ok1) { setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨')); return; }
      setTimeout(() => longWhistle(), 500); // match end whistle after score sound
      if (tournamentId) autoBackupToLocal(tournamentId);
      return;
    }

    // Side change (16 points)
    if (shouldSideChange('team', cs, match.sideChangeUsed ?? false, sets, gameConfig)) {
      const ok2 = await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
        ...rotationUpdate,
      });
      if (!ok2) { setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨')); return; }
      sideChangeTimer.start(60);
      setShowSideChange(true);
      return;
    }

    const ok3 = await updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
      ...rotationUpdate,
    });
    if (!ok3) { setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨')); return; }
    if (tournamentId) autoBackupDebounced(tournamentId);

    } finally { done(); }
  }, [match, gameConfig, updateMatch, canAct, startProcessing, done, sideChangeTimer, tournamentId, goalWhistle, shortWhistle, longWhistle]);

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
    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
    const serverName = currentServe === 'player1' ? t1Name : t2Name;
    const msg = `${t1Name} ${cs.player1Score}, ${t2Name} ${cs.player2Score}. ${serverName} ${t('common.matchHistory.serve')}`;
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
    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
    const currentServe = match.currentServe ?? 'player1';
    const serveCount = match.serveCount ?? 0;
    const serverTeamName = currentServe === 'player1' ? t1Name : t2Name;
    const actionTeamName = team === 1 ? t1Name : t2Name;
    const scoreBefore = { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 };

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: '',
      actionPlayer: actionTeamName,
      actionType: 'dead_ball',
      actionLabel: t('common.matchHistory.deadBall', { server: actionTeamName }),
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

    shortWhistle(); // dead ball whistle
    setLastAction(t('common.matchHistory.deadBall', { server: actionTeamName }));
    setAnnouncement(t('common.matchHistory.deadBall', { server: actionTeamName }));
  }, [match, updateMatch, shortWhistle]);

  const handleTimeout = useCallback(async (team: 1 | 2, type: 'player' | 'medical' | 'referee' = 'player') => {
    if (!match || match.status !== 'in_progress') return;
    // player timeout: 1회 제한
    if (type === 'player') {
      const usedTimeouts = team === 1 ? (match.player1Timeouts ?? 0) : (match.player2Timeouts ?? 0);
      if (usedTimeouts >= 1) return;
    }
    // medical timeout: 1회 제한
    if (type === 'medical') {
      const tName = team === 1 ? (match.team1Name ?? t('referee.home.team1Default')) : (match.team2Name ?? t('referee.home.team2Default'));
      const medUsed = (match.scoreHistory || []).filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === tName).length;
      if (medUsed >= 1) return;
    }
    const teamId = team === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
    const tName = team === 1 ? (match.team1Name ?? t('referee.home.team1Default')) : (match.team2Name ?? t('referee.home.team2Default'));
    const currentSetData = match.sets?.[0];
    const actionType = type === 'player' ? 'timeout_player' : type === 'medical' ? 'timeout_medical' : 'timeout_referee';
    const actionLabel = type === 'player' ? t('referee.scoring.timeoutTitle.player') : type === 'medical' ? t('referee.scoring.timeoutTitle.medical') : t('referee.scoring.timeoutTitle.referee');
    const timeoutEntry: ScoreHistoryEntry = {
      time: formatTime(),
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
    longWhistle(); // timeout start whistle
  }, [match, updateMatch, timeoutTimer, longWhistle]);

  // 벌점 핸들러: 경고 카운트를 scoreHistory에서 동적 계산
  const handlePenalty = useCallback(async (
    actingTeam: 1 | 2,
    penaltyType: 'penalty_table_pushing' | 'penalty_electronic' | 'penalty_talking',
  ) => {
    if (!canAct()) return;
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout) return;

    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
    const actorName = actingTeam === 1 ? t1Name : t2Name;

    // penalty_electronic은 즉시 2점
    if (penaltyType === 'penalty_electronic') {
      const label = `${actorName} ${t('common.scoreActions.penaltyElectronic')}`;
      handleIBSAScore(actingTeam, penaltyType, 2, true, label);
      return;
    }

    // penalty_table_pushing, penalty_talking: 경고 → 실점 → 경고 → 실점 (반복 사이클)
    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    const totalPenaltyCount = prevHistory.filter(
      h => h.actionType === penaltyType && h.actionPlayer === actorName
    ).length;

    if (totalPenaltyCount % 2 === 0) {
      // 첫 번째: 경고만
      startProcessing();
      try {
      const currentSetData = match.sets?.[0];
      const scoreBefore = { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 };
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? t('common.scoreActions.penaltyTablePushing') : t('common.scoreActions.penaltyTalking');
      const warningEntry: ScoreHistoryEntry = {
        time: formatTime(),
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
      shortWhistle(); // warning whistle
      setLastAction(`⚠️ ${t('common.matchHistory.warning', { player: actorName, action: penaltyLabel })}`);
      setAnnouncement(t('common.matchHistory.warning', { player: actorName, action: penaltyLabel }));
      } finally { done(); }
    } else {
      // 2회 이상: 실점 (penalty_talking: 1점, penalty_table_pushing: 2점)
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? t('common.scoreActions.penaltyTablePushing') : t('common.scoreActions.penaltyTalking');
      const penaltyPoints = penaltyType === 'penalty_talking' ? 1 : 2;
      const label = `${actorName} ${penaltyLabel}`;
      handleIBSAScore(actingTeam, penaltyType, penaltyPoints, true, label);
    }
  }, [match, canAct, startProcessing, done, handleIBSAScore, updateMatch, shortWhistle]);

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

    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
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
      actionLabel: `${t('common.matchHistory.substitution')}: ${outName} → ${inName}`,
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
    setLastAction(`🔄 ${teamLabel} ${t('common.matchHistory.substitution')}: ${outName} → ${inName}`);
    setAnnouncement(`${teamLabel} ${t('common.matchHistory.substitution')}. ${outName} → ${inName}`);
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
      if (e.code === 'ArrowLeft') { e.preventDefault(); handleIBSAScore(1, 'goal', 2, false, `${team1Name} ${t('common.scoreActions.goal')}`); }
      if (e.code === 'ArrowRight') { e.preventDefault(); handleIBSAScore(2, 'goal', 2, false, `${team2Name} ${t('common.scoreActions.goal')}`); }
      if (e.code === 'KeyZ') { e.preventDefault(); handleUndo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [match?.status, handleIBSAScore, handleUndo, team1Name, team2Name]);

  if (matchLoading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-2xl text-gray-400 animate-pulse">{t('common.loading')}</p></div>;
  }

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-2xl text-red-400">{t('spectator.liveMatch.notFound')}</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    );
  }

  // ===== PENDING =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('referee.home.teamMatch')} {t('referee.scoring.matchStartLabel')}</h1>
        <div className="flex items-center gap-8 text-2xl">
          <div className="text-center">
            <span className="text-yellow-400 font-bold">{team1Name}</span>
            {match.team1?.coachName && <div className="text-sm text-gray-400">{match.team1.coachName}</div>}
          </div>
          <span className="text-gray-400">vs</span>
          <div className="text-center">
            <span className="text-cyan-400 font-bold">{team2Name}</span>
            {match.team2?.coachName && <div className="text-sm text-gray-400">{match.team2.coachName}</div>}
          </div>
        </div>
        <p className="text-lg text-gray-400">{t('referee.practice.setup.teamRuleSummary')}</p>
        {match.courtName && <p className="text-gray-400">{t('referee.home.court')}: {match.courtName}</p>}

        {coinTossStep === 'team_order' && (() => {
          const swapOrder = (setter: typeof setTeam1Order, order: { ids: string[]; names: string[] }, i: number, dir: -1 | 1) => {
            const j = i + dir;
            if (j < 0 || j >= order.ids.length) return;
            const newIds = [...order.ids];
            const newNames = [...order.names];
            [newIds[i], newIds[j]] = [newIds[j], newIds[i]];
            [newNames[i], newNames[j]] = [newNames[j], newNames[i]];
            setter({ ids: newIds, names: newNames });
          };
          const renderOrder = (label: string, order: { ids: string[]; names: string[] }, setter: typeof setTeam1Order, color: string) => (
            <div>
              <h3 className={`text-sm font-bold ${color} mb-2`}>{label}</h3>
              <div className="space-y-1">
                {order.names.map((name, i) => (
                  <div key={order.ids[i] ?? i} className="flex items-center gap-2 bg-gray-700 rounded px-3 py-2">
                    <span className="text-gray-400 text-sm w-6">{i + 1}</span>
                    <span className="flex-1 text-white">{name}</span>
                    <button className="text-gray-400 hover:text-white px-1" disabled={i === 0} onClick={() => swapOrder(setter, order, i, -1)} style={{ minHeight: '36px', minWidth: '36px' }}>▲</button>
                    <button className="text-gray-400 hover:text-white px-1" disabled={i === order.names.length - 1} onClick={() => swapOrder(setter, order, i, 1)} style={{ minHeight: '36px', minWidth: '36px' }}>▼</button>
                  </div>
                ))}
              </div>
            </div>
          );
          return (
            <div className="card w-full max-w-md space-y-4">
              <h2 className="text-xl font-bold text-center">{t('referee.scoring.teamOrderTitle')}</h2>
              <p className="text-sm text-gray-400 text-center">{t('referee.practice.setup.memberInfo', { reserve: '' })}</p>
              {renderOrder(team1Name, team1Order, setTeam1Order, 'text-yellow-400')}
              {renderOrder(team2Name, team2Order, setTeam2Order, 'text-cyan-400')}
              <button
                className="btn btn-primary btn-large w-full"
                onClick={() => setCoinTossStep('toss')}
              >
                {t('referee.scoring.teamOrderConfirm')}
              </button>
            </div>
          );
        })()}
        {coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.coinToss')}</h2>
            <div className="flex gap-4">
              <button className="btn btn-primary btn-large flex-1" onClick={() => { setTossWinner('team1'); setCoinTossStep('choice'); }}>
                {team1Name}
              </button>
              <button className="btn btn-primary btn-large flex-1" onClick={() => { setTossWinner('team2'); setCoinTossStep('choice'); }}>
                {team2Name}
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => setCoinTossStep('team_order')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        )}
        {coinTossStep === 'choice' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">
              {tossWinner === 'team1' ? team1Name : team2Name}!
            </h2>
            <p className="text-gray-400 text-center">{t('referee.scoring.serveChoice')} / {t('referee.scoring.receiveChoice')}</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1" onClick={() => { setPendingChoice('serve'); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'team1' ? team1Name : team2Name} ${t('referee.scoring.serveChoice')}`}>
                {t('referee.scoring.serveChoice')}
              </button>
              <button className="btn btn-accent btn-large flex-1" onClick={() => { setPendingChoice('receive'); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'team1' ? team1Name : team2Name} ${t('referee.scoring.receiveChoice')}`}>
                {t('referee.scoring.receiveChoice')}
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        )}
        {coinTossStep === 'court_change' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.courtChangeTitle')}</h2>
            <p className="text-gray-400 text-center" aria-live="polite">
              {t('referee.scoring.courtChangeQuestion', { loser: tossWinner === 'team1' ? team2Name : team1Name })}
            </p>
            <div className="flex gap-4" role="group" aria-label={t('referee.scoring.courtChangeAriaLabel')}>
              <button
                className="btn btn-primary btn-large flex-1 text-xl py-6"
                onClick={() => { setCourtChangeByLoser(true); setCoinTossStep('warmup_ask'); }}
                aria-label={`${tossWinner === 'team1' ? team2Name : team1Name}: ${t('referee.scoring.courtChangeYesButton')}`}
              >
                {t('referee.scoring.courtChangeYesButton')}
              </button>
              <button
                className="btn bg-gray-700 text-white btn-large flex-1 text-xl py-6"
                onClick={() => { setCourtChangeByLoser(false); setCoinTossStep('warmup_ask'); }}
                aria-label={`${tossWinner === 'team1' ? team2Name : team1Name}: ${t('referee.scoring.courtChangeNoButton')}`}
              >
                {t('referee.scoring.courtChangeNoButton')}
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => setCoinTossStep('choice')} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        )}
        {coinTossStep === 'warmup_ask' && tossWinner && pendingChoice && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.warmupStart')}</h2>
            <p className="text-gray-400 text-center">{t('referee.scoring.warmupStart')} (90{t('common.time.seconds')})?</p>
            <div className="flex gap-4">
              <button
                className="btn btn-success btn-large flex-1 text-xl py-6"
                onClick={async () => {
                  try {
                    await handleStartMatch(tossWinner!, pendingChoice!);
                  } catch (err) {
                    alert(String(err));
                    return;
                  }
                  await updateMatch({ warmupUsed: true });
                  warmupTimer.start(90);
                  setShowWarmup(true);
                }}
                aria-label={t('referee.scoring.warmupStart')}
              >
                {t('referee.scoring.warmupStart')}
              </button>
              <button
                className="btn btn-accent btn-large flex-1 text-xl py-6"
                onClick={async () => {
                  try {
                    await handleStartMatch(tossWinner!, pendingChoice!);
                  } catch (err) {
                    alert(String(err));
                  }
                }}
                aria-label={t('referee.scoring.matchStartLabel')}
              >
                {t('referee.scoring.matchStartLabel')}
              </button>
            </div>
          </div>
        )}
        <div className="card w-full max-w-md space-y-4">
          <div className="border-t border-gray-700 pt-3">
            <h3 className="text-sm font-bold text-gray-400 mb-2">{t('common.scoreActions.walkover')}</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
                onClick={() => handleWalkover(1)}
              >
                {team1Name} {t('common.scoreActions.walkover')}
              </button>
              <button
                className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
                onClick={() => handleWalkover(2)}
              >
                {team2Name} {t('common.scoreActions.walkover')}
              </button>
            </div>
          </div>
        </div>

        <button className="btn btn-accent" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    );
  }

  // ===== COMPLETED (GAP-14: showAll) =====
  if (match.status === 'completed') {
    const isT2Winner = match.winnerId === match.team2Id;
    const winnerName = isT2Winner ? team2Name : team1Name;
    const loserName = isT2Winner ? team1Name : team2Name;
    const finalSet = match.sets?.[0];
    const winScore = finalSet ? (isT2Winner ? finalSet.player2Score : finalSet.player1Score) : 0;
    const loseScore = finalSet ? (isT2Winner ? finalSet.player1Score : finalSet.player2Score) : 0;
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    return (
      <div className="min-h-screen flex flex-col p-4">
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-yellow-400">{t('common.matchStatus.completed')}</h1>
          <div className="text-4xl font-bold text-green-400 mt-2" role="status" aria-live="assertive">🏆 {winnerName}!</div>
          {finalSet && (
            <div className="mt-2">
              <div className="inline-flex items-center bg-gray-800 rounded-lg px-6 py-3 gap-4" aria-label={`${t('common.matchHistory.score')} ${winnerName} ${winScore} : ${loserName} ${loseScore}`}>
                <span className="text-lg text-gray-300">{winnerName}</span>
                <span className="text-3xl font-bold">
                  <span className="text-green-400">{winScore}</span>
                  <span className="text-gray-400"> - </span>
                  <span className="text-gray-300">{loseScore}</span>
                </span>
                <span className="text-lg text-gray-300">{loserName}</span>
              </div>
            </div>
          )}
        </div>
        {/* 상세 경기 기록 */}
        {history.length > 0 && (
          <div className="w-full max-w-lg mx-auto flex-1 flex flex-col min-h-0">
            <h3 className="text-lg font-bold text-gray-300 mb-2">{t('common.matchHistory.titleWithCount', { count: history.length })}</h3>
            <div className="flex-1 min-h-0">
              <ScoreHistoryView history={history} sets={match.sets ?? []} />
            </div>
          </div>
        )}
        <div className="text-center mt-4">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
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
          title={`🔥 ${t('referee.scoring.warmupStart')}`}
          seconds={warmupTimer.seconds}
          isWarning={warmupTimer.isWarning}
          subtitle={`${t('referee.home.teamMatch')} ${t('referee.scoring.warmupStart')} (90${t('common.time.seconds')})`}
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); longWhistle(); }}
          closeLabel={t('common.done')}
        />
      )}

      {/* Side Change Timer */}
      {showSideChange && (
        <TimerModal
          title={`${t('common.matchHistory.sideChange')}! (16${t('common.units.point')})`}
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle={`1${t('common.time.minutes')}`}
          onClose={() => { sideChangeTimer.stop(); setShowSideChange(false); }}
          closeLabel={t('common.confirm')}
          required
        />
      )}

      {/* Timeout Modal */}
      {match.activeTimeout && (timeoutTimer.isRunning || match.activeTimeout.type === 'referee') && (
        <TimerModal
          title={match.activeTimeout.type === 'medical' ? `🏥 ${t('referee.scoring.timeoutTitle.medical')}` : match.activeTimeout.type === 'referee' ? `🟨 ${t('referee.scoring.timeoutTitle.referee')}` : `⏱️ ${t('referee.scoring.timeoutTitle.player')}`}
          seconds={timeoutTimer.seconds}
          isWarning={timeoutTimer.isWarning}
          subtitle={match.activeTimeout.type === 'referee' ? '' : (match.activeTimeout.playerId === match.team1Id ? team1Name : team2Name)}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); longWhistle(); }}
          closeLabel={t('referee.scoring.timeoutEnd')}
        />
      )}

      {/* Substitution Modal ({t('common.matchHistory.substitution')}) */}
      {showSubstitution && subTeam !== null && (() => {
        const active = getTeamActivePlayers(subTeam);
        const reserves = getTeamReservePlayers(subTeam);
        const subTeamName = subTeam === 1 ? team1Name : team2Name;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onKeyDown={e => { if (e.key === 'Escape') { setShowSubstitution(false); setSubTeam(null); } }}>
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4" role="dialog" aria-modal="true" aria-label={`${subTeamName} ${t('common.matchHistory.substitution')}`}>
              <h2 className="text-xl font-bold text-indigo-300 text-center">
                🔄 {subTeamName} {t('common.matchHistory.substitution')}
              </h2>

              {/* Select player to remove */}
              <div>
                <h3 className="text-sm font-bold text-gray-400 mb-2">{t('common.matchHistory.substitution')}</h3>
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
                      aria-label={`${name}${subOutIndex === i ? ` (${t('common.accessibility.selected')})` : ''}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Select reserve to bring in */}
              <div>
                <h3 className="text-sm font-bold text-gray-400 mb-2">{t('common.matchHistory.substitution')}</h3>
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
                      aria-label={`${name}${subInIndex === i ? ` (${t('common.accessibility.selected')})` : ''}`}
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
                  {t('common.cancel')}
                </button>
                <button
                  className="btn flex-1 bg-indigo-600 hover:bg-indigo-500 text-white"
                  disabled={subOutIndex === null || subInIndex === null}
                  onClick={handleSubstitution}
                >
                  {t('common.confirm')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pause Banner */}
      {isPausedLocal && (
        <div className="bg-orange-900/80 px-4 py-3 flex items-center justify-between" role="status" aria-live="polite" aria-label={t('common.matchHistory.pause', { player: '' })}>
          <div>
            <span className="text-orange-300 font-bold">⏸️ {t('common.matchHistory.pause', { player: '' })}</span>
            <span className="text-orange-200 ml-3" aria-label={`${t('referee.scoring.elapsedTime')} ${Math.floor(pauseElapsed / 60)}${t('common.time.minutes')} ${pauseElapsed % 60}${t('common.time.seconds')}`}>
              {Math.floor(pauseElapsed / 60)}:{(pauseElapsed % 60).toString().padStart(2, '0')}
            </span>
            {pauseReason && <span className="text-orange-200/70 ml-3 text-sm">({pauseReason})</span>}
          </div>
          <button className="btn btn-success text-sm px-4 py-1" onClick={handleResume} aria-label={t('common.confirm')}>▶</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/games')} aria-label={t('referee.home.title')}>← {t('referee.home.title')}</button>
          <div className="text-center">
            <h1 className="text-lg font-bold text-yellow-400">{t('referee.home.teamMatch')}</h1>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{t('referee.home.mainReferee')}: {match.refereeName}</div>}
            {match.assistantRefereeName && <div>{t('referee.home.assistantReferee')}: {match.assistantRefereeName}</div>}
          </div>
        </div>
      </div>

      {/* Serve */}
      <div className="bg-blue-900/50 px-4 py-2 text-center" role="status" aria-label={`${serverName} ${t('common.matchHistory.serve')} ${serveCountVal + 1}/${maxServes}`}>
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} {t('common.matchHistory.serve')} {serveCountVal + 1}/{maxServes}
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label={t('common.matchHistory.serve')} style={{ minHeight: '44px', minWidth: '44px' }}>{t('common.matchHistory.serve')}</button>
      </div>

      {/* Score display - server on left */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-4 px-2 border-r border-gray-700">
          <h2 className={`text-xl font-bold ${leftColor}`}>🎾 {leftName}</h2>
          <div key={`left-${scoreFlash}`} className={`text-7xl font-bold my-2 ${leftColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${leftName} ${leftScore}${t('common.units.point')}`}>{leftScore}</div>
        </div>
        <div className="flex-1 flex flex-col items-center py-4 px-2">
          <h2 className={`text-xl font-bold ${rightColor}`}>{rightName}</h2>
          <div key={`right-${scoreFlash}`} className={`text-7xl font-bold my-2 ${rightColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${rightName} ${rightScore}${t('common.units.point')}`}>{rightScore}</div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* Scoring area (buttons always team1 left, team2 right) */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">⚽ {t('common.scoreActions.goal')} (+2{t('common.units.point')})</h3>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-success text-lg py-4 font-bold"
              disabled={scoringDisabled}
              onClick={() => handleIBSAScore(1, 'goal', 2, false, `${team1Name} ${t('common.scoreActions.goal')}`)}
              aria-label={`${team1Name} ${t('common.scoreActions.goal')} +2${t('common.units.point')}`}>
              {team1Name}<br/>{t('common.scoreActions.goal')} +2{t('common.units.point')}
            </button>
            <button className="btn btn-success text-lg py-4 font-bold"
              disabled={scoringDisabled}
              onClick={() => handleIBSAScore(2, 'goal', 2, false, `${team2Name} ${t('common.scoreActions.goal')}`)}
              aria-label={`${team2Name} ${t('common.scoreActions.goal')} +2${t('common.units.point')}`}>
              {team2Name}<br/>{t('common.scoreActions.goal')} +2{t('common.units.point')}
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">🟡 +1{t('common.units.point')}</h3>
          <div className="space-y-2">
            {foulActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  disabled={scoringDisabled || (action.type === 'irregular_serve' && currentServe !== 'player1')}
                  onClick={() => handleIBSAScore(1, action.type, action.points, true, `${team1Name} ${action.label}`)}
                  aria-label={`${team1Name} ${action.label}. ${team2Name} +1${t('common.units.point')}`}>
                  {team1Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {team2Name} +1{t('common.units.point')}</span>
                </button>
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                  disabled={scoringDisabled || (action.type === 'irregular_serve' && currentServe !== 'player2')}
                  onClick={() => handleIBSAScore(2, action.type, action.points, true, `${team2Name} ${action.label}`)}
                  aria-label={`${team2Name} ${action.label}. ${team1Name} +1${t('common.units.point')}`}>
                  {team2Name} {action.label}<br/>
                  <span className="text-xs opacity-75">→ {team1Name} +1{t('common.units.point')}</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-red-400 mb-2">🔴 {t('common.scoreActions.penalty')}</h3>
          <div className="space-y-2">
            {/* penalty_table_pushing: 1회 경고 → 2회 2점 */}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(1, 'penalty_table_pushing')}
                aria-label={t('referee.scoring.penaltyAriaLabel', { name: team1Name, action: t('common.scoreActions.penaltyTablePushing'), opponent: team2Name })}>
                {team1Name} {t('common.scoreActions.penaltyTablePushing')}<br/>
                <span className="text-xs opacity-75">+2{t('common.units.point')}</span>
              </button>
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(2, 'penalty_table_pushing')}
                aria-label={t('referee.scoring.penaltyAriaLabel', { name: team2Name, action: t('common.scoreActions.penaltyTablePushing'), opponent: team1Name })}>
                {team2Name} {t('common.scoreActions.penaltyTablePushing')}<br/>
                <span className="text-xs opacity-75">+2{t('common.units.point')}</span>
              </button>
            </div>
            {/* penalty_electronic: 즉시 2점 */}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(1, 'penalty_electronic')}
                aria-label={`${team1Name} {t('common.scoreActions.penaltyElectronic')}. ${team2Name} +2${t('common.units.point')}`}>
                {team1Name} {t('common.scoreActions.penaltyElectronic')}<br/>
                <span className="text-xs opacity-75">→ {team2Name} +2{t('common.units.point')}</span>
              </button>
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(2, 'penalty_electronic')}
                aria-label={`${team2Name} {t('common.scoreActions.penaltyElectronic')}. ${team1Name} +2${t('common.units.point')}`}>
                {team2Name} {t('common.scoreActions.penaltyElectronic')}<br/>
                <span className="text-xs opacity-75">→ {team1Name} +2{t('common.units.point')}</span>
              </button>
            </div>
            {/* penalty_talking: 1회 경고 → 2회 1점 */}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(1, 'penalty_talking')}
                aria-label={t('referee.scoring.penaltyAriaLabel', { name: team1Name, action: t('common.scoreActions.penaltyTalking'), opponent: team2Name })}>
                {team1Name} {t('common.scoreActions.penaltyTalking')}<br/>
                <span className="text-xs opacity-75">+1{t('common.units.point')}</span>
              </button>
              <button className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3"
                disabled={scoringDisabled}
                onClick={() => handlePenalty(2, 'penalty_talking')}
                aria-label={t('referee.scoring.penaltyAriaLabel', { name: team2Name, action: t('common.scoreActions.penaltyTalking'), opponent: team1Name })}>
                {team2Name} {t('common.scoreActions.penaltyTalking')}<br/>
                <span className="text-xs opacity-75">+1{t('common.units.point')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 선수 타임아웃 (1분, 1회) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn btn-secondary text-sm py-3"
            onClick={() => handleTimeout(1, 'player')}
            disabled={t1TimeoutsUsed >= 1 || !!match.activeTimeout}
            aria-label={t('referee.scoring.timeoutAriaLabel', { name: team1Name, type: t('referee.scoring.timeoutTitle.player'), duration: '1m', remaining: 1 - t1TimeoutsUsed })}
          >
            ⏱️ {team1Name} {t('referee.scoring.timeoutTitle.player')}
            <span className="block text-xs opacity-75">1m | {1 - t1TimeoutsUsed}</span>
          </button>
          <button
            className="btn btn-secondary text-sm py-3"
            onClick={() => handleTimeout(2, 'player')}
            disabled={t2TimeoutsUsed >= 1 || !!match.activeTimeout}
            aria-label={t('referee.scoring.timeoutAriaLabel', { name: team2Name, type: t('referee.scoring.timeoutTitle.player'), duration: '1m', remaining: 1 - t2TimeoutsUsed })}
          >
            ⏱️ {team2Name} {t('referee.scoring.timeoutTitle.player')}
            <span className="block text-xs opacity-75">1m | {1 - t2TimeoutsUsed}</span>
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
                aria-label={t('referee.scoring.timeoutAriaLabel', { name: team1Name, type: t('referee.scoring.timeoutTitle.medical'), duration: '5m', remaining: 1 - med1Used })}
              >
                🏥 {t('referee.scoring.timeoutMedicalLabel', { name: team1Name })}
                <span className="block text-xs opacity-75">{med1Used >= 1 ? '-' : t('referee.scoring.timeoutDurationInfo', { duration: '5m', remaining: 1 })}</span>
              </button>
              <button
                className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-3"
                onClick={() => handleTimeout(2, 'medical')}
                disabled={!!match.activeTimeout || med2Used >= 1}
                aria-label={t('referee.scoring.timeoutAriaLabel', { name: team2Name, type: t('referee.scoring.timeoutTitle.medical'), duration: '5m', remaining: 1 - med2Used })}
              >
                🏥 {t('referee.scoring.timeoutMedicalLabel', { name: team2Name })}
                <span className="block text-xs opacity-75">{med2Used >= 1 ? '-' : t('referee.scoring.timeoutDurationInfo', { duration: '5m', remaining: 1 })}</span>
              </button>
            </div>
          );
        })()}

        {/* 레프리 타임아웃 (제한없음) */}
        <button
          className="btn bg-yellow-800 hover:bg-yellow-700 text-white text-sm py-3 w-full"
          onClick={() => handleTimeout(1, 'referee')}
          disabled={!!match.activeTimeout}
          aria-label={t('referee.scoring.timeoutRefereeAriaLabel')}
        >
          🟨 {t('referee.scoring.timeoutTitle.referee')}
        </button>

        <div className="flex gap-3">
          <button className="btn btn-danger flex-1" onClick={handleUndo} disabled={history.length === 0} aria-label={t('common.cancel')}>↩️ {t('common.cancel')}</button>
        </div>

        {/* Dead Ball - 서브권 기준 단일 버튼 */}
        <button
          className="btn bg-purple-700 hover:bg-purple-600 text-white w-full"
          disabled={scoringDisabled || match.status !== 'in_progress'}
          onClick={() => handleDeadBall(currentServe === 'player1' ? 1 : 2)}
          aria-label={t('common.matchHistory.deadBall', { server: serverName })}
        >
          🔵 {t('common.matchHistory.deadBall', { server: serverName })}
        </button>

        {/* Substitution ({t('common.matchHistory.substitution')}) */}
        {(hasReserves(1) || hasReserves(2)) && (
          <div className="flex gap-3">
            {hasReserves(1) && (
              <button
                className="btn flex-1 bg-indigo-700 hover:bg-indigo-600 text-white text-sm py-3"
                disabled={!!match.team1SubUsed}
                onClick={() => openSubstitution(1)}
                aria-label={`${team1Name} ${t('common.matchHistory.substitution')}. ${match.team1SubUsed ? t('common.done') : '1'}`}
              >
                🔄 {team1Name} {t('common.matchHistory.substitution')}
                <span className="block text-xs opacity-75">
                  {match.team1SubUsed ? t('common.done') : '1'}
                </span>
              </button>
            )}
            {hasReserves(2) && (
              <button
                className="btn flex-1 bg-indigo-700 hover:bg-indigo-600 text-white text-sm py-3"
                disabled={!!match.team2SubUsed}
                onClick={() => openSubstitution(2)}
                aria-label={`${team2Name} ${t('common.matchHistory.substitution')}. ${match.team2SubUsed ? t('common.done') : '1'}`}
              >
                🔄 {team2Name} {t('common.matchHistory.substitution')}
                <span className="block text-xs opacity-75">
                  {match.team2SubUsed ? t('common.done') : '1'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Warmup + Pause */}
        <div className="flex gap-3">
          {!match.warmupUsed && (match.currentSet ?? 0) === 0 && (
            <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white" onClick={handleWarmup} aria-label={`${t('referee.scoring.warmupStart')} 90${t('common.time.seconds')}`}>
              🔥 {t('referee.scoring.warmupStart')} 90{t('common.time.seconds')}
            </button>
          )}
          {!isPausedLocal && (
            <button className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white" onClick={handlePause} aria-label={t('common.matchHistory.pause', { player: '' })}>
              ⏸️ {t('common.matchHistory.pause', { player: '' })}
            </button>
          )}
        </div>

        {/* Walkover (부전승) */}
        <div className="border-t border-gray-700 pt-3 mt-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2">{t('common.scoreActions.walkover')}</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
              onClick={() => handleWalkover(1)}
              disabled={match.status !== 'in_progress' && match.status !== 'pending'}
              aria-label={`${team1Name} ${t('common.scoreActions.walkover')}`}
            >
              {team1Name} {t('common.scoreActions.walkover')}
            </button>
            <button
              className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
              onClick={() => handleWalkover(2)}
              disabled={match.status !== 'in_progress' && match.status !== 'pending'}
              aria-label={`${team2Name} ${t('common.scoreActions.walkover')}`}
            >
              {team2Name} {t('common.scoreActions.walkover')}
            </button>
          </div>
        </div>

        {/* History (set-grouped) */}
        <div>
          <button className="text-sm text-gray-400 underline mb-2" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} aria-label={showHistory ? t('common.matchHistory.title') : t('common.matchHistory.titleWithCount', { count: history.length })} style={{ minHeight: '44px' }}>
            {showHistory ? `▲ ${t('common.matchHistory.title')}` : `▼ ${t('common.matchHistory.titleWithCount', { count: history.length })}`}
          </button>
          {showHistory && history.length > 0 && (
            <div className="w-full">
              <ScoreHistoryView history={history} sets={sets} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
