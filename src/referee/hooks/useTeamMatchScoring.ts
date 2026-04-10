import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { speak, preWarmSpeech, formatTime } from '@shared/utils/locale';
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
  getEffectiveTimeLimitSeconds,
  applyGoldenGoalEvent,
} from '@shared/utils/scoring';
import { useGoldenGoalTimer } from './useGoldenGoalTimer';
import type { ScoreActionType, ScoreHistoryEntry } from '@shared/types';
import { useCountdownTimer, playWarningBeep } from './useCountdownTimer';
import { useDoubleClickGuard } from './useDoubleClickGuard';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { useWhistle } from '@shared/hooks/useWhistle';
import { autoBackupDebounced, autoBackupToLocal } from '@shared/utils/backup';

const DEFAULT_TEAM_CONFIG = {
  SETS_TO_WIN: 1,
  MAX_SETS: 1,
  POINTS_TO_WIN: 31,
  MIN_POINT_DIFF: 2,
} as const;

export function useTeamMatchScoring(
  tournamentId: string | undefined,
  matchId: string | undefined,
) {
  const { t } = useTranslation();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);
  const gameConfig = tournament
    ? getEffectiveGameConfig(tournament.scoringRules || tournament.gameConfig)
    : DEFAULT_TEAM_CONFIG;
  const timeLimitSeconds = match && tournament ? getEffectiveTimeLimitSeconds(match, tournament) : 0;
  const goldenGoal = useGoldenGoalTimer(match?.matchStartedAt, timeLimitSeconds);
  const { canAct, startProcessing, done } = useDoubleClickGuard();
  const { shortWhistle, longWhistle, goalWhistle, initAudio } = useWhistle();
  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);
  const [pendingSideChange, setPendingSideChange] = useState(false);
  const [sideChangeDismissed, setSideChangeDismissed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showWarmup, setShowWarmup] = useState(false);
  const [showSubstitution, setShowSubstitution] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const toggleSection = (key: string) => setExpandedSection(prev => prev === key ? null : key);
  const [foulClassify, setFoulClassify] = useState<{ player: 1 | 2 } | null>(null);
  const [subTeam, setSubTeam] = useState<1 | 2 | null>(null);
  const [subOutIndex, setSubOutIndex] = useState<number | null>(null);
  const [subInIndex, setSubInIndex] = useState<number | null>(null);

  const [team1Order, setTeam1Order] = useState<{ ids: string[]; names: string[] }>({ ids: [], names: [] });
  const [team2Order, setTeam2Order] = useState<{ ids: string[]; names: string[] }>({ ids: [], names: [] });

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

  const showSideChange = !!(match?.sideChangeStartTime) && !sideChangeDismissed;

  const sideChangeTimer = useCountdownTimer(() => {
    if (match) updateMatch({ sideChangeStartTime: null });
    longWhistle();
  });
  const warmupTimer = useCountdownTimer(() => { setShowWarmup(false); longWhistle(); });
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
    longWhistle();
  });

  useNavigationGuard(match?.status === 'in_progress');

  useEffect(() => {
    if (warmupTimer.isRunning) {
      if (warmupTimer.seconds === 60) {
        playWarningBeep();
        setLastAction(`⚠️ 30${t('common.time.seconds')}`);
        setAnnouncement(`30${t('common.time.seconds')}`);
        speak(`30${t('common.time.seconds')}`);
      }
      if (warmupTimer.seconds === 30) {
        playWarningBeep();
        setLastAction(`⚠️ 30${t('common.time.seconds')}`);
        setAnnouncement(`30${t('common.time.seconds')}`);
        speak(`30${t('common.time.seconds')}`);
      }
    }
  }, [warmupTimer.seconds, warmupTimer.isRunning]);

  useEffect(() => {
    if (!timeoutTimer.isRunning || !match?.activeTimeout) return;
    if (timeoutTimer.seconds === 15) {
      playWarningBeep();
      setLastAction(`⚠️ ${t('referee.scoring.fifteenSecondsLeft')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [timeoutTimer.seconds, timeoutTimer.isRunning, match?.activeTimeout]);

  const sideChangeAlerted = useRef(false);
  useEffect(() => {
    if (!sideChangeTimer.isRunning || !match?.sideChangeStartTime) {
      sideChangeAlerted.current = false;
      return;
    }
    if (sideChangeTimer.seconds === 15 && !sideChangeAlerted.current) {
      sideChangeAlerted.current = true;
      playWarningBeep();
      setLastAction(`⚠️ ${t('referee.scoring.sideChangeFifteenSeconds')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [sideChangeTimer.seconds, sideChangeTimer.isRunning, match?.sideChangeStartTime]);

  useEffect(() => {
    if (match?.sideChangeStartTime) {
      if (sideChangeDismissed) {
        updateMatch({ sideChangeStartTime: null });
        return;
      }
      const elapsed = Math.floor((Date.now() - match.sideChangeStartTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      if (remaining > 0 && !sideChangeTimer.isRunning) sideChangeTimer.start(remaining);
      else if (remaining <= 0) updateMatch({ sideChangeStartTime: null });
    } else {
      sideChangeTimer.stop();
      setSideChangeDismissed(false);
    }
  }, [match?.sideChangeStartTime, sideChangeDismissed]);

  useEffect(() => {
    if (match?.activeTimeout) {
      const type = match.activeTimeout.type ?? 'player';
      const totalDuration = type === 'player' ? 60 : type === 'medical' ? 300 : 0;
      if (totalDuration > 0) {
        const elapsed = Math.floor((Date.now() - match.activeTimeout.startTime) / 1000);
        const remaining = Math.max(0, totalDuration - elapsed);
        if (remaining > 0) {
          timeoutTimer.start(remaining);
        } else {
          timeoutTimer.stop();
          updateMatch({ activeTimeout: null });
        }
      }
    } else {
      timeoutTimer.stop();
    }
  }, [match?.activeTimeout, timeoutTimer]);

  const goldenGoalAnnounced = useRef(false);
  useEffect(() => {
    if (!goldenGoal.isActive) {
      goldenGoalAnnounced.current = false;
      return;
    }
    if (goldenGoalAnnounced.current) return;
    if (match?.status !== 'in_progress') return;
    goldenGoalAnnounced.current = true;
    const msg = t('referee.scoring.goldenGoalActivated');
    setLastAction(`⏱️ ${msg}`);
    setAnnouncement(msg);
    speak(msg);
    longWhistle();
    if (!match.goldenGoalActive) updateMatch({ goldenGoalActive: true });
  }, [goldenGoal.isActive, match?.status, match?.goldenGoalActive]);

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
    preWarmSpeech();

    const firstServe = choice === 'serve'
      ? (tossWinnerVal === 'team1' ? 'player1' : 'player2')
      : (tossWinnerVal === 'team1' ? 'player2' : 'player1');

    const t1n = match.team1Name ?? t('referee.home.team1Default');
    const t2n = match.team2Name ?? t('referee.home.team2Default');
    const servingTeamName = firstServe === 'player1' ? t1n : t2n;
    const tossWinnerName = tossWinnerVal === 'team1' ? t1n : t2n;

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

    const t1 = match.team1;
    const t2 = match.team2;
    const t1Order = team1Order.ids.length > 0 ? team1Order.ids : (t1?.memberIds || []);
    const t2Order = team2Order.ids.length > 0 ? team2Order.ids : (t2?.memberIds || []);

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
      matchStartedAt: Date.now(),
    });
    if (!ok) {
      throw new Error(t('referee.scoring.conflictError'));
    }
    longWhistle();
  }, [match, updateMatch, courtChangeByLoser, t, longWhistle, team1Order.ids, team2Order.ids]);

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
    longWhistle();
  }, [match, updateMatch, warmupTimer, longWhistle]);

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

    const woGameConfig = getEffectiveGameConfig(tournament?.gameConfig, 'team');
    const winScore = woGameConfig.POINTS_TO_WIN;
    const walkoverSets = Array.from({ length: woGameConfig.SETS_TO_WIN }, () => ({
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
  }, [match, updateMatch, tournament?.gameConfig, t]);

  const handleIBSAScore = useCallback(async (
    actingTeam: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!canAct()) return;
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    if (match.activeTimeout) return;

    if (goldenGoal.isActive) {
      if (actionType !== 'goal') {
        setLastAction(`⚠️ ${t('referee.scoring.goldenGoalOnlyGoal')}`);
        setAnnouncement(t('referee.scoring.goldenGoalOnlyGoal'));
        return;
      }
      const scoringTeamGG = toOpponent ? (actingTeam === 1 ? 2 : 1) : actingTeam;
      const setsGG = [...match.sets.map(s => ({ ...s }))];
      const csGG = { ...setsGG[0] };
      const beforeGG = { player1: csGG.player1Score, player2: csGG.player2Score };
      const { newScores } = applyGoldenGoalEvent('goal', scoringTeamGG, beforeGG);
      csGG.player1Score = newScores.player1;
      csGG.player2Score = newScores.player2;
      const winnerId = scoringTeamGG === 1 ? (match.team1Id ?? 'team1') : (match.team2Id ?? 'team2');
      csGG.winnerId = winnerId;
      setsGG[0] = csGG;
      const t1NameGG = match.team1Name ?? t('referee.home.team1Default');
      const t2NameGG = match.team2Name ?? t('referee.home.team2Default');
      const winnerName = scoringTeamGG === 1 ? t1NameGG : t2NameGG;
      const histEntry = createScoreHistoryEntry({
        scoringPlayer: winnerName,
        actionPlayer: actingTeam === 1 ? t1NameGG : t2NameGG,
        actionType: 'goal',
        actionLabel: `${t('referee.scoring.goldenGoalActivated')} - ${label}`,
        points,
        set: 1,
        server: (match.currentServe ?? 'player1') === 'player1' ? t1NameGG : t2NameGG,
        serveNumber: (match.serveCount ?? 0) + 1,
        scoreBefore: beforeGG,
        scoreAfter: newScores,
        serverSide: match.currentServe ?? 'player1',
      });
      goalWhistle();
      await updateMatch({
        sets: setsGG,
        status: 'completed',
        winnerId,
        scoreHistory: [histEntry, ...(match.scoreHistory ?? [])],
      });
      setLastAction(`🏆 ${winnerName} ${t('common.scoreActions.goal')}!`);
      setAnnouncement(`${winnerName} ${t('common.scoreActions.goal')}`);
      setTimeout(() => longWhistle(), 500);
      if (tournamentId) autoBackupToLocal(tournamentId);
      return;
    }

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

    let rotationUpdate: Record<string, unknown> = {};
    if (nextCount === 0 && nextServe !== currentServe) {
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

    if (actionType === 'goal') goalWhistle();
    else shortWhistle();

    const serverScore = currentServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = currentServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;

    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${tName} +${points}${t('common.units.point')}`
      : `${tName} ${t('common.scoreActions.goal')}! +${points}${t('common.units.point')}`;
    setLastAction(`${actionDesc} | ${t('common.matchHistory.score')} ${serverScore} : ${receiverScore}`);

    setAnnouncement(
      `${tName} ${points}${t('common.units.point')}. ${t('common.matchHistory.score')} ${serverScore} : ${receiverScore}. ${nextServerName} ${t('common.matchHistory.serve')} ${nextCount + 1}/${getMaxServes('team')}`
    );

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
      setTimeout(() => longWhistle(), 500);
      if (tournamentId) autoBackupToLocal(tournamentId);
      return;
    }

    if (shouldSideChange('team', cs, match.sideChangeUsed ?? false, sets, gameConfig)) {
      const ok2 = await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
        ...rotationUpdate,
      });
      if (!ok2) { setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨')); return; }
      setPendingSideChange(true);
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
  }, [match, gameConfig, updateMatch, canAct, startProcessing, done, tournamentId, goalWhistle, shortWhistle, longWhistle, goldenGoal.isActive, t]);

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
  }, [match, updateMatch, t]);

  const handleChangeServe = useCallback(async () => {
    if (!match || match.status !== 'in_progress') return;
    await updateMatch({
      currentServe: (match.currentServe ?? 'player1') === 'player1' ? 'player2' : 'player1',
      serveCount: 0,
    });
  }, [match, updateMatch]);

  const handleServeMiss = useCallback(() => {
    if (!match) return;
    const servingTeam = match.currentServe === 'player1' ? 1 : 2;
    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
    const sName = servingTeam === 1 ? t1Name : t2Name;
    handleIBSAScore(servingTeam as 1 | 2, 'serve_miss', 1, true, `${sName} ${t('common.scoreActions.serveMiss', '서브 미스')}`);
  }, [match, handleIBSAScore, t]);

  const handleDeadBall = useCallback(async (team: 1 | 2) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
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

    shortWhistle();
    setLastAction(t('common.matchHistory.deadBall', { server: actionTeamName }));
    setAnnouncement(t('common.matchHistory.deadBall', { server: actionTeamName }));
  }, [match, updateMatch, shortWhistle, t]);

  const handleTimeout = useCallback(async (team: 1 | 2, type: 'player' | 'medical' | 'referee' = 'player') => {
    if (!match || match.status !== 'in_progress') return;
    if (type === 'player') {
      const usedTimeouts = team === 1 ? (match.player1Timeouts ?? 0) : (match.player2Timeouts ?? 0);
      if (usedTimeouts >= 1) return;
    }
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
    longWhistle();
  }, [match, updateMatch, timeoutTimer, longWhistle, t]);

  const handlePenalty = useCallback(async (
    actingTeam: 1 | 2,
    penaltyType: 'penalty_table_pushing' | 'penalty_electronic' | 'penalty_talking',
  ) => {
    if (!canAct()) return;
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    if (match.activeTimeout) return;

    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
    const actorName = actingTeam === 1 ? t1Name : t2Name;

    if (penaltyType === 'penalty_electronic') {
      const label = `${actorName} ${t('common.scoreActions.penaltyElectronic')}`;
      handleIBSAScore(actingTeam, penaltyType, 2, true, label);
      return;
    }

    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    const totalPenaltyCount = prevHistory.filter(
      h => h.actionType === penaltyType && h.actionPlayer === actorName
    ).length;

    if (totalPenaltyCount % 2 === 0) {
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
      shortWhistle();
      setLastAction(`⚠️ ${t('common.matchHistory.warning', { player: actorName, action: penaltyLabel })}`);
      setAnnouncement(t('common.matchHistory.warning', { player: actorName, action: penaltyLabel }));
      } finally { done(); }
    } else {
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? t('common.scoreActions.penaltyTablePushing') : t('common.scoreActions.penaltyTalking');
      const penaltyPoints = penaltyType === 'penalty_talking' ? 1 : 2;
      const label = `${actorName} ${penaltyLabel}`;
      handleIBSAScore(actingTeam, penaltyType, penaltyPoints, true, label);
    }
  }, [match, canAct, startProcessing, done, handleIBSAScore, updateMatch, shortWhistle, t]);

  const handleQuickFoul = useCallback(async (actingTeam: 1 | 2) => {
    const t1n = match?.team1Name ?? t('referee.home.team1Default');
    const t2n = match?.team2Name ?? t('referee.home.team2Default');
    const actorName = actingTeam === 1 ? t1n : t2n;
    await handleIBSAScore(actingTeam, 'foul', 1, true, `${actorName} ${t('common.scoreActions.foul')}`);
    setFoulClassify({ player: actingTeam });
  }, [match, handleIBSAScore, t]);

  const handleClassifyFoul = useCallback(async (type: ScoreActionType, label: string) => {
    if (!match?.scoreHistory || match.scoreHistory.length === 0) return;
    const updatedHistory = [...match.scoreHistory];
    const last = { ...updatedHistory[0] };
    if (last.actionType === 'foul') {
      last.actionType = type;
      last.actionLabel = `${last.actionPlayer} ${label}`;
      updatedHistory[0] = last;
      await updateMatch({ scoreHistory: updatedHistory });
    }
    setFoulClassify(null);
  }, [match, updateMatch]);

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
  }, [match, subTeam, subOutIndex, subInIndex, updateMatch, getTeamActivePlayers, getTeamReservePlayers, t]);

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
  }, [match?.status, handleIBSAScore, handleUndo, team1Name, team2Name, t]);

  // Derived values for in_progress view
  const sets = Array.isArray(match?.sets) && match!.sets!.length > 0 ? match!.sets! : [createEmptySet()];
  const currentSet = sets[0] ?? createEmptySet();
  const currentServe = match?.currentServe ?? 'player1';
  const serveCountVal = match?.serveCount ?? 0;
  const serverName = currentServe === 'player1' ? team1Name : team2Name;
  const maxServes = getMaxServes('team');
  const history: ScoreHistoryEntry[] = match?.scoreHistory ?? [];

  const t1TimeoutsUsed = match?.player1Timeouts ?? 0;
  const t2TimeoutsUsed = match?.player2Timeouts ?? 0;

  const p1Warnings = history.filter(h => h.penaltyWarning && h.actionPlayer === team1Name).length;
  const p2Warnings = history.filter(h => h.penaltyWarning && h.actionPlayer === team2Name).length;
  const p1Penalties = history.filter(h =>
    (h.actionType === 'penalty_table_pushing' || h.actionType === 'penalty_electronic' || h.actionType === 'penalty_talking')
    && !h.penaltyWarning && h.actionPlayer === team1Name
  ).length;
  const p2Penalties = history.filter(h =>
    (h.actionType === 'penalty_table_pushing' || h.actionType === 'penalty_electronic' || h.actionType === 'penalty_talking')
    && !h.penaltyWarning && h.actionPlayer === team2Name
  ).length;

  const scoringDisabled = !!match?.activeTimeout || showSideChange || pendingSideChange;
  const nonGoalDisabled = scoringDisabled || goldenGoal.isActive;

  return {
    // data
    match, matchLoading, tournament, updateMatch,
    team1Name, team2Name,
    // state + setters
    announcement, lastAction, setLastAction,
    scoreFlash,
    pendingSideChange, setPendingSideChange,
    sideChangeDismissed, setSideChangeDismissed,
    showHistory, setShowHistory,
    showWarmup, setShowWarmup,
    showSubstitution, setShowSubstitution,
    expandedSection, toggleSection,
    foulClassify, setFoulClassify,
    subTeam, setSubTeam,
    subOutIndex, setSubOutIndex,
    subInIndex, setSubInIndex,
    team1Order, setTeam1Order,
    team2Order, setTeam2Order,
    coinTossStep, setCoinTossStep,
    tossWinner, setTossWinner,
    setCourtChangeByLoser,
    pendingChoice, setPendingChoice,
    // timers & audio
    sideChangeTimer, warmupTimer, timeoutTimer,
    shortWhistle, longWhistle, goalWhistle, initAudio,
    // golden goal
    goldenGoal,
    // handlers
    handleStartMatch, handleWarmup, handleWalkover,
    handleIBSAScore, handleUndo, handleChangeServe,
    handleServeMiss, handleDeadBall, handleTimeout,
    handlePenalty, handleQuickFoul, handleClassifyFoul,
    handleSubstitution, openSubstitution,
    getTeamActivePlayers, getTeamReservePlayers, hasReserves,
    // derived
    sets, currentSet, currentServe, serveCountVal, serverName, maxServes,
    history,
    t1TimeoutsUsed, t2TimeoutsUsed,
    p1Warnings, p2Warnings, p1Penalties, p2Penalties,
    showSideChange, scoringDisabled, nonGoalDisabled,
  };
}
