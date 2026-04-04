import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { speak, preWarmSpeech } from '@shared/utils/locale';
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
import type { ScoreActionType, ScoreHistoryEntry } from '@shared/types';
import { formatTime } from '@shared/utils/locale';
import { useCountdownTimer, playWarningBeep } from '../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../hooks/useDoubleClickGuard';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { useWhistle } from '@shared/hooks/useWhistle';
import { autoBackupDebounced, autoBackupToLocal } from '@shared/utils/backup';
import TimerModal from '../components/TimerModal';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import ActionToast from '../components/ActionToast';
import FoulClassifyOverlay from '../components/FoulClassifyOverlay';

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
  const { shortWhistle, longWhistle, goalWhistle, initAudio } = useWhistle();
  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);
  const [pendingSideChange, setPendingSideChange] = useState(false);
  const [sideChangeDismissed, setSideChangeDismissed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Warmup
  const [showWarmup, setShowWarmup] = useState(false);
  // Substitution ({t('common.matchHistory.substitution')})
  const [showSubstitution, setShowSubstitution] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const toggleSection = (key: string) => setExpandedSection(prev => prev === key ? null : key);
  const [foulClassify, setFoulClassify] = useState<{ player: 1 | 2 } | null>(null);
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

  // Derive side change visibility from Firebase state (survives refresh)
  // sideChangeDismissed: 로컬에서 즉시 닫기 (Firebase 업데이트 실패해도 UI 복귀)
  const showSideChange = !!(match?.sideChangeStartTime) && !sideChangeDismissed;

  // Timers
  const sideChangeTimer = useCountdownTimer(() => {
    if (match) updateMatch({ sideChangeStartTime: null });
    longWhistle();
  });
  const warmupTimer = useCountdownTimer(() => { setShowWarmup(false); longWhistle(); });
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
    longWhistle();
  });

  // Navigation guard
  useNavigationGuard(match?.status === 'in_progress');

  // 팀전 워밍업 30초마다 알림 (90초: 60초/30초 경과 시 교대 안내)
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

  // 타임아웃 15초 알림 - activeTimeout 존재 여부 체크로 종료 후 오출력 방지
  useEffect(() => {
    if (!timeoutTimer.isRunning || !match?.activeTimeout) return;
    if (timeoutTimer.seconds === 15) {
      playWarningBeep();
      setLastAction(`⚠️ ${t('referee.scoring.fifteenSecondsLeft')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [timeoutTimer.seconds, timeoutTimer.isRunning, match?.activeTimeout]);

  // 15초 안내 (사이드 체인지)
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

  // Sync sideChange timer from Firebase (survives refresh/re-entry)
  useEffect(() => {
    if (match?.sideChangeStartTime) {
      // 이미 dismiss한 상태면 Firebase 정리만 시도하고 모달 다시 안 띄움
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
      setSideChangeDismissed(false); // Firebase 정리 완료 시에만 리셋
    }
  }, [match?.sideChangeStartTime, sideChangeDismissed]);

  // Start timeout timer when activeTimeout changes
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
      // referee timeout: no auto-timer (manual end)
    } else {
      timeoutTimer.stop();
    }
  }, [match?.activeTimeout, timeoutTimer]);

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
    preWarmSpeech();

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
    if (match.status !== 'in_progress') return;
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
      `${tName} ${points}${t('common.units.point')}. ${t('common.matchHistory.score')} ${serverScore} : ${receiverScore}. ${nextServerName} ${t('common.matchHistory.serve')} ${nextCount + 1}/${getMaxServes('team')}`
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
  }, [match, gameConfig, updateMatch, canAct, startProcessing, done, tournamentId, goalWhistle, shortWhistle, longWhistle]);

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

  // Serve Miss - 서브권 있는 팀이 1점 실점 (상대에게 +1)
  const handleServeMiss = useCallback(() => {
    if (!match) return;
    const servingTeam = match.currentServe === 'player1' ? 1 : 2;
    const t1Name = match.team1Name ?? t('referee.home.team1Default');
    const t2Name = match.team2Name ?? t('referee.home.team2Default');
    const sName = servingTeam === 1 ? t1Name : t2Name;
    handleIBSAScore(servingTeam as 1 | 2, 'serve_miss', 1, true, `${sName} ${t('common.scoreActions.serveMiss', '서브 미스')}`);
  }, [match, handleIBSAScore, t]);

  // Dead Ball - 양쪽 모두 가능
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
    if (match.status !== 'in_progress') return;
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

  // Quick foul: 1-tap generic foul (+1 to opponent)
  const handleQuickFoul = useCallback(async (actingTeam: 1 | 2) => {
    const t1n = match?.team1Name ?? t('referee.home.team1Default');
    const t2n = match?.team2Name ?? t('referee.home.team2Default');
    const actorName = actingTeam === 1 ? t1n : t2n;
    await handleIBSAScore(actingTeam, 'foul', 1, true, `${actorName} ${t('common.scoreActions.foul')}`);
    setFoulClassify({ player: actingTeam });
  }, [match, handleIBSAScore, t]);

  // Classify a previously recorded foul
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
        <p className="text-lg text-gray-400 text-center">{t('referee.practice.setup.teamRuleSummary')}</p>
        {match.courtName && <p className="text-gray-400 text-center">{t('referee.home.court')}: {match.courtName}</p>}

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
                    <button className="text-gray-400 hover:text-white px-1" disabled={i === 0} onClick={() => swapOrder(setter, order, i, -1)} style={{ minHeight: '44px', minWidth: '44px' }} aria-label={`${name} ${t('admin.tournamentDetail.bracketTab.orderUpAriaLabel')}`}>▲</button>
                    <button className="text-gray-400 hover:text-white px-1" disabled={i === order.names.length - 1} onClick={() => swapOrder(setter, order, i, 1)} style={{ minHeight: '44px', minWidth: '44px' }} aria-label={`${name} ${t('admin.tournamentDetail.bracketTab.orderDownAriaLabel')}`}>▼</button>
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
                aria-label={t('referee.scoring.teamOrderConfirm')}
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
              <button className="btn btn-primary btn-large flex-1" onClick={() => { initAudio(); setTossWinner('team1'); setCoinTossStep('choice'); }} aria-label={`${team1Name} ${t('referee.scoring.coinToss')}`}>
                {team1Name}
              </button>
              <button className="btn btn-primary btn-large flex-1" onClick={() => { initAudio(); setTossWinner('team2'); setCoinTossStep('choice'); }} aria-label={`${team2Name} ${t('referee.scoring.coinToss')}`}>
                {team2Name}
              </button>
            </div>
            <div className="text-center">
              <button className="text-sm text-gray-400 underline" onClick={() => setCoinTossStep('team_order')} style={{ minHeight: '44px' }}>
                {t('common.back')}
              </button>
            </div>
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
            <div className="text-center">
              <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
                {t('common.back')}
              </button>
            </div>
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
            <div className="text-center">
              <button className="text-sm text-gray-400 underline" onClick={() => setCoinTossStep('choice')} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
                {t('common.back')}
              </button>
            </div>
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
            <h3 className="text-sm font-bold text-gray-400 mb-2 text-center">{t('common.scoreActions.walkover')}</h3>
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

        <div className="text-center">
          <button className="btn btn-accent" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
        </div>
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
            <h3 className="text-lg font-bold text-gray-300 mb-2 text-center">{t('common.matchHistory.titleWithCount', { count: history.length })}</h3>
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

  const t1TimeoutsUsed = match.player1Timeouts ?? 0;
  const t2TimeoutsUsed = match.player2Timeouts ?? 0;

  // W/P/T.O. counts from score history
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


  // GAP-2: disabled condition for scoring buttons
  const scoringDisabled = !!match.activeTimeout || showSideChange || pendingSideChange;

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

      {/* Side Change: Phase 1 - Prompt (local state, before Firebase timer starts) */}
      {pendingSideChange && !showSideChange && (
        <TimerModal
          title={`${t('common.matchHistory.sideChange')}! (16${t('common.units.point')})`}
          seconds={0}
          isWarning={false}
          subtitle={t('common.matchHistory.sideChange')}
          onClose={async () => {
            setPendingSideChange(false);
            const ok = await updateMatch({ sideChangeStartTime: Date.now() });
            if (!ok) {
              setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨'));
            }
          }}
          closeLabel={`⏱️ ${t('referee.scoring.timeoutTitle.player')} ${t('common.start')}`}
          required
        />
      )}

      {/* Side Change: Phase 2 - Timer countdown (Firebase-driven, survives refresh) */}
      {showSideChange && (
        <TimerModal
          title={`${t('common.matchHistory.sideChange')}! (16${t('common.units.point')})`}
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle={`1${t('common.time.minutes')}`}
          onClose={() => {
            sideChangeTimer.stop();
            setSideChangeDismissed(true);  // 즉시 UI 닫기
            updateMatch({ sideChangeStartTime: null });  // Firebase 백그라운드 정리
            longWhistle();
          }}
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
      <div className="bg-blue-900/50 px-4 py-1.5 flex items-center justify-center gap-3" role="status" aria-label={`${serverName} ${t('common.matchHistory.serve')} ${serveCountVal + 1}/${maxServes}`}>
        <span className="text-blue-300 font-semibold text-sm">
          🎾 {serverName} {t('common.matchHistory.serve')} {serveCountVal + 1}/{maxServes}
        </span>
        <button className="text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label={t('common.matchHistory.serve')} style={{ minHeight: '44px', minWidth: '44px' }}>{t('common.matchHistory.serve')}</button>
      </div>

      {/* Score display */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-3 px-2 border-r border-gray-700" style={currentServe === 'player1' ? { borderLeft: '3px solid rgba(234,179,8,0.4)' } : undefined}>
          <h2 className="text-lg font-bold text-yellow-400">
            {currentServe === 'player1' && '🎾 '}{team1Name}
          </h2>
          <div key={`t1-${scoreFlash}`} className="text-7xl font-bold my-1 text-yellow-400" style={{ animation: 'scoreFlash 0.3s ease-out' }}>
            {currentSet.player1Score}
          </div>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 font-bold">W{p1Warnings}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-800/60 text-red-300 font-bold">P{p1Penalties}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-800/60 text-blue-300 font-bold">T{t1TimeoutsUsed}</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 px-2" style={currentServe === 'player2' ? { borderRight: '3px solid rgba(6,182,212,0.4)' } : undefined}>
          <h2 className="text-lg font-bold text-cyan-400">
            {currentServe === 'player2' && '🎾 '}{team2Name}
          </h2>
          <div key={`t2-${scoreFlash}`} className="text-7xl font-bold my-1 text-cyan-400" style={{ animation: 'scoreFlash 0.3s ease-out' }}>
            {currentSet.player2Score}
          </div>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 font-bold">W{p2Warnings}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-800/60 text-red-300 font-bold">P{p2Penalties}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-800/60 text-blue-300 font-bold">T{t2TimeoutsUsed}</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* Scoring area - 4 main buttons */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Row 1: 골 +2 */}
        <div className="grid grid-cols-2 gap-3">
          <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
            onClick={() => handleIBSAScore(1, 'goal', 2, false, `${team1Name} ${t('common.scoreActions.goal')}`)}>
            ⚽ {team1Name}<br/>{t('common.scoreActions.goal')} +2
          </button>
          <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
            onClick={() => handleIBSAScore(2, 'goal', 2, false, `${team2Name} ${t('common.scoreActions.goal')}`)}>
            ⚽ {team2Name}<br/>{t('common.scoreActions.goal')} +2
          </button>
        </div>

        {/* Row 2: 파울 +1 */}
        <div className="grid grid-cols-2 gap-3">
          <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={scoringDisabled}
            onClick={() => handleQuickFoul(1)}>
            🟡 {team1Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {team2Name} +1</span>
          </button>
          <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={scoringDisabled}
            onClick={() => handleQuickFoul(2)}>
            🟡 {team2Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {team1Name} +1</span>
          </button>
        </div>

        {/* Row 2.5: 데드볼 + 서브 미스 */}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn bg-purple-700 hover:bg-purple-600 text-white text-base py-3 font-bold" disabled={scoringDisabled || match.status !== 'in_progress'}
            onClick={() => handleDeadBall(match.currentServe === 'player1' ? 1 : 2)}>
            🔵 {t('common.matchHistory.deadBall', { server: '' }).trim()}
          </button>
          <button className="btn bg-orange-700 hover:bg-orange-600 text-white text-base py-3 font-bold" disabled={scoringDisabled || match.status !== 'in_progress'}
            onClick={handleServeMiss}>
            🎾 {t('common.scoreActions.serveMiss', '서브 미스')}
          </button>
        </div>

        {/* Row 3: 취소 / 레프리타임 / 휘슬 */}
        <div className="grid grid-cols-3 gap-2">
          <button className="btn btn-danger py-3 text-sm" onClick={handleUndo} disabled={history.length === 0}>↩️ {t('common.cancel')}</button>
          <button className="btn bg-yellow-800 hover:bg-yellow-700 text-white py-3 text-sm" onClick={() => handleTimeout(1, 'referee')} disabled={!!match.activeTimeout}
            aria-label={t('referee.scoring.timeoutTitle.referee')}>
            🟨 {t('referee.scoring.timeoutTitle.referee')}
          </button>
          <button className="btn bg-gray-700 hover:bg-gray-600 text-white py-3 text-sm" onClick={shortWhistle}
            aria-label="서브 휘슬" style={{ minHeight: '44px' }}>
            📣 휘슬
          </button>
        </div>

        {/* 접이식: 타임아웃 */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('timeout')} aria-expanded={expandedSection === 'timeout'}>
            <span className="text-sm font-bold text-gray-300">⏱️ {t('referee.scoring.timeoutTitle.player')}</span>
            <span className="text-gray-400">{expandedSection === 'timeout' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'timeout' && (
            <div className="px-3 py-3 space-y-2 bg-gray-900/50">
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-secondary text-sm py-2" onClick={() => handleTimeout(1, 'player')} disabled={t1TimeoutsUsed >= 1 || !!match.activeTimeout}
                  aria-label={`${team1Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - t1TimeoutsUsed}/1)`}>
                  ⏱️ {team1Name} {t('referee.scoring.timeoutTitle.player')} ({1 - t1TimeoutsUsed}/1)
                </button>
                <button className="btn btn-secondary text-sm py-2" onClick={() => handleTimeout(2, 'player')} disabled={t2TimeoutsUsed >= 1 || !!match.activeTimeout}
                  aria-label={`${team2Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - t2TimeoutsUsed}/1)`}>
                  ⏱️ {team2Name} {t('referee.scoring.timeoutTitle.player')} ({1 - t2TimeoutsUsed}/1)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => handleTimeout(1, 'medical')} disabled={!!match.activeTimeout || history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team1Name).length >= 1}
                  aria-label={`${team1Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team1Name).length}/1)`}>
                  🏥 {team1Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team1Name).length}/1)
                </button>
                <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => handleTimeout(2, 'medical')} disabled={!!match.activeTimeout || history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team2Name).length >= 1}
                  aria-label={`${team2Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team2Name).length}/1)`}>
                  🏥 {team2Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - history.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === team2Name).length}/1)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 접이식: 벌점 */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('penalty')} aria-expanded={expandedSection === 'penalty'}>
            <span className="text-sm font-bold text-gray-300">🔴 벌점 (테이블푸싱/전자기기/말하기/고글터치)</span>
            <span className="text-gray-400">{expandedSection === 'penalty' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'penalty' && (
            <div className="px-3 py-3 space-y-2 bg-gray-900/50">
              <div className="grid grid-cols-2 gap-2">
                {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => (
                  <button key={`t1-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded" disabled={scoringDisabled}
                    onClick={() => handlePenalty(1, pType)}>
                    {team1Name} {t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`)}
                  </button>
                ))}
                {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => (
                  <button key={`t2-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded" disabled={scoringDisabled}
                    onClick={() => handlePenalty(2, pType)}>
                    {team2Name} {t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`)}
                  </button>
                ))}
              </div>
              <div className="border-t border-red-800 pt-2">
                <p className="text-[10px] text-red-400 mb-1">고글 터치 — 즉시 상대 +2점</p>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn bg-red-800 hover:bg-red-700 text-white text-xs py-2 rounded font-bold"
                    disabled={scoringDisabled}
                    onClick={() => handleIBSAScore(1, 'mask_touch', 2, true, `${team1Name} 고글 터치`)}
                    aria-label={`${team1Name} 고글 터치 — ${team2Name}에게 2점`} style={{ minHeight: '44px' }}>
                    🥽 {team1Name} 고글 터치
                  </button>
                  <button className="btn bg-red-800 hover:bg-red-700 text-white text-xs py-2 rounded font-bold"
                    disabled={scoringDisabled}
                    onClick={() => handleIBSAScore(2, 'mask_touch', 2, true, `${team2Name} 고글 터치`)}
                    aria-label={`${team2Name} 고글 터치 — ${team1Name}에게 2점`} style={{ minHeight: '44px' }}>
                    🥽 {team2Name} 고글 터치
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 접이식: 기타 */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('etc')} aria-expanded={expandedSection === 'etc'}>
            <span className="text-sm font-bold text-gray-300">⚙️ {t('common.scoreActions.walkover')}</span>
            <span className="text-gray-400">{expandedSection === 'etc' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'etc' && (
            <div className="px-4 py-3 space-y-3 bg-gray-900/50">
              {!match.warmupUsed && (match.currentSet ?? 0) === 0 && (
                <div className="flex gap-3">
                  <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white" onClick={handleWarmup}>
                    🔥 {t('referee.scoring.warmupStart')} 90{t('common.time.seconds')}
                  </button>
                </div>
              )}
              {(hasReserves(1) || hasReserves(2)) && (
                <div className="grid grid-cols-2 gap-2">
                  {hasReserves(1) && (
                    <button className="btn bg-indigo-700 hover:bg-indigo-600 text-white text-sm py-2 rounded" disabled={!!match.team1SubUsed}
                      onClick={() => openSubstitution(1)}>
                      🔄 {team1Name} {t('common.matchHistory.substitution')}
                    </button>
                  )}
                  {hasReserves(2) && (
                    <button className="btn bg-indigo-700 hover:bg-indigo-600 text-white text-sm py-2 rounded" disabled={!!match.team2SubUsed}
                      onClick={() => openSubstitution(2)}>
                      🔄 {team2Name} {t('common.matchHistory.substitution')}
                    </button>
                  )}
                </div>
              )}
              <div className="border-t border-gray-700 pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2" onClick={() => handleWalkover(1)} disabled={match.status !== 'in_progress' && match.status !== 'pending'}>{team1Name} {t('common.scoreActions.walkover')}</button>
                  <button className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2" onClick={() => handleWalkover(2)} disabled={match.status !== 'in_progress' && match.status !== 'pending'}>{team2Name} {t('common.scoreActions.walkover')}</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* History */}
        <div>
          <button className="text-sm text-gray-400 underline mb-2" onClick={() => setShowHistory(!showHistory)} style={{ minHeight: '44px' }}>
            {showHistory ? `▲ ${t('common.matchHistory.title')}` : `▼ ${t('common.matchHistory.titleWithCount', { count: history.length })}`}
          </button>
          {showHistory && history.length > 0 && (
            <div className="w-full">
              <ScoreHistoryView history={history} sets={sets} />
            </div>
          )}
        </div>
      </div>

      {/* Foul classification overlay */}
      {foulClassify && (
        <FoulClassifyOverlay
          playerName={foulClassify.player === 1 ? team1Name : team2Name}
          player={foulClassify.player}
          onClassify={handleClassifyFoul}
          onPenalty={async (player, penaltyType) => {
            await handleUndo();
            setFoulClassify(null);
            handlePenalty(player, penaltyType);
          }}
          onDismiss={() => setFoulClassify(null)}
        />
      )}
    </div>
  );
}
