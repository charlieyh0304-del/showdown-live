import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useTournament } from '@shared/hooks/useFirebase';
import {
  createEmptySet,
  createScoreHistoryEntry,
  getEffectiveTimeLimitSeconds,
  applyGoldenGoalEvent,
  getPenaltyAction,
  computePenaltyCounts,
} from '@shared/utils/scoring';
import {
  DEFAULT_INDIVIDUAL_SCORING,
  matchWinnerByRules,
  resolveMatchScoring,
  setWinnerByRules,
  setWinsByRules,
} from '@shared/rules/competitionRules';
import { advanceServeTurn, revertServeTurn, servesPerTurnOf, shouldChangeSidesMidSet } from '@shared/rules/serve';
import { useGoldenGoalTimer } from './useGoldenGoalTimer';
import { formatTime, speak, preWarmSpeech } from '@shared/utils/locale';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import type { ScoreActionType, ScoreHistoryEntry } from '@shared/types';
import { autoBackupDebounced, autoBackupToLocal } from '@shared/utils/backup';
import { useCountdownTimer, playWarningBeep } from './useCountdownTimer';
import { useDoubleClickGuard } from './useDoubleClickGuard';
import { useFocusTrap } from './useFocusTrap';
import { setEndOutcome } from './teamScoringModel';
import { useWhistle } from '@shared/hooks/useWhistle';
import { useTimerAlerts } from './useTimerAlerts';
import { useTimerSync } from './useTimerSync';
import { useGoldenGoalAnnouncement } from './useGoldenGoalAnnouncement';
import { useActiveMatchRecovery } from './useActiveMatchRecovery';
import { showConfirm, showPrompt } from '@shared/utils/confirm';
import { walkoverSetsFor } from '@shared/utils/competition';

type PenaltyDropdownKey = 'player1' | 'player2' | null;

