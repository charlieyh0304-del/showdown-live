import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMatch, useTournament } from '@shared/hooks/useFirebase';
import {
  checkSetWinner,
  checkMatchWinner,
  createEmptySet,
  getEffectiveGameConfig,
  getEffectiveScoringRules,
  countSetWins,
  advanceServe,
  revertServe,
  shouldSideChange,
  createScoreHistoryEntry,
  getMaxServes,
} from '@shared/utils/scoring';
import { formatTime, speak } from '@shared/utils/locale';
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { IBSA_SCORE_ACTIONS } from '@shared/types';
import type { SetScore, ScoreActionType, ScoreHistoryEntry } from '@shared/types';
import { autoBackupDebounced, autoBackupToLocal } from '@shared/utils/backup';
import { useCountdownTimer } from '../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../hooks/useDoubleClickGuard';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useWhistle } from '@shared/hooks/useWhistle';
import TimerModal from '../components/TimerModal';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import ActionToast from '../components/ActionToast';
import ScoresheetGrid from '../components/ScoresheetGrid';

type PenaltyDropdownKey = 'player1' | 'player2' | null;

// Referee timeout elapsed timer component
function TimeoutModal({ match, player1Name, player2Name, timeoutTimer, onClose }: {
  match: { activeTimeout?: { playerId: string; startTime: number; type?: 'player' | 'medical' | 'referee' } | null; player1Id?: string };
  player1Name: string;
  player2Name: string;
  timeoutTimer: { seconds: number; isRunning: boolean; isWarning: boolean; stop: () => void };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toType = match.activeTimeout?.type ?? 'player';
  const playerName = match.activeTimeout?.playerId === match.player1Id ? player1Name : player2Name;
  const [elapsed, setElapsed] = useState(0);
  const trapRef = useFocusTrap(true, onClose);

  useEffect(() => {
    if (toType !== 'referee' || !match.activeTimeout) return;
    const startTime = match.activeTimeout.startTime;
    setElapsed(Math.floor((Date.now() - startTime) / 1000));
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [toType, match.activeTimeout]);

  const titleMap: Record<string, string> = {
    player: t('referee.scoring.timeoutTitle.player'),
    medical: t('referee.scoring.timeoutTitle.medical'),
    referee: t('referee.scoring.timeoutTitle.referee'),
  };

  if (toType === 'referee') {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const display = `${mins}:${secs.toString().padStart(2, '0')}`;
    return (
      <div className="modal-backdrop" style={{ zIndex: 100 }}>
        <div ref={trapRef} className="flex flex-col items-center gap-6 p-8" role="dialog" aria-modal="true" aria-label={titleMap[toType]}>
          <h2 className="text-3xl font-bold text-yellow-400">{titleMap[toType]}</h2>
          <div className="text-8xl font-bold my-4 text-white" aria-live="polite" aria-label={`${t('referee.scoring.elapsedTime')} ${display}`}>
            {display}
          </div>
          <p className="text-xl text-gray-300">{playerName} ({t('referee.scoring.elapsedTime')})</p>
          <button className="btn btn-danger btn-large" onClick={onClose} aria-label={t('referee.scoring.timeoutEnd')}>
            {t('referee.scoring.timeoutEnd')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <TimerModal
      title={titleMap[toType]}
      seconds={timeoutTimer.seconds}
      isWarning={timeoutTimer.isWarning}
      subtitle={playerName}
      onClose={onClose}
      closeLabel={t('referee.scoring.timeoutEnd')}
    />
  );
}

export default function IndividualScoring() {
  const { t } = useTranslation();
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);

  const { canAct, startProcessing, done } = useDoubleClickGuard();
  const { shortWhistle, longWhistle, goalWhistle } = useWhistle();

  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [showSetEndConfirm, setShowSetEndConfirm] = useState(false);
  const [setEndMessage, setSetEndMessage] = useState('');
  const [isMatchEnd, setIsMatchEnd] = useState(false);
  // Warmup & SideChange derived from Firebase state
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
      updateMatch({ [field]: value || undefined });
    }, 500);
  }, [updateMatch]);
  // Pause - derived from Firebase match.isPaused
  const [pauseElapsed, setPauseElapsed] = useState(0);
  // Penalty & timeout dropdowns
  const [penaltyDropdown, setPenaltyDropdown] = useState<PenaltyDropdownKey>(null);
  const penaltyDropdownRef = useRef<HTMLDivElement>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const toggleSection = (key: string) => setExpandedSection(prev => prev === key ? null : key);
  const [actionSheetPlayer, setActionSheetPlayer] = useState<1 | 2 | null>(null);

  const gameConfig = match && tournament
    ? getEffectiveScoringRules(match, tournament)
    : getEffectiveGameConfig(tournament?.scoringRules || tournament?.gameConfig);
  useNavigationGuard(match?.status === 'in_progress');
  const setEndTrapRef = useFocusTrap(showSetEndConfirm);

  // Timers - driven by Firebase timestamps
  const sideChangeTimer = useCountdownTimer(() => {
    if (match) updateMatch({ sideChangeStartTime: undefined });
  });
  const warmupTimer = useCountdownTimer(() => {
    if (match) updateMatch({ warmupStartTime: undefined });
  });
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
  });

  // Derive modal visibility from Firebase state
  const showWarmup = !!(match?.warmupStartTime);
  const showSideChange = !!(match?.sideChangeStartTime);
  const isPausedLocal = !!(match?.isPaused);

  // 15초 안내 (타임아웃) - activeTimeout 존재 여부도 체크하여 종료 후 오출력 방지
  const timeoutAlerted = useRef(false);
  useEffect(() => {
    if (!timeoutTimer.isRunning || !match?.activeTimeout) {
      timeoutAlerted.current = false;
      return;
    }
    if (timeoutTimer.seconds === 15 && !timeoutAlerted.current) {
      timeoutAlerted.current = true;
      setLastAction(`⚠️ ${t('referee.scoring.fifteenSecondsLeft')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [timeoutTimer.seconds, timeoutTimer.isRunning, match?.activeTimeout]);

  // 15초 안내 (사이드 체인지) - sideChangeStartTime 존재 여부도 체크
  const sideChangeAlerted = useRef(false);
  useEffect(() => {
    if (!sideChangeTimer.isRunning || !match?.sideChangeStartTime) {
      sideChangeAlerted.current = false;
      return;
    }
    if (sideChangeTimer.seconds === 15 && !sideChangeAlerted.current) {
      sideChangeAlerted.current = true;
      setLastAction(`⚠️ ${t('referee.scoring.sideChangeFifteenSeconds')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [sideChangeTimer.seconds, sideChangeTimer.isRunning, match?.sideChangeStartTime]);

  // 15초 안내 (워밍업) - warmupStartTime 존재 여부도 체크
  const warmupAlerted = useRef(false);
  useEffect(() => {
    if (!warmupTimer.isRunning || !match?.warmupStartTime) {
      warmupAlerted.current = false;
      return;
    }
    if (warmupTimer.seconds === 15 && !warmupAlerted.current) {
      warmupAlerted.current = true;
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
      else if (remaining <= 0) updateMatch({ warmupStartTime: undefined });
    } else {
      warmupTimer.stop();
    }
  }, [match?.warmupStartTime]);

  // Sync sideChange timer from Firebase
  useEffect(() => {
    if (match?.sideChangeStartTime) {
      const elapsed = Math.floor((Date.now() - match.sideChangeStartTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      if (remaining > 0 && !sideChangeTimer.isRunning) sideChangeTimer.start(remaining);
      else if (remaining <= 0) updateMatch({ sideChangeStartTime: undefined });
    } else {
      sideChangeTimer.stop();
    }
  }, [match?.sideChangeStartTime]);

  // Start timeout timer when activeTimeout changes
  useEffect(() => {
    if (match?.activeTimeout) {
      const toType = match.activeTimeout.type ?? 'player';
      if (toType === 'referee') {
        timeoutTimer.stop();
      } else {
        const duration = toType === 'medical' ? 300 : 60;
        const elapsed = Math.floor((Date.now() - match.activeTimeout.startTime) / 1000);
        const remaining = Math.max(0, duration - elapsed);
        if (remaining > 0 && !timeoutTimer.isRunning) {
          timeoutTimer.start(remaining);
        } else if (remaining <= 0) {
          // 이미 시간 초과 (화면 복귀 시) - 타이머 시작하지 않고 즉시 해제
          timeoutTimer.stop();
          updateMatch({ activeTimeout: null });
        }
      }
    } else {
      timeoutTimer.stop();
    }
  }, [match?.activeTimeout]);

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

  // Pause elapsed time counter - derived from Firebase pauseStartTime
  useEffect(() => {
    if (!isPausedLocal || !match?.pauseStartTime) { setPauseElapsed(0); return; }
    setPauseElapsed(Math.floor((Date.now() - match.pauseStartTime) / 1000));
    const interval = setInterval(() => {
      setPauseElapsed(Math.floor((Date.now() - match.pauseStartTime!) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPausedLocal, match?.pauseStartTime]);

  // Sync coach from match (always prefer Firebase value)
  useEffect(() => {
    if (match?.player1Coach !== undefined && match.player1Coach !== player1Coach) setPlayer1Coach(match.player1Coach);
    if (match?.player2Coach !== undefined && match.player2Coach !== player2Coach) setPlayer2Coach(match.player2Coach);
  }, [match?.player1Coach, match?.player2Coach]);

  // Save/clear active match in localStorage for session recovery
  useEffect(() => {
    if (match?.status === 'in_progress') {
      localStorage.setItem('showdown_active_match', JSON.stringify({ tournamentId, matchId }));
    }
    if (match?.status === 'completed') {
      localStorage.removeItem('showdown_active_match');
    }
  }, [match?.status, tournamentId, matchId]);

  const handleStartMatch = useCallback(async (firstServe: 'player1' | 'player2', withWarmup = false) => {
    if (!match) return;
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

  // Pause
  const handlePause = useCallback(async () => {
    if (!match || match.status !== 'in_progress' || isPausedLocal) return;
    const reason = prompt(t('referee.scoring.pausePrompt'));
    if (reason === null) return;
    const pauseEntry = {
      time: formatTime(),
      reason: reason || t('referee.scoring.noReason'),
      set: (match.currentSet ?? 0) + 1,
    };
    const prevPauseHistory = match.pauseHistory ?? [];
    const currentSetData = match.sets?.[match.currentSet ?? 0];
    const pauseHistoryEntry: ScoreHistoryEntry = {
      time: formatTime(),
      set: (match.currentSet ?? 0) + 1,
      scoringPlayer: '',
      actionPlayer: reason || t('referee.scoring.noReason'),
      actionType: 'pause' as ScoreActionType,
      actionLabel: t('common.matchHistory.pause', { player: '' }),
      points: 0,
      scoreBefore: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      scoreAfter: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      server: match.currentServe === 'player1' ? (match.player1Name ?? '') : (match.player2Name ?? ''),
      serveNumber: (match.serveCount ?? 0) + 1,
      serverSide: match.currentServe ?? 'player1',
    };
    const prevScoreHistory = match.scoreHistory ?? [];
    await updateMatch({
      isPaused: true, pauseReason: reason || t('referee.scoring.noReason'), pauseStartTime: Date.now(),
      pauseHistory: [...prevPauseHistory, pauseEntry],
      scoreHistory: [pauseHistoryEntry, ...prevScoreHistory],
    });
  }, [match, updateMatch, isPausedLocal]);

  const handleResume = useCallback(async () => {
    if (!match) return;
    const prevPauseHistory = match.pauseHistory ?? [];
    const updated = [...prevPauseHistory];
    if (updated.length > 0) {
      updated[updated.length - 1] = { ...updated[updated.length - 1], duration: pauseElapsed };
    }
    const currentSetData = match.sets?.[match.currentSet ?? 0];
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
      server: match.currentServe === 'player1' ? (match.player1Name ?? '') : (match.player2Name ?? ''),
      serveNumber: (match.serveCount ?? 0) + 1,
      serverSide: match.currentServe ?? 'player1',
    };
    const prevScoreHistory = match.scoreHistory ?? [];
    await updateMatch({ isPaused: false, pauseReason: '', pauseStartTime: undefined, pauseHistory: updated, scoreHistory: [resumeHistoryEntry, ...prevScoreHistory] });
  }, [match, updateMatch, pauseElapsed]);

  // Walkover (부전승)
  const handleWalkover = useCallback(async (winnerPlayer: 1 | 2) => {
    if (!match) return;
    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const winnerName = winnerPlayer === 1 ? p1Name : p2Name;
    const loserName = winnerPlayer === 1 ? p2Name : p1Name;

    if (!window.confirm(`${loserName} → ${winnerName} ${t('common.scoreActions.walkover')}?`)) return;

    const reason = prompt(`${t('common.scoreActions.walkover')}`) || t('common.scoreActions.walkover');

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

    // 부전승 세트 점수: setsToWin 만큼 세트 생성 (예: 3세트→2세트, 5세트→3세트)
    const gameConfig = getEffectiveGameConfig(tournament?.gameConfig);
    const winScore = gameConfig.POINTS_TO_WIN;
    const walkoverSets = Array.from({ length: gameConfig.SETS_TO_WIN }, () => ({
      ...createEmptySet(),
      player1Score: winnerPlayer === 1 ? winScore : 0,
      player2Score: winnerPlayer === 2 ? winScore : 0,
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
    actingPlayer: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!canAct()) return;
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout) return;
    if (showSetEndConfirm) return;
    if (showSideChange) return;
    if (showWarmup && warmupTimer.isRunning) return;

    startProcessing();
    try {

    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    // Guard: prevent scoring if current set already has a winner
    if (cs.winnerId || checkSetWinner(cs.player1Score, cs.player2Score, gameConfig)) return;

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

    const { currentServe: nextServe, serveCount: nextCount } = advanceServe(
      currentServe, serveCount, 'individual',
    );

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
      `${pName} ${points}${t('common.units.point')}. ${t('common.matchHistory.score')} ${serverScore} : ${receiverScore}. ${t('referee.scoring.firstServe', { name: nextServerName })}`
    );

    // Set winner check with confirmation dialog
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, gameConfig);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, gameConfig);
      if (matchWinner) setTimeout(() => longWhistle(), 500); // match end whistle after score sound

      // Block scoring IMMEDIATELY to prevent race condition during 500ms delay
      setShowSetEndConfirm(true);

      // Save state first
      const ok1 = await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
      });
      if (!ok1) { setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨')); setShowSetEndConfirm(false); return; }

      // Show dialog message after 500ms delay (dialog already blocks via showSetEndConfirm)
      setTimeout(() => {
        if (matchWinner) {
          const winnerName = matchWinner === 1 ? p1Name : p2Name;
          const setWinsCalc = countSetWins(sets, gameConfig);
          setSetEndMessage(`${winnerName}! (${t('common.units.set')} ${setWinsCalc.player1}:${setWinsCalc.player2})\n${t('common.matchHistory.score')}: ${cs.player1Score} - ${cs.player2Score}`);
          setIsMatchEnd(true);
        } else {
          const setWinsCalc = countSetWins(sets, gameConfig);
          setSetEndMessage(`${t('common.matchHistory.setLabel', { num: ci + 1 })}?\n\n${t('common.matchHistory.score')}: ${cs.player1Score} - ${cs.player2Score}\n${t('common.units.set')}: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
          setIsMatchEnd(false);
        }
      }, 500);
      return;
    }

    // Side change check
    if (shouldSideChange('individual', cs, match.sideChangeUsed ?? false, sets, gameConfig) && !match.activeTimeout) {
      const ok2 = await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, sideChangeStartTime: Date.now(), scoreHistory: newHistory,
      });
      if (!ok2) { setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨')); return; }
      return;
    }

    const ok3 = await updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
    });
    if (!ok3) { setLastAction('⚠️ ' + t('referee.scoring.conflictError', '데이터 충돌 - 새로고침됨')); return; }
    if (tournamentId) autoBackupDebounced(tournamentId);

    } finally { done(); }
  }, [match, gameConfig, updateMatch, canAct, startProcessing, done, sideChangeTimer, tournamentId, showSetEndConfirm, showSideChange, showWarmup, warmupTimer, goalWhistle, shortWhistle]);

  // Confirm set end
  const handleConfirmSetEnd = useCallback(async () => {
    if (!match?.sets) return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet ?? 0;

    const matchWinner = checkMatchWinner(sets, gameConfig);
    if (matchWinner) {
      const winnerId = matchWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      await updateMatch({ sets, status: 'completed', winnerId });
      longWhistle(); // match end whistle
      if (tournamentId) autoBackupToLocal(tournamentId);
    } else {
      // 세트 전환: 코트 체인지 + 1분 휴식
      sets.push(createEmptySet());
      const p1Name = match.player1Name ?? '';
      const p2Name = match.player2Name ?? '';
      const currentServe = match.currentServe ?? 'player1';
      const serverName = currentServe === 'player1' ? p1Name : p2Name;
      const sideChangeEntry: ScoreHistoryEntry = {
        time: formatTime(),
        set: ci + 2,
        scoringPlayer: '',
        actionPlayer: '',
        actionType: 'side_change' as ScoreActionType,
        actionLabel: t('common.matchHistory.sideChange'),
        points: 0,
        scoreBefore: { player1: 0, player2: 0 },
        scoreAfter: { player1: 0, player2: 0 },
        server: serverName,
        serveNumber: 1,
        serverSide: currentServe,
      };
      const prevHistory = match.scoreHistory ?? [];
      await updateMatch({
        sets, currentSet: ci + 1,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        sideChangeUsed: false,
        sideChangeStartTime: Date.now(),
        scoreHistory: [sideChangeEntry, ...prevHistory],
      });
      longWhistle(); // court change whistle
    }
    setShowSetEndConfirm(false);
  }, [match, gameConfig, updateMatch, tournamentId, longWhistle, t]);

  const handleCancelSetEnd = useCallback(() => {
    setShowSetEndConfirm(false);
  }, []);

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

    const { currentServe, serveCount } = revertServe(
      match.currentServe ?? 'player1', match.serveCount ?? 0, 'individual',
    );

    await updateMatch({
      sets, currentServe, serveCount, scoreHistory: history.slice(1),
    });

    const p1Name = match.player1Name ?? t('referee.home.player1Default');
    const p2Name = match.player2Name ?? t('referee.home.player2Default');
    const undoServerName = currentServe === 'player1' ? p1Name : p2Name;
    const msg = `${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}. ${undoServerName} ${t('common.matchHistory.serve')}`;
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

  // Dead Ball - player: 1 or 2 (who called dead ball)
  const handleDeadBall = useCallback(async (callingPlayer: 1 | 2) => {
    if (!match?.sets || match.currentSet === undefined) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
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
    if (match.status !== 'in_progress' || match.isPaused) return;
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

    // Count ALL entries (warning + deduction) for this player & penalty type
    const totalPenaltyCount = (match.scoreHistory || []).filter(h =>
      h.actionType === penaltyType &&
      h.actionPlayer === actorName
    ).length;

    // Determine if this is a warning or point deduction
    // Cycle: warning(0) → deduction(1) → warning(2) → deduction(3) → ...
    const hasWarningPhase = penaltyType !== 'penalty_electronic'; // electronic is always immediate
    const isWarningAction = hasWarningPhase && (totalPenaltyCount % 2 === 0);

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
      // Point deduction - penalty_talking: 1점, others: 2점
      const penaltyPoints = penaltyType === 'penalty_talking' ? 1 : 2;
      await handleIBSAScore(actingPlayer, penaltyType, penaltyPoints, true, `${actorName} ${label}`);
    }

    setPenaltyDropdown(null);
  }, [match, handleIBSAScore, updateMatch, showSetEndConfirm, showSideChange, showWarmup, warmupTimer, shortWhistle]);

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

  if (matchLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-2xl text-gray-400 animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-2xl text-red-400">{t('spectator.liveMatch.notFound')}</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    );
  }

  const player1Name = match.player1Name ?? t('referee.home.player1Default');
  const player2Name = match.player2Name ?? t('referee.home.player2Default');

  // ===== PENDING: serve selection =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('referee.scoring.matchStartLabel')}</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{player1Name}</span>
          <span className="text-gray-400">vs</span>
          <span className="text-cyan-400 font-bold">{player2Name}</span>
        </div>
        {match.courtName && <p className="text-gray-400 text-lg">{t('referee.home.court')}: {match.courtName}</p>}

        <div className="card w-full max-w-md space-y-3">
          <h2 className="text-lg font-bold text-center text-gray-300">{t('referee.practice.setup.coachOptional')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-yellow-400 mb-1">{player1Name}</label>
              <input
                type="text"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                placeholder={t('referee.practice.setup.coachAriaLabel')}
                value={player1Coach}
                onChange={e => { setPlayer1Coach(e.target.value); syncCoachToFirebase('player1Coach', e.target.value); }}
              />
            </div>
            <div>
              <label className="block text-sm text-cyan-400 mb-1">{player2Name}</label>
              <input
                type="text"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                placeholder={t('referee.practice.setup.coachAriaLabel')}
                value={player2Coach}
                onChange={e => { setPlayer2Coach(e.target.value); syncCoachToFirebase('player2Coach', e.target.value); }}
              />
            </div>
          </div>
        </div>

        {coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.coinToss')}</h2>
            <div className="flex gap-4">
              <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { setTossWinner('player1'); setCoinTossStep('choice'); }}>
                {player1Name}
              </button>
              <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { setTossWinner('player2'); setCoinTossStep('choice'); }}>
                {player2Name}
              </button>
            </div>
          </div>
        )}
        {coinTossStep === 'choice' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">
              {tossWinner === 'player1' ? player1Name : player2Name}!
            </h2>
            <p className="text-gray-400 text-center">{t('referee.scoring.serveChoice')} / {t('referee.scoring.receiveChoice')}</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'player1' ? player1Name : player2Name} ${t('referee.scoring.serveChoice')}`}>
                {t('referee.scoring.serveChoice')}
              </button>
              <button className="btn btn-accent btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner === 'player1' ? 'player2' : 'player1'); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'player1' ? player1Name : player2Name} ${t('referee.scoring.receiveChoice')}`}>
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
              {t('referee.scoring.courtChangeQuestion', { loser: tossWinner === 'player1' ? player2Name : player1Name })}
            </p>
            <div className="flex gap-4" role="group" aria-label={t('referee.scoring.courtChangeAriaLabel')}>
              <button
                className="btn btn-primary btn-large flex-1 text-xl py-6"
                onClick={() => { setCourtChangeByLoser(true); setCoinTossStep('warmup_ask'); }}
                aria-label={`${tossWinner === 'player1' ? player2Name : player1Name}: ${t('referee.scoring.courtChangeYesButton')}`}
              >
                {t('referee.scoring.courtChangeYesButton')}
              </button>
              <button
                className="btn bg-gray-700 text-white btn-large flex-1 text-xl py-6"
                onClick={() => { setCourtChangeByLoser(false); setCoinTossStep('warmup_ask'); }}
                aria-label={`${tossWinner === 'player1' ? player2Name : player1Name}: ${t('referee.scoring.courtChangeNoButton')}`}
              >
                {t('referee.scoring.courtChangeNoButton')}
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => setCoinTossStep('choice')} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        )}
        {coinTossStep === 'warmup_ask' && pendingFirstServe && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.warmupStart')}</h2>
            <p className="text-gray-400 text-center">{t('referee.scoring.warmupStart')} (60{t('common.time.seconds')})?</p>
            <div className="flex gap-4">
              <button
                className="btn btn-success btn-large flex-1 text-xl py-6"
                onClick={async () => {
                  try {
                    await handleStartMatch(pendingFirstServe!, true);
                  } catch (err) {
                    alert(String(err));
                  }
                }}
                aria-label={t('referee.scoring.warmupStart')}
              >
                {t('referee.scoring.warmupStart')}
              </button>
              <button
                className="btn btn-accent btn-large flex-1 text-xl py-6"
                onClick={async () => {
                  try {
                    await handleStartMatch(pendingFirstServe!);
                  } catch (err) {
                    alert(String(err));
                  }
                }}
                aria-label={t('referee.scoring.matchStartLabel')}
              >
                {t('referee.scoring.matchStartLabel')}
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('choice'); setPendingFirstServe(null); }} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
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
                {player1Name} {t('common.scoreActions.walkover')}
              </button>
              <button
                className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
                onClick={() => handleWalkover(2)}
              >
                {player2Name} {t('common.scoreActions.walkover')}
              </button>
            </div>
          </div>
        </div>

        <button className="btn btn-accent" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    );
  }

  // ===== COMPLETED =====
  if (match.status === 'completed') {
    const isP2Winner = match.winnerId === match.player2Id;
    const winnerName = isP2Winner ? player2Name : player1Name;
    const loserName = isP2Winner ? player1Name : player2Name;
    const setWins = Array.isArray(match.sets) && match.sets.length > 0 ? countSetWins(match.sets, gameConfig) : { player1: 0, player2: 0 };
    const winSets = isP2Winner ? setWins.player2 : setWins.player1;
    const loseSets = isP2Winner ? setWins.player1 : setWins.player2;
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    return (
      <div className="min-h-screen flex flex-col p-4">
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-yellow-400">{t('common.matchStatus.completed')}</h1>
          <div className="text-4xl font-bold text-green-400 mt-2" role="status" aria-live="assertive">🏆 {winnerName}!</div>
          <div className="text-2xl text-gray-300 mt-1" aria-label={`${t('common.units.set')} ${winSets} : ${loseSets}`}>{t('common.units.set')}: {winSets} - {loseSets}</div>
        </div>
        {/* 세트별 결과 - 승자 점수가 먼저 */}
        {match.sets && match.sets.length > 0 && (
          <div className="w-full max-w-lg mx-auto mb-4">
            <div className="grid grid-cols-1 gap-2">
              {match.sets.map((s: SetScore, i: number) => {
                const setWinScore = isP2Winner ? s.player2Score : s.player1Score;
                const setLoseScore = isP2Winner ? s.player1Score : s.player2Score;
                const setWinnerName = s.player1Score > s.player2Score ? player1Name : player2Name;
                return (
                  <div key={i} className="flex justify-between items-center bg-gray-800 rounded px-4 py-2" aria-label={`${t('common.matchHistory.setLabel', { num: i + 1 })}: ${winnerName} ${setWinScore} : ${loserName} ${setLoseScore}`}>
                    <span className="text-sm text-gray-400">{t('common.matchHistory.setLabel', { num: i + 1 })}</span>
                    <span className="text-lg font-bold">
                      <span className="text-green-400">{setWinScore}</span>
                      <span className="text-gray-400"> - </span>
                      <span className="text-gray-300">{setLoseScore}</span>
                    </span>
                    <span className="text-sm text-green-400">🏆 {setWinnerName}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 상세 경기 기록 - 관람 모드와 동일한 형식 */}
        {history.length > 0 && (
          <div className="w-full max-w-lg mx-auto flex-1 min-h-0">
            <ScoreHistoryView history={history} sets={match.sets ?? []} />
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
  const currentSetIndex = match.currentSet ?? 0;
  const currentSet = sets[currentSetIndex] ?? createEmptySet();
  const setWins = countSetWins(sets, gameConfig);
  const currentServe = match.currentServe ?? 'player1';
  const serveCountVal = match.serveCount ?? 0;
  const serverName = currentServe === 'player1' ? player1Name : player2Name;
  const maxServes = getMaxServes('individual');
  const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];

  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);

  const p1TimeoutsUsed = match.player1Timeouts ?? 0;
  const p2TimeoutsUsed = match.player2Timeouts ?? 0;

  // W/P/T.O. counts from score history (current set only)
  const currentSetHistory = history.filter(h => h.set === currentSetIndex + 1);
  const p1Warnings = currentSetHistory.filter(h => h.penaltyWarning && h.actionPlayer === player1Name).length;
  const p2Warnings = currentSetHistory.filter(h => h.penaltyWarning && h.actionPlayer === player2Name).length;
  const p1Penalties = currentSetHistory.filter(h =>
    (h.actionType === 'penalty_table_pushing' || h.actionType === 'penalty_electronic' || h.actionType === 'penalty_talking')
    && !h.penaltyWarning && h.actionPlayer === player1Name
  ).length;
  const p2Penalties = currentSetHistory.filter(h =>
    (h.actionType === 'penalty_table_pushing' || h.actionType === 'penalty_electronic' || h.actionType === 'penalty_talking')
    && !h.penaltyWarning && h.actionPlayer === player2Name
  ).length;

  // Highlight point for side change (6 in deciding set, 11 otherwise)
  const isDecidingSet = setWins.player1 === gameConfig.SETS_TO_WIN - 1 && setWins.player2 === gameConfig.SETS_TO_WIN - 1;
  const sideChangePoint = isDecidingSet ? Math.ceil(gameConfig.POINTS_TO_WIN / 2) : gameConfig.POINTS_TO_WIN;

  // Max point cells: winScore + 7 for deuce margin (e.g. 11 → 18)
  const maxPointCells = gameConfig.POINTS_TO_WIN + 7;

  // Keyboard shortcuts disabled - was causing React #310 error

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
          subtitle={`${t('referee.practice.setup.individual')} ${t('referee.scoring.warmupStart')} (60${t('common.time.seconds')})`}
          onClose={() => { warmupTimer.stop(); updateMatch({ warmupStartTime: undefined }); longWhistle(); }}
          closeLabel={t('common.done')}
        />
      )}

      {/* Side Change Timer Modal */}
      {showSideChange && (
        <TimerModal
          title={t('common.matchHistory.sideChange')}
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle={`1${t('common.time.minutes')}`}
          onClose={() => { sideChangeTimer.stop(); updateMatch({ sideChangeStartTime: undefined }); }}
          closeLabel={t('common.confirm')}
          required
        />
      )}

      {/* Timeout Modal - countdown for player/medical, elapsed for referee */}
      {match.activeTimeout && (match.activeTimeout.type === 'referee' || timeoutTimer.isRunning) && (
        <TimeoutModal
          match={match}
          player1Name={player1Name}
          player2Name={player2Name}
          timeoutTimer={timeoutTimer}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); longWhistle(); }}
        />
      )}

      {/* Set End Confirmation Dialog */}
      {showSetEndConfirm && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onKeyDown={e => { if (e.key === 'Escape' && !isMatchEnd) handleCancelSetEnd(); }}>
          <div ref={setEndTrapRef} className="flex flex-col items-center gap-6 p-8 max-w-sm" role="dialog" aria-modal="true" aria-label={t('common.matchHistory.setResult')}>
            <h2 className="text-2xl font-bold text-yellow-400">{t('common.matchHistory.setResult')}</h2>
            <p className="text-lg text-gray-300 text-center whitespace-pre-line">{setEndMessage}</p>
            <div className="flex gap-4 w-full">
              <button className="btn btn-success btn-large flex-1" onClick={handleConfirmSetEnd}>{t('common.confirm')}</button>
              {!isMatchEnd && (
                <button className="btn btn-secondary btn-large flex-1" onClick={handleCancelSetEnd}>{t('common.cancel')}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pause Banner */}
      {isPausedLocal && (
        <div className="bg-orange-900/80 px-4 py-3 flex items-center justify-between" role="status" aria-live="polite" aria-label={t('common.matchHistory.pause', { player: '' })}>
          <div>
            <span className="text-orange-300 font-bold">⏸️ {t('common.matchHistory.pause', { player: '' })}</span>
            <span className="text-orange-200 ml-3" aria-label={`${t('referee.scoring.elapsedTime')} ${Math.floor(pauseElapsed / 60)}${t('common.time.minutes')} ${pauseElapsed % 60}${t('common.time.seconds')}`}>
              {Math.floor(pauseElapsed / 60)}:{(pauseElapsed % 60).toString().padStart(2, '0')}
            </span>
            {match.pauseReason && <span className="text-orange-200/70 ml-3 text-sm">({match.pauseReason})</span>}
          </div>
          <button className="btn btn-success text-sm px-4 py-1" onClick={handleResume} aria-label={t('common.confirm')}>▶</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/games')} aria-label={t('referee.home.title')}>← {t('referee.home.title')}</button>
          <div className="text-center">
            <h1 className="text-lg font-bold text-yellow-400">{t('common.matchHistory.setLabel', { num: currentSetIndex + 1 })}/{gameConfig.MAX_SETS}</h1>
            <div className="text-sm text-gray-400" aria-label={`${t('common.units.set')} ${setWins.player1} : ${setWins.player2}`}>{t('common.units.set')}: {setWins.player1} - {setWins.player2}</div>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{t('referee.home.mainReferee')}: {match.refereeName}</div>}
            {match.assistantRefereeName && <div>{t('referee.home.assistantReferee')}: {match.assistantRefereeName}</div>}
          </div>
        </div>
      </div>

      {/* Serve display */}
      <div className="bg-blue-900/50 px-4 py-1.5 flex items-center justify-center gap-3" role="status" aria-label={`${serverName} ${t('common.matchHistory.serve')} ${serveCountVal + 1}/${maxServes}`}>
        <span className="text-blue-300 font-semibold text-sm">
          🎾 {serverName} {t('common.matchHistory.serve')} {serveCountVal + 1}/{maxServes}
        </span>
        <button className="text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label={t('common.matchHistory.serve')} style={{ minHeight: '44px', minWidth: '44px' }}>
          {t('common.matchHistory.serve')}
        </button>
      </div>

      {/* Official Scoresheet Grid */}
      <div className="px-2 py-2" aria-live="polite">
        <ScoresheetGrid
          key={`set-${currentSetIndex}-${scoreFlash}`}
          playerAName={player1Name}
          playerBName={player2Name}
          playerAScore={currentSet.player1Score}
          playerBScore={currentSet.player2Score}
          maxPoints={maxPointCells}
          highlightPoint={sideChangePoint}
          currentServe={currentServe}
          serveCount={serveCountVal}
          servesPerTurn={2}
          warnings={{ player1: p1Warnings, player2: p2Warnings }}
          penalties={{ player1: p1Penalties, player2: p2Penalties }}
          timeouts={{ player1: p1TimeoutsUsed, player2: p2TimeoutsUsed }}
          setLabel={`${t('common.matchHistory.setLabel', { num: currentSetIndex + 1 })} — ${currentSet.player1Score} : ${currentSet.player2Score}`}
          coachA={match.player1Coach}
          coachB={match.player2Coach}
        />
      </div>

      {/* Scoring area - Player select → Action sheet */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {/* 골 버튼 (1탭 유지 - 가장 빈번) */}
        <div className="grid grid-cols-2 gap-3">
          <button
            className="btn btn-success text-lg py-5 font-bold"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning)}
            onClick={() => handleIBSAScore(1, 'goal', 2, false, `${player1Name} ${t('common.scoreActions.goal')}`)}
            aria-label={`${player1Name} ${t('common.scoreActions.goal')} +2${t('common.units.point')}`}
          >
            ⚽ {player1Name}<br/>{t('common.scoreActions.goal')} +2
          </button>
          <button
            className="btn btn-success text-lg py-5 font-bold"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning)}
            onClick={() => handleIBSAScore(2, 'goal', 2, false, `${player2Name} ${t('common.scoreActions.goal')}`)}
            aria-label={`${player2Name} ${t('common.scoreActions.goal')} +2${t('common.units.point')}`}
          >
            ⚽ {player2Name}<br/>{t('common.scoreActions.goal')} +2
          </button>
        </div>

        {/* 선수 선택 → 액션 시트 (파울/타임아웃/페널티 등) */}
        <div className="grid grid-cols-2 gap-3">
          <button
            className={`btn text-lg py-5 font-bold rounded-xl border-2 ${actionSheetPlayer === 1 ? 'bg-yellow-700 border-yellow-400 text-white' : 'bg-gray-800 border-gray-600 text-yellow-400 hover:bg-gray-700'}`}
            onClick={() => setActionSheetPlayer(actionSheetPlayer === 1 ? null : 1)}
            aria-label={`${player1Name} ${t('referee.scoring.voiceStart')}`}
            aria-expanded={actionSheetPlayer === 1}
          >
            {player1Name}
          </button>
          <button
            className={`btn text-lg py-5 font-bold rounded-xl border-2 ${actionSheetPlayer === 2 ? 'bg-cyan-700 border-cyan-400 text-white' : 'bg-gray-800 border-gray-600 text-cyan-400 hover:bg-gray-700'}`}
            onClick={() => setActionSheetPlayer(actionSheetPlayer === 2 ? null : 2)}
            aria-label={`${player2Name} ${t('referee.scoring.voiceStart')}`}
            aria-expanded={actionSheetPlayer === 2}
          >
            {player2Name}
          </button>
        </div>

        {/* 액션 시트 (선수 선택 시 표시) */}
        {actionSheetPlayer && (() => {
          const pNum = actionSheetPlayer;
          const pName = pNum === 1 ? player1Name : player2Name;
          const opName = pNum === 1 ? player2Name : player1Name;
          const scoringDisabled = !!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning);
          const usedTimeouts = pNum === 1 ? p1TimeoutsUsed : p2TimeoutsUsed;
          const medUsed = (match.scoreHistory || []).filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === pName).length;
          const tablePushTotal = (match.scoreHistory || []).filter(h => h.actionType === 'penalty_table_pushing' && h.actionPlayer === pName).length;
          const talkingTotal = (match.scoreHistory || []).filter(h => h.actionType === 'penalty_talking' && h.actionPlayer === pName).length;

          return (
            <div className="bg-gray-800 rounded-xl border border-gray-600 overflow-hidden" role="region" aria-label={`${pName} actions`}>
              <div className={`px-4 py-2 text-center font-bold text-sm ${pNum === 1 ? 'bg-yellow-900/50 text-yellow-400' : 'bg-cyan-900/50 text-cyan-400'}`}>
                {pName}
              </div>

              {/* 파울 (+1점) */}
              <div className="px-3 py-2 space-y-1">
                <div className="text-xs text-gray-400 font-bold px-1">🟡 +1{t('common.units.point')}</div>
                {foulActions.map(action => (
                  (action.type !== 'irregular_serve' || currentServe === (pNum === 1 ? 'player1' : 'player2')) ? (
                    <button key={action.type} className="w-full btn bg-yellow-900/70 hover:bg-yellow-800 text-yellow-200 text-sm py-2 text-left px-3 rounded" disabled={scoringDisabled}
                      onClick={() => { handleIBSAScore(pNum, action.type, action.points, true, `${pName} ${action.label}`); setActionSheetPlayer(null); }}>
                      {action.label} <span className="text-xs opacity-75">→ {opName} +1</span>
                    </button>
                  ) : null
                ))}
              </div>

              {/* 타임아웃 */}
              <div className="px-3 py-2 space-y-1 border-t border-gray-700">
                <div className="text-xs text-gray-400 font-bold px-1">⏱️ {t('referee.scoring.timeoutTitle.player')}</div>
                <div className="flex gap-2">
                  <button className="btn btn-secondary flex-1 text-sm py-2" onClick={() => { handleTimeout(pNum, 'player'); setActionSheetPlayer(null); }} disabled={usedTimeouts >= 1 || !!match.activeTimeout}>
                    ⏱️ 1m | {1 - usedTimeouts}
                  </button>
                  <button className="btn bg-teal-800 hover:bg-teal-700 text-white flex-1 text-sm py-2" onClick={() => { handleTimeout(pNum, 'medical'); setActionSheetPlayer(null); }} disabled={!!match.activeTimeout || medUsed >= 1}>
                    🏥 5m | {medUsed >= 1 ? '-' : '1'}
                  </button>
                </div>
              </div>

              {/* 페널티 */}
              <div className="px-3 py-2 space-y-1 border-t border-gray-700">
                <div className="text-xs text-red-400 font-bold px-1">🔴 {t('common.scoreActions.penalty')}</div>
                <button className="w-full btn bg-red-900/70 hover:bg-red-800 text-red-200 text-sm py-2 text-left px-3 rounded" disabled={scoringDisabled}
                  onClick={() => { handlePenalty(pNum, 'penalty_table_pushing'); setActionSheetPlayer(null); }}>
                  {t('common.scoreActions.penaltyTablePushing')} <span className="text-xs opacity-75">{tablePushTotal % 2 === 0 ? '(0)' : `→ ${opName} +2`}</span>
                </button>
                <button className="w-full btn bg-red-900/70 hover:bg-red-800 text-red-200 text-sm py-2 text-left px-3 rounded" disabled={scoringDisabled}
                  onClick={() => { handlePenalty(pNum, 'penalty_electronic'); setActionSheetPlayer(null); }}>
                  {t('common.scoreActions.penaltyElectronic')} <span className="text-xs opacity-75">→ {opName} +2</span>
                </button>
                <button className="w-full btn bg-red-900/70 hover:bg-red-800 text-red-200 text-sm py-2 text-left px-3 rounded" disabled={scoringDisabled}
                  onClick={() => { handlePenalty(pNum, 'penalty_talking'); setActionSheetPlayer(null); }}>
                  {t('common.scoreActions.penaltyTalking')} <span className="text-xs opacity-75">{talkingTotal % 2 === 0 ? '(0)' : `→ ${opName} +1`}</span>
                </button>
              </div>
            </div>
          );
        })()}

        {/* 취소 / 데드볼 / 레프리타임 */}
        <div className="flex gap-2">
          <button className="btn btn-danger flex-1 py-3" onClick={handleUndo} disabled={history.length === 0} aria-label={t('common.cancel')}>↩️ {t('common.cancel')}</button>
          <button className="btn bg-purple-700 hover:bg-purple-600 text-white flex-1 py-3" disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning) || match.status !== 'in_progress'}
            onClick={() => handleDeadBall(currentServe === 'player1' ? 1 : 2)} aria-label={t('common.matchHistory.deadBall', { server: serverName })}>
            🔵 {t('common.matchHistory.deadBall', { server: '' })}
          </button>
          <button className="btn bg-yellow-800 hover:bg-yellow-700 text-white flex-1 py-3 text-sm" onClick={() => handleTimeout(1, 'referee')} disabled={!!match.activeTimeout} aria-label={t('referee.scoring.timeoutRefereeAriaLabel')}>
            🟨 {t('referee.scoring.timeoutTitle.referee')}
          </button>
        </div>

        {/* 접이식: 기타 (워밍업/일시정지/부전승) */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('etc')} aria-expanded={expandedSection === 'etc'}>
            <span className="text-sm font-bold text-gray-300">⏸️ {t('common.matchHistory.pause', { player: '' })} / {t('common.scoreActions.walkover')}</span>
            <span className="text-gray-400">{expandedSection === 'etc' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'etc' && (
            <div className="px-4 py-3 space-y-3 bg-gray-900/50">
              <div className="flex gap-3">
                {!match.warmupUsed && (match.currentSet ?? 0) === 0 && (
                  <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white" onClick={handleWarmup} aria-label={`${t('referee.scoring.warmupStart')} 60${t('common.time.seconds')}`}>
                    🔥 {t('referee.scoring.warmupStart')} 60{t('common.time.seconds')}
                  </button>
                )}
                {!isPausedLocal && (
                  <button className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white" onClick={handlePause} aria-label={t('common.matchHistory.pause', { player: '' })}>
                    ⏸️ {t('common.matchHistory.pause', { player: '' })}
                  </button>
                )}
              </div>

        {/* Walkover (부전승) */}
              <div className="border-t border-gray-700 pt-3">
                <h3 className="text-sm font-bold text-gray-400 mb-2">{t('common.scoreActions.walkover')}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2" onClick={() => handleWalkover(1)} disabled={match.status !== 'in_progress' && match.status !== 'pending'} aria-label={`${player1Name} ${t('common.scoreActions.walkover')}`}>
                    {player1Name} {t('common.scoreActions.walkover')}
                  </button>
                  <button className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2" onClick={() => handleWalkover(2)} disabled={match.status !== 'in_progress' && match.status !== 'pending'} aria-label={`${player2Name} ${t('common.scoreActions.walkover')}`}>
                    {player2Name} {t('common.scoreActions.walkover')}
                  </button>
                </div>
              </div>
            </div>
          )}
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

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2">{t('common.matchHistory.setResult')}</h3>
          <div className="flex gap-4 overflow-x-auto">
            {sets.map((s: SetScore, i: number) => (
              <div key={i} className={`text-center px-3 py-1 rounded ${i === currentSetIndex ? 'bg-gray-700' : ''}`} aria-label={`${t('common.matchHistory.setLabel', { num: i + 1 })}: ${player1Name} ${s.player1Score} : ${player2Name} ${s.player2Score}`} aria-current={i === currentSetIndex ? 'true' : undefined}>
                <div className="text-xs text-gray-400">{t('common.matchHistory.setLabel', { num: i + 1 })}</div>
                <div className="text-lg font-bold">
                  <span className="text-yellow-400">{s.player1Score}</span>
                  <span className="text-gray-400"> - </span>
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