export function useIndividualScoring(
  tournamentId: string | undefined,
  matchId: string | undefined,
) {
  const { t } = useTranslation();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);

  const { canAct, startProcessing, done } = useDoubleClickGuard();
  const { shortWhistle, longWhistle, goalWhistle, initAudio } = useWhistle();

  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);

  /** updateMatch 실패 시 시각 + 음성 알림 (전맹 심판 지원) */
  const notifyUpdateFailed = useCallback(() => {
    const msg = t('referee.scoring.conflictError');
    setLastAction(`⚠️ ${msg}`);
    setAnnouncement(msg);
    speak(msg);
  }, [t]);

  const [showHistory, setShowHistory] = useState(false);
  const [showSetEndConfirm, setShowSetEndConfirm] = useState(false);
  const [setEndMessage, setSetEndMessage] = useState('');
  const [isMatchEnd, setIsMatchEnd] = useState(false);
  // Warmup & SideChange derived from Firebase state
  const [pendingSideChange, setPendingSideChange] = useState(false);
  const [sideChangeDismissed, setSideChangeDismissed] = useState(false);
  // Coin toss
  const [coinTossStep, setCoinTossStep] = useState<'toss' | 'choice' | 'court_change' | 'warmup_ask'>('toss');
  const [tossWinner, setTossWinner] = useState<'player1' | 'player2' | null>(null);
  const [pendingFirstServe, setPendingFirstServe] = useState<'player1' | 'player2' | null>(null);
  const [courtChangeByLoser, setCourtChangeByLoser] = useState(false);
  // Coach - synced to Firebase in real-time
  const [player1Coach, setPlayer1Coach] = useState('');
  const [player2Coach, setPlayer2Coach] = useState('');
  const coachSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncCoachToFirebase = useCallback((field: 'player1Coach' | 'player2Coach', value: string) => {
    if (coachSyncTimer.current) clearTimeout(coachSyncTimer.current);
    coachSyncTimer.current = setTimeout(() => {
      updateMatch({ [field]: value || null }); // 빈 값 = 코치 삭제 (null), undefined는 무시됨
    }, 500);
  }, [updateMatch]);
  // Penalty & timeout dropdowns
  const [penaltyDropdown, setPenaltyDropdown] = useState<PenaltyDropdownKey>(null);
  const penaltyDropdownRef = useRef<HTMLDivElement>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const toggleSection = (key: string) => setExpandedSection(prev => prev === key ? null : key);
  const [foulClassify, setFoulClassify] = useState<{ player: 1 | 2 } | null>(null);

  // 경기 판정 규칙: 대회 규칙 단일 설정원(경기 → 라운드/순위결정전 → 스테이지 → 대회 → 기본), 듀스 캡·서브 수·사이드 체인지 포함
  const rules = useMemo(
    () => (match ? resolveMatchScoring({ ...match, type: 'individual' }, tournament) : DEFAULT_INDIVIDUAL_SCORING),
    [match, tournament],
  );
  const maxServes = servesPerTurnOf(rules, 'individual');
  const timeLimitSeconds = match ? getEffectiveTimeLimitSeconds(match, tournament) : 0;
  const goldenGoal = useGoldenGoalTimer(match?.matchStartedAt, timeLimitSeconds);
  useNavigationGuard(match?.status === 'in_progress');
  const setEndTrapRef = useFocusTrap(showSetEndConfirm);

  // Timers - driven by Firebase timestamps
  const sideChangeTimer = useCountdownTimer(() => {
    if (match) updateMatch({ sideChangeStartTime: null });
    longWhistle();
  });
  const warmupTimer = useCountdownTimer(() => {
    if (match) updateMatch({ warmupStartTime: null });
    longWhistle();
  });
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
    longWhistle();
  });

  // Derive modal visibility from Firebase state
  const showWarmup = !!(match?.warmupStartTime);
  const showSideChange = !!(match?.sideChangeStartTime) && !sideChangeDismissed;

  // 15초 경고 (타임아웃 + 사이드체인지) — shared hook
  useTimerAlerts({
    timeoutTimer, sideChangeTimer,
    activeTimeout: match?.activeTimeout,
    sideChangeStartTime: match?.sideChangeStartTime,
    setLastAction, setAnnouncement,
  });

  // 15초 안내 (워밍업) - warmupStartTime 존재 여부도 체크
  const warmupAlerted = useRef(false);
  useEffect(() => {
    if (!warmupTimer.isRunning || !match?.warmupStartTime) {
      warmupAlerted.current = false;
      return;
    }
    if (warmupTimer.seconds === 15 && !warmupAlerted.current) {
      warmupAlerted.current = true;
      playWarningBeep();
      setLastAction(`⚠️ ${t('referee.scoring.warmupFifteenSeconds')}`);
      setAnnouncement(t('referee.scoring.warmupFifteenSeconds'));
      speak(t('referee.scoring.warmupFifteenSeconds'));
    }
  }, [warmupTimer.seconds, warmupTimer.isRunning, match?.warmupStartTime]);

  // Sync warmup timer from Firebase
  useEffect(() => {
    if (match?.warmupStartTime) {
      const elapsed = Math.floor((Date.now() - match.warmupStartTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      if (remaining > 0 && !warmupTimer.isRunning) warmupTimer.start(remaining);
      else if (remaining <= 0) updateMatch({ warmupStartTime: null });
    } else {
      warmupTimer.stop();
    }
  }, [match?.warmupStartTime]);

  // 사이드체인지 + 타임아웃 타이머 Firebase 동기화 — shared hook
  useTimerSync({
    sideChangeTimer, timeoutTimer,
    sideChangeStartTime: match?.sideChangeStartTime,
    sideChangeDismissed,
    activeTimeout: match?.activeTimeout,
    updateMatch,
    setSideChangeDismissed,
  });

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (penaltyDropdown && penaltyDropdownRef.current && !penaltyDropdownRef.current.contains(e.target as Node)) {
        setPenaltyDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [penaltyDropdown]);

  // Sync coach from match (always prefer Firebase value)
  useEffect(() => {
    if (match?.player1Coach !== undefined && match.player1Coach !== player1Coach) setPlayer1Coach(match.player1Coach);
    if (match?.player2Coach !== undefined && match.player2Coach !== player2Coach) setPlayer2Coach(match.player2Coach);
  }, [match?.player1Coach, match?.player2Coach]);

  // 골든골 진입 안내 — shared hook
  useGoldenGoalAnnouncement({
    goldenGoalActive: goldenGoal.isActive,
    matchStatus: match?.status,
    matchGoldenGoalActive: match?.goldenGoalActive,
    updateMatch, setLastAction, setAnnouncement, longWhistle,
  });

  // 세션 복구용 localStorage — shared hook
  useActiveMatchRecovery(match?.status, tournamentId, matchId);

  const handleStartMatch = useCallback(async (firstServe: 'player1' | 'player2', withWarmup = false) => {
    if (!match) return;
    preWarmSpeech();
    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const winnerName = tossWinner === 'player1' ? p1Name : p2Name;
    const choiceLabel = firstServe === (tossWinner ?? 'player1') ? t('referee.scoring.serveChoice') : t('referee.scoring.receiveChoice');
    const serverName = firstServe === 'player1' ? p1Name : p2Name;

    const loserName = tossWinner === 'player1' ? p2Name : p1Name;
    const courtChangeLabel = t('referee.scoring.coinTossLoserCourtChange', {
      loser: loserName,
      decision: courtChangeByLoser ? t('referee.scoring.courtChangeYes') : t('referee.scoring.courtChangeNo'),
    });

    const coinTossEntry: ScoreHistoryEntry = {
      time: formatTime(),
      scoringPlayer: '',
      actionPlayer: winnerName,
      actionType: 'coin_toss',
      actionLabel: `${t('referee.scoring.coinTossWinner', { winner: winnerName, choice: choiceLabel })} / ${courtChangeLabel}`,
      points: 0,
      set: 1,
      server: serverName,
      serveNumber: 1,
      scoreBefore: { player1: 0, player2: 0 },
      scoreAfter: { player1: 0, player2: 0 },
      serverSide: firstServe,
    };

    const now = () => formatTime();

    // Coach info entry (if coaches provided)
    const coachEntries: ScoreHistoryEntry[] = [];
    if (player1Coach || player2Coach) {
      const coachInfo = [player1Coach ? `${p1Name} ${t('referee.practice.setup.coachLabel')}: ${player1Coach}` : '', player2Coach ? `${p2Name} ${t('referee.practice.setup.coachLabel')}: ${player2Coach}` : ''].filter(Boolean).join(', ');
      coachEntries.push({
        time: now(), scoringPlayer: '', actionPlayer: '', actionType: 'match_start',
        actionLabel: coachInfo, points: 0, set: 1,
        server: serverName, serveNumber: 1,
        scoreBefore: { player1: 0, player2: 0 }, scoreAfter: { player1: 0, player2: 0 },
        serverSide: firstServe,
      });
    }

    const matchStartEntry: ScoreHistoryEntry = {
      time: now(), scoringPlayer: '', actionPlayer: '', actionType: 'match_start',
      actionLabel: t('referee.scoring.matchStartLabel'), points: 0, set: 1,
      server: serverName, serveNumber: 1,
      scoreBefore: { player1: 0, player2: 0 }, scoreAfter: { player1: 0, player2: 0 },
      serverSide: firstServe,
    };

    // Warmup entry (if warmup requested)
    const warmupEntries: ScoreHistoryEntry[] = [];
    if (withWarmup) {
      warmupEntries.push({
        time: now(), scoringPlayer: '', actionPlayer: '', actionType: 'warmup_start',
        actionLabel: `${t('referee.scoring.warmupStart')} (60${t('common.time.seconds')})`, points: 0, set: 1,
        server: serverName, serveNumber: 1,
        scoreBefore: { player1: 0, player2: 0 }, scoreAfter: { player1: 0, player2: 0 },
        serverSide: firstServe,
      });
    }

    // 실제 시작 시간으로 스케줄 자동 업데이트
    const startNow = new Date();
    const actualTime = `${String(startNow.getHours()).padStart(2, '0')}:${String(startNow.getMinutes()).padStart(2, '0')}`;

    const ok = await updateMatch({
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
      scoreHistory: [...warmupEntries, matchStartEntry, ...coachEntries, coinTossEntry],
      warmupUsed: withWarmup,
      warmupStartTime: withWarmup ? Date.now() : undefined,
      matchStartedAt: Date.now(),
      coinTossWinner: tossWinner ?? undefined,
      coinTossChoice: firstServe === (tossWinner ?? 'player1') ? 'serve' : 'receive',
      courtChangeByLoser,
      player1Coach: player1Coach || undefined,
      player2Coach: player2Coach || undefined,
      actualStartTime: actualTime,
    });
    if (!ok) {
      throw new Error(t('referee.scoring.conflictError'));
    }
    if (withWarmup) longWhistle(); // warmup start whistle
    else longWhistle(); // match start whistle
  }, [match, updateMatch, tossWinner, courtChangeByLoser, player1Coach, player2Coach, t, longWhistle]);

  // Warmup
  const handleWarmup = useCallback(async () => {
    if (!match || match.warmupUsed) return;
    const currentSetData = match.sets?.[match.currentSet ?? 0];
    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const currentServe = match.currentServe ?? 'player1';
    const serverName = currentServe === 'player1' ? p1Name : p2Name;

    const warmupEntry: ScoreHistoryEntry = {
      time: formatTime(),
      scoringPlayer: '',
      actionPlayer: '',
      actionType: 'warmup_start',
      actionLabel: `${t('referee.scoring.warmupStart')} (60${t('common.time.seconds')})`,
      points: 0,
      set: (match.currentSet ?? 0) + 1,
      server: serverName,
      serveNumber: (match.serveCount ?? 0) + 1,
      scoreBefore: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      scoreAfter: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      serverSide: currentServe,
    };

    const prevHistory = match.scoreHistory ?? [];
    await updateMatch({ warmupUsed: true, warmupStartTime: Date.now(), scoreHistory: [warmupEntry, ...prevHistory] });
    longWhistle(); // warmup start whistle
  }, [match, updateMatch, longWhistle]);

  // Walkover (부전승)
  const handleWalkover = useCallback(async (winnerPlayer: 1 | 2) => {
    if (!match) return;
    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const winnerName = winnerPlayer === 1 ? p1Name : p2Name;
    const loserName = winnerPlayer === 1 ? p2Name : p1Name;

    if (!await showConfirm({ message: `${loserName} → ${winnerName} ${t('common.scoreActions.walkover')}?` })) return;

    const reason = await showPrompt({ message: t('common.scoreActions.walkover'), placeholder: t('common.scoreActions.walkoverReasonPlaceholder') }) || t('common.scoreActions.walkover');

    const winnerId = winnerPlayer === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: winnerName,
      actionPlayer: loserName,
      actionType: 'walkover',
      actionLabel: `${t('common.scoreActions.walkover')} (${reason})`,
      points: 0,
      set: (match.currentSet ?? 0) + 1,
      server: (match.currentServe ?? 'player1') === 'player1' ? p1Name : p2Name,
      serveNumber: (match.serveCount ?? 0) + 1,
      scoreBefore: { player1: match.sets?.[match.currentSet ?? 0]?.player1Score ?? 0, player2: match.sets?.[match.currentSet ?? 0]?.player2Score ?? 0 },
      scoreAfter: { player1: match.sets?.[match.currentSet ?? 0]?.player1Score ?? 0, player2: match.sets?.[match.currentSet ?? 0]?.player2Score ?? 0 },
      serverSide: match.currentServe ?? 'player1',
    });

    const prevHistory = match.scoreHistory ?? [];

    // 부전승 세트 점수: 대회 규칙(스테이지 포함)의 부전승 점수 × 이겨야 하는 세트 수 (기본 11:0, 3세트제 → 2세트)
    const walkoverSets = walkoverSetsFor(match, tournament, winnerPlayer, winnerId);

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
    if (!okWo) { notifyUpdateFailed(); return; }

    setLastAction(`${t('common.scoreActions.walkover')}: ${winnerName} (${reason})`);
    setAnnouncement(`${loserName} ${reason}. ${winnerName} ${t('common.scoreActions.walkover')}`);
  }, [match, updateMatch, tournament]);

  // IBSA score
  const handleIBSAScore = useCallback(async (
    actingPlayer: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!canAct()) return;
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    if (match.activeTimeout) return;
    if (showSetEndConfirm) return;
    if (showSideChange) return;
    if (showWarmup && warmupTimer.isRunning) return;

    // 골든골 모드: goal만 허용. goal이면 즉시 경기 종료.
    if (goldenGoal.isActive) {
      if (actionType !== 'goal') {
        setLastAction(`⚠️ ${t('referee.scoring.goldenGoalOnlyGoal')}`);
        setAnnouncement(t('referee.scoring.goldenGoalOnlyGoal'));
        return;
      }
      const scoringPlayerGG = toOpponent ? (actingPlayer === 1 ? 2 : 1) : actingPlayer;
      const ciGG = match.currentSet;
      const sets = [...match.sets.map(s => ({ ...s }))];
      const csGG = { ...sets[ciGG] };
      const before = { player1: csGG.player1Score, player2: csGG.player2Score };
      const { newScores } = applyGoldenGoalEvent('goal', scoringPlayerGG, before);
      csGG.player1Score = newScores.player1;
      csGG.player2Score = newScores.player2;
      const winnerId = scoringPlayerGG === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      csGG.winnerId = winnerId;
      sets[ciGG] = csGG;
      const p1NameGG = match.player1Name ?? t('referee.home.player1Default');
      const p2NameGG = match.player2Name ?? t('referee.home.player2Default');
      const winnerName = scoringPlayerGG === 1 ? p1NameGG : p2NameGG;
      const histEntry = createScoreHistoryEntry({
        scoringPlayer: winnerName,
        actionPlayer: actingPlayer === 1 ? p1NameGG : p2NameGG,
        actionType: 'goal',
        actionLabel: `${t('referee.scoring.goldenGoalActivated')} - ${label}`,
        points,
        set: ciGG + 1,
        server: (match.currentServe ?? 'player1') === 'player1' ? p1NameGG : p2NameGG,
        serveNumber: (match.serveCount ?? 0) + 1,
        scoreBefore: before,
        scoreAfter: newScores,
        serverSide: match.currentServe ?? 'player1',
      });
      goalWhistle();
      await updateMatch({
        sets,
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
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    // Guard: prevent scoring if current set already has a winner
    if (cs.winnerId || setWinnerByRules(cs.player1Score, cs.player2Score, rules)) return;

    const scoreBefore = { player1: cs.player1Score, player2: cs.player2Score };
    const scoringPlayer = toOpponent ? (actingPlayer === 1 ? 2 : 1) : actingPlayer;

    if (scoringPlayer === 1) cs.player1Score += points;
    else cs.player2Score += points;
    sets[ci] = cs;

    const scoreAfter = { player1: cs.player1Score, player2: cs.player2Score };

    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const currentServe = match.currentServe ?? 'player1';
    const serveCount = match.serveCount ?? 0;
    const serverName = currentServe === 'player1' ? p1Name : p2Name;
    const serveNumber = serveCount + 1;

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: scoringPlayer === 1 ? p1Name : p2Name,
      actionPlayer: actingPlayer === 1 ? p1Name : p2Name,
      actionType, actionLabel: label, points,
      set: ci + 1,
      server: serverName, serveNumber,
      scoreBefore, scoreAfter,
      serverSide: currentServe,
    });

    const prevHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    const newHistory = [historyEntry, ...prevHistory];

    const { currentServe: nextServe, serveCount: nextCount } = advanceServeTurn(currentServe, serveCount, maxServes);

    setScoreFlash(f => f + 1);

    // Whistle: goal (2pt) = goalWhistle, foul/1pt = shortWhistle
    if (actionType === 'goal') goalWhistle();
    else shortWhistle();

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;

    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${pName} +${points}${t('common.units.point')}`
      : `${pName} ${t('common.scoreActions.goal')}! +${points}${t('common.units.point')}`;
    setLastAction(`${actionDesc} | ${scoreAfter.player1} : ${scoreAfter.player2}`);

    const serverScore = nextServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = nextServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;
    setAnnouncement(
      `${pName} ${points}${t('common.units.point')}. ${t('common.matchHistory.score')} ${serverScore} : ${receiverScore}. ${nextServerName} ${t('common.matchHistory.serve')} ${nextCount + 1}/${maxServes}`
    );

    // Set winner check with confirmation dialog
    const setWinner = setWinnerByRules(cs.player1Score, cs.player2Score, rules);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      sets[ci] = cs;

      const matchWinner = matchWinnerByRules(sets, rules);
      if (matchWinner) setTimeout(() => longWhistle(), 500); // match end whistle after score sound

      // Block scoring IMMEDIATELY to prevent race condition during 500ms delay
      setShowSetEndConfirm(true);

      // Save state first
      const ok1 = await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
      });
      if (!ok1) { notifyUpdateFailed(); setShowSetEndConfirm(false); return; }

      // Show dialog message after 500ms delay (dialog already blocks via showSetEndConfirm)
      setTimeout(() => {
        const setWinnerName = setWinner === 1 ? p1Name : p2Name;
        const winScore = setWinner === 1 ? cs.player1Score : cs.player2Score;
        const loseScore = setWinner === 1 ? cs.player2Score : cs.player1Score;
        const setWinsCalc = setWinsByRules(sets, rules);

        if (matchWinner) {
          setSetEndMessage(`🏆 ${setWinnerName}!\n${t('common.matchHistory.score')}: ${winScore} - ${loseScore}\n${t('common.units.set')}: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
          setIsMatchEnd(true);
        } else {
          setSetEndMessage(`${setWinnerName} ${t('common.matchHistory.setLabel', { num: ci + 1 })} ${winScore} - ${loseScore}\n\n${t('common.units.set')}: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
          setIsMatchEnd(false);
        }
      }, 500);
      return;
    }

    // Side change check
    // 사이드 체인지: 결정 세트에서 규칙의 사이드 체인지 점수(기본 ceil(목표/2))에 닿으면
    if (shouldChangeSidesMidSet(cs, sets.slice(0, ci), rules, match.sideChangeUsed ?? false) && !match.activeTimeout) {
      const ok2 = await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
      });
      if (!ok2) { notifyUpdateFailed(); return; }
      setPendingSideChange(true);
      return;
    }

    const ok3 = await updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
    });
    if (!ok3) { notifyUpdateFailed(); return; }
    if (tournamentId) autoBackupDebounced(tournamentId);

    } finally { done(); }
  }, [match, rules, maxServes, updateMatch, canAct, startProcessing, done, sideChangeTimer, tournamentId, showSetEndConfirm, showSideChange, showWarmup, warmupTimer, goalWhistle, shortWhistle]);

  // Confirm set end
  const handleConfirmSetEnd = useCallback(async () => {
    if (!match?.sets) return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet ?? 0;

    // 세트 끝 → 경기 완료 또는 다음 세트 (단체전과 같은 순수 함수: 코트 체인지 + 서브권 교대)
    // IBSA: 이전 세트 첫 서브의 반대 선수가 다음 세트 첫 서브
    const setEnd = setEndOutcome(match, sets, ci, rules, {
      sideIds: [match.player1Id ?? 'player1', match.player2Id ?? 'player2'],
      serverName: side => (side === 'player1' ? match.player1Name ?? '' : match.player2Name ?? ''),
      time: formatTime(),
      sideChangeLabel: t('common.matchHistory.sideChange'),
    });
    if (setEnd?.kind === 'completed') {
      await updateMatch({ sets: setEnd.sets, status: 'completed', winnerId: setEnd.winnerId });
      longWhistle(); // match end whistle
      if (tournamentId) autoBackupToLocal(tournamentId);
    } else if (setEnd?.kind === 'next_set') {
      const prevHistory = match.scoreHistory ?? [];
      await updateMatch({
        sets: setEnd.sets, currentSet: setEnd.currentSet,
        currentServe: setEnd.currentServe, serveCount: setEnd.serveCount,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        sideChangeUsed: setEnd.sideChangeUsed,
        scoreHistory: [setEnd.setStartEntry, ...prevHistory],
      });
      longWhistle(); // court change whistle
      setPendingSideChange(true);
    }
    setShowSetEndConfirm(false);
  }, [match, rules, updateMatch, tournamentId, longWhistle, t]);

  // Undo
  const handleUndo = useCallback(async () => {
    if (!match) return;
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    if (history.length === 0) return;

    const lastEntry = history[0];
    const sets = [...(match.sets ?? []).map(s => ({ ...s }))];
    const ci = match.currentSet ?? 0;
    const cs = { ...sets[ci] };

    cs.player1Score = lastEntry.scoreBefore.player1;
    cs.player2Score = lastEntry.scoreBefore.player2;
    cs.winnerId = null;
    sets[ci] = cs;

    const { currentServe, serveCount } = revertServeTurn(match.currentServe ?? 'player1', match.serveCount ?? 0, maxServes);

    await updateMatch({
      sets, currentServe, serveCount, scoreHistory: history.slice(1),
    });

    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const undoServerName = currentServe === 'player1' ? p1Name : p2Name;
    const msg = `${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}. ${undoServerName} ${t('common.matchHistory.serve')}`;
    setAnnouncement(msg);
    setLastAction(`↩️ ${msg}`);
  }, [match, updateMatch, maxServes]);

  const handleCancelSetEnd = useCallback(async () => {
    setShowSetEndConfirm(false);
    await handleUndo();
  }, [handleUndo]);

  const handleChangeServe = useCallback(async () => {
    if (!match || match.status !== 'in_progress') return;
    await updateMatch({
      currentServe: (match.currentServe ?? 'player1') === 'player1' ? 'player2' : 'player1',
      serveCount: 0,
    });
  }, [match, updateMatch]);

  // Serve Miss - 서브권 있는 선수가 1점 실점 (상대에게 +1)
  const handleServeMiss = useCallback(async () => {
    if (!match) return;
    const servingPlayer = match.currentServe === 'player1' ? 1 : 2;
    const p1 = match.player1Name ?? t('referee.home.player1Default');
    const p2 = match.player2Name ?? t('referee.home.player2Default');
    const sName = servingPlayer === 1 ? p1 : p2;
    await handleIBSAScore(servingPlayer as 1 | 2, 'serve_miss', 1, true, `${sName} ${t('common.scoreActions.serveMiss')}`);
  }, [match, handleIBSAScore, t]);

  // Dead Ball - player: 1 or 2 (who called dead ball)
  const handleDeadBall = useCallback(async (callingPlayer: 1 | 2) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    if (match.activeTimeout) return;

    const currentSetData = match.sets[match.currentSet ?? 0];
    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const currentServe = match.currentServe ?? 'player1';
    const serveCount = match.serveCount ?? 0;
    const sName = currentServe === 'player1' ? p1Name : p2Name;
    const callerName = callingPlayer === 1 ? p1Name : p2Name;
    const scoreBefore = { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 };

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: '',
      actionPlayer: callerName,
      actionType: 'dead_ball',
      actionLabel: t('common.matchHistory.deadBall', { server: callerName }),
      points: 0,
      set: (match.currentSet ?? 0) + 1,
      server: sName,
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
    setLastAction(t('common.matchHistory.deadBall', { server: callerName }));
    setAnnouncement(t('common.matchHistory.deadBall', { server: callerName }));
  }, [match, updateMatch, shortWhistle]);

  // Penalty with warning logic
  const handlePenalty = useCallback(async (
    actingPlayer: 1 | 2,
    penaltyType: 'penalty_table_pushing' | 'penalty_electronic' | 'penalty_talking',
  ) => {
    // Note: canAct() is NOT called here to avoid double-guard with handleIBSAScore
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress') return;
    if (match.activeTimeout) return;
    if (showSetEndConfirm || showSideChange) return;
    if (showWarmup && warmupTimer.isRunning) return;

    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const actorName = actingPlayer === 1 ? p1Name : p2Name;

    const penaltyLabels: Record<string, string> = {
      penalty_table_pushing: t('common.scoreActions.penaltyTablePushing'),
      penalty_electronic: t('common.scoreActions.penaltyElectronic'),
      penalty_talking: t('common.scoreActions.penaltyTalking'),
    };
    const label = penaltyLabels[penaltyType];

    const totalPenaltyCount = (match.scoreHistory || []).filter(h =>
      h.actionType === penaltyType && h.actionPlayer === actorName
    ).length;
    const { isWarning: isWarningAction, points: penaltyPoints } = getPenaltyAction(penaltyType, totalPenaltyCount);

    if (isWarningAction) {
      // Warning only - no points
      const currentSetData = match.sets[match.currentSet];
      const scoreBefore = { player1: currentSetData.player1Score, player2: currentSetData.player2Score };
      const currentServe = match.currentServe ?? 'player1';
      const serveCount = match.serveCount ?? 0;
      const serverName = currentServe === 'player1' ? p1Name : p2Name;

      const historyEntry: ScoreHistoryEntry = {
        time: formatTime(),
        scoringPlayer: '',
        actionPlayer: actorName,
        actionType: penaltyType,
        actionLabel: `${label} ${t('common.matchHistory.warning', { player: '', action: '' }).trim()}`,
        points: 0,
        set: (match.currentSet ?? 0) + 1,
        server: serverName,
        serveNumber: serveCount + 1,
        scoreBefore,
        scoreAfter: scoreBefore,
        serverSide: currentServe,
        penaltyWarning: true,
      };

      const prevHistory = match.scoreHistory ?? [];
      await updateMatch({ scoreHistory: [historyEntry, ...prevHistory] });
      shortWhistle(); // warning whistle
      setLastAction(t('common.matchHistory.warning', { player: actorName, action: label }));
      setAnnouncement(t('common.matchHistory.warning', { player: actorName, action: label }));
    } else {
      await handleIBSAScore(actingPlayer, penaltyType, penaltyPoints, true, `${actorName} ${label}`);
    }

    setPenaltyDropdown(null);
  }, [match, handleIBSAScore, updateMatch, showSetEndConfirm, showSideChange, showWarmup, warmupTimer, shortWhistle]);

  // Quick foul: 1-tap generic foul (+1 to opponent), then optional classify
  const handleQuickFoul = useCallback(async (actingPlayer: 1 | 2) => {
    const p1Name = match?.player1Name ?? t('referee.home.player1Default');
    const p2Name = match?.player2Name ?? t('referee.home.player2Default');
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    await handleIBSAScore(actingPlayer, 'foul', 1, true, `${actorName} ${t('common.scoreActions.foul')}`);
    setFoulClassify({ player: actingPlayer });
  }, [match, handleIBSAScore, t]);

  // Classify a previously recorded foul (update the last history entry)
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

  // Timeout with type
  const handleTimeout = useCallback(async (player: 1 | 2, timeoutType: 'player' | 'medical' | 'referee') => {
    if (!match || match.status !== 'in_progress') return;

    // Player timeout: limited to 1 per match per player
    if (timeoutType === 'player') {
      const usedTimeouts = player === 1 ? (match.player1Timeouts ?? 0) : (match.player2Timeouts ?? 0);
      if (usedTimeouts >= 1) return;
    }
    // Medical timeout: limited to 1 per match per player
    if (timeoutType === 'medical') {
      const playerName = player === 1 ? (match.player1Name ?? t('referee.home.player1Default')) : (match.player2Name ?? t('referee.home.player2Default'));
      const medicalUsed = (match.scoreHistory || []).filter(h =>
        h.actionType === 'timeout_medical' && h.actionPlayer === playerName
      ).length;
      if (medicalUsed >= 1) return;
    }

    const playerId = player === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
    const playerName = player === 1 ? (match.player1Name ?? t('referee.home.player1Default')) : (match.player2Name ?? t('referee.home.player2Default'));
    const currentSetData = match.sets?.[match.currentSet ?? 0];

    const actionTypeMap: Record<string, ScoreActionType> = {
      player: 'timeout_player',
      medical: 'timeout_medical',
      referee: 'timeout_referee',
    };
    const labelMap: Record<string, string> = {
      player: `${t('referee.scoring.timeoutTitle.player')} (1${t('common.time.minutes')})`,
      medical: `${t('referee.scoring.timeoutTitle.medical')} (5${t('common.time.minutes')})`,
      referee: t('referee.scoring.timeoutTitle.referee'),
    };

    const timeoutEntry: ScoreHistoryEntry = {
      time: formatTime(),
      set: (match.currentSet ?? 0) + 1,
      scoringPlayer: '',
      actionPlayer: playerName,
      actionType: actionTypeMap[timeoutType],
      actionLabel: labelMap[timeoutType],
      points: 0,
      scoreBefore: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      scoreAfter: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      server: match.currentServe === 'player1' ? (match.player1Name ?? '') : (match.player2Name ?? ''),
      serveNumber: (match.serveCount ?? 0) + 1,
      serverSide: match.currentServe ?? 'player1',
    };
    const prevHistory = match.scoreHistory ?? [];
    const timeoutUpdate: Record<string, unknown> = {
      activeTimeout: { playerId, startTime: Date.now(), type: timeoutType },
      scoreHistory: [timeoutEntry, ...prevHistory],
    };
    if (timeoutType === 'player') {
      if (player === 1) timeoutUpdate.player1Timeouts = (match.player1Timeouts ?? 0) + 1;
      else timeoutUpdate.player2Timeouts = (match.player2Timeouts ?? 0) + 1;
    }
    await updateMatch(timeoutUpdate);
    longWhistle(); // timeout start whistle
  }, [match, updateMatch, longWhistle]);

  // Derived values
  const player1Name = match?.player1Name ?? t('referee.home.player1Default');
  const player2Name = match?.player2Name ?? t('referee.home.player2Default');

  const sets = Array.isArray(match?.sets) && match!.sets!.length > 0 ? match!.sets! : [createEmptySet()];
  const currentSetIndex = match?.currentSet ?? 0;
  const currentSet = sets[currentSetIndex] ?? createEmptySet();
  const setWins = setWinsByRules(sets, rules);
  const currentServe = match?.currentServe ?? 'player1';
  const serveCountVal = match?.serveCount ?? 0;
  const serverName = currentServe === 'player1' ? player1Name : player2Name;
  const history: ScoreHistoryEntry[] = match?.scoreHistory ?? [];

  const p1TimeoutsUsed = match?.player1Timeouts ?? 0;
  const p2TimeoutsUsed = match?.player2Timeouts ?? 0;

  // W/P counts from score history (current set only)
  const currentSetHistory = history.filter(h => h.set === currentSetIndex + 1);
  const p1PenaltyCounts = computePenaltyCounts(currentSetHistory, player1Name);
  const p2PenaltyCounts = computePenaltyCounts(currentSetHistory, player2Name);
  const p1Warnings = p1PenaltyCounts.warnings;
  const p2Warnings = p2PenaltyCounts.warnings;
  const p1Penalties = p1PenaltyCounts.penalties;
  const p2Penalties = p2PenaltyCounts.penalties;

  const scoringDisabled = !!match?.activeTimeout || showSideChange || pendingSideChange || (showWarmup && warmupTimer.isRunning);
  const nonGoalDisabled = scoringDisabled || goldenGoal.isActive;

  return {
    // data
    match, matchLoading, tournament, updateMatch,
    player1Name, player2Name,
    // 경기 규칙 (resolveMatchScoring)
    rules,
    // state + setters
    announcement, lastAction, setLastAction,
    scoreFlash,
    showHistory, setShowHistory,
    showSetEndConfirm, setEndMessage, isMatchEnd,
    pendingSideChange, setPendingSideChange,
    sideChangeDismissed, setSideChangeDismissed,
    coinTossStep, setCoinTossStep,
    tossWinner, setTossWinner,
    pendingFirstServe, setPendingFirstServe,
    courtChangeByLoser, setCourtChangeByLoser,
    player1Coach, setPlayer1Coach,
    player2Coach, setPlayer2Coach,
    syncCoachToFirebase,
    penaltyDropdown, setPenaltyDropdown,
    penaltyDropdownRef,
    expandedSection, toggleSection,
    foulClassify, setFoulClassify,
    // timers & audio
    sideChangeTimer, warmupTimer, timeoutTimer,
    shortWhistle, longWhistle, goalWhistle, initAudio,
    // golden goal
    goldenGoal,
    // focus trap
    setEndTrapRef,
    // derived modal visibility
    showWarmup, showSideChange,
    // handlers
    handleStartMatch, handleWarmup, handleWalkover,
    handleIBSAScore, handleConfirmSetEnd, handleCancelSetEnd,
    handleUndo, handleChangeServe,
    handleServeMiss, handleDeadBall, handleTimeout,
    handlePenalty, handleQuickFoul, handleClassifyFoul,
    notifyUpdateFailed,
    // derived values
    sets, currentSetIndex, currentSet, setWins,
    currentServe, serveCountVal, serverName, maxServes,
    history,
    p1TimeoutsUsed, p2TimeoutsUsed,
    p1Warnings, p2Warnings, p1Penalties, p2Penalties,
    scoringDisabled, nonGoalDisabled,
  };
}
