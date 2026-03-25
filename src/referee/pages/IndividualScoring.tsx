import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { useNavigationGuard } from '@shared/hooks/useNavigationGuard';
import { IBSA_SCORE_ACTIONS } from '@shared/types';
import type { SetScore, ScoreActionType, ScoreHistoryEntry } from '@shared/types';
import { autoBackupDebounced, autoBackupToLocal } from '@shared/utils/backup';
import { useCountdownTimer } from '../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../hooks/useDoubleClickGuard';
import { useFocusTrap } from '../hooks/useFocusTrap';
import TimerModal from '../components/TimerModal';
import SetGroupedHistory from '../components/SetGroupedHistory';
import ActionToast from '../components/ActionToast';

type PenaltyDropdownKey = 'player1' | 'player2' | null;
type TimeoutDropdownKey = 'player1' | 'player2' | null;

// TTS helper: speak text using Web Speech API
function speak(text: string) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.2;
    window.speechSynthesis.speak(utterance);
  }
}

// Referee timeout elapsed timer component
function TimeoutModal({ match, player1Name, player2Name, timeoutTimer, onClose }: {
  match: { activeTimeout?: { playerId: string; startTime: number; type?: 'player' | 'medical' | 'referee' } | null; player1Id?: string };
  player1Name: string;
  player2Name: string;
  timeoutTimer: { seconds: number; isRunning: boolean; isWarning: boolean; stop: () => void };
  onClose: () => void;
}) {
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
    player: '선수 타임아웃',
    medical: '메디컬 타임아웃',
    referee: '레프리 타임아웃',
  };

  if (toType === 'referee') {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const display = `${mins}:${secs.toString().padStart(2, '0')}`;
    return (
      <div className="modal-backdrop" style={{ zIndex: 100 }}>
        <div ref={trapRef} className="flex flex-col items-center gap-6 p-8" role="dialog" aria-modal="true" aria-label={titleMap[toType]}>
          <h2 className="text-3xl font-bold text-yellow-400">{titleMap[toType]}</h2>
          <div className="text-8xl font-bold my-4 text-white" aria-live="polite" aria-label={`경과 시간 ${display}`}>
            {display}
          </div>
          <p className="text-xl text-gray-300">{playerName} (경과 시간)</p>
          <button className="btn btn-danger btn-large" onClick={onClose} aria-label="타임아웃 종료">
            타임아웃 종료
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
      closeLabel="타임아웃 종료"
    />
  );
}

export default function IndividualScoring() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: matchLoading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);
  const { tournament } = useTournament(tournamentId ?? null);

  const { canAct } = useDoubleClickGuard();

  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);
  const [showSideChange, setShowSideChange] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSetEndConfirm, setShowSetEndConfirm] = useState(false);
  const [setEndMessage, setSetEndMessage] = useState('');
  const [isMatchEnd, setIsMatchEnd] = useState(false);
  // Warmup
  const [showWarmup, setShowWarmup] = useState(false);
  // Coin toss
  const [coinTossStep, setCoinTossStep] = useState<'toss' | 'choice' | 'warmup_ask'>('toss');
  const [tossWinner, setTossWinner] = useState<'player1' | 'player2' | null>(null);
  const [pendingFirstServe, setPendingFirstServe] = useState<'player1' | 'player2' | null>(null);
  // Coach
  const [player1Coach, setPlayer1Coach] = useState('');
  const [player2Coach, setPlayer2Coach] = useState('');
  // Pause
  const [isPausedLocal, setIsPausedLocal] = useState(false);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const [pauseReason, setPauseReason] = useState('');
  // Penalty & timeout dropdowns
  const [penaltyDropdown, setPenaltyDropdown] = useState<PenaltyDropdownKey>(null);
  const [timeoutDropdown, setTimeoutDropdown] = useState<TimeoutDropdownKey>(null);
  const penaltyDropdownRef = useRef<HTMLDivElement>(null);
  const timeoutDropdownRef = useRef<HTMLDivElement>(null);

  const gameConfig = match && tournament
    ? getEffectiveScoringRules(match, tournament)
    : getEffectiveGameConfig(tournament?.scoringRules || tournament?.gameConfig);
  useNavigationGuard(match?.status === 'in_progress');
  const setEndTrapRef = useFocusTrap(showSetEndConfirm);

  // Timers
  const sideChangeTimer = useCountdownTimer(() => setShowSideChange(false));
  const warmupTimer = useCountdownTimer(() => setShowWarmup(false));
  const timeoutTimer = useCountdownTimer(() => {
    if (match) updateMatch({ activeTimeout: null });
  });

  // 15초 안내 (타임아웃)
  const timeoutAlerted = useRef(false);
  useEffect(() => {
    if (!timeoutTimer.isRunning) {
      timeoutAlerted.current = false;
      return;
    }
    if (timeoutTimer.seconds === 15 && !timeoutAlerted.current) {
      timeoutAlerted.current = true;
      setLastAction('⚠️ 15초 남았습니다');
      setAnnouncement('15초 남았습니다');
      speak('15초 남았습니다');
    }
  }, [timeoutTimer.seconds, timeoutTimer.isRunning]);

  // 15초 안내 (사이드 체인지)
  const sideChangeAlerted = useRef(false);
  useEffect(() => {
    if (!sideChangeTimer.isRunning) {
      sideChangeAlerted.current = false;
      return;
    }
    if (sideChangeTimer.seconds === 15 && !sideChangeAlerted.current) {
      sideChangeAlerted.current = true;
      setLastAction('⚠️ 사이드 체인지 15초 남았습니다');
      setAnnouncement('15초 남았습니다');
      speak('15초 남았습니다');
    }
  }, [sideChangeTimer.seconds, sideChangeTimer.isRunning]);

  // 15초 안내 (워밍업)
  const warmupAlerted = useRef(false);
  useEffect(() => {
    if (!warmupTimer.isRunning) {
      warmupAlerted.current = false;
      return;
    }
    if (warmupTimer.seconds === 15 && !warmupAlerted.current) {
      warmupAlerted.current = true;
      setLastAction('⚠️ 워밍업 15초 남았습니다');
      setAnnouncement('워밍업 15초 남았습니다');
      speak('워밍업 15초 남았습니다');
    }
  }, [warmupTimer.seconds, warmupTimer.isRunning]);

  // Start timeout timer when activeTimeout changes
  useEffect(() => {
    if (match?.activeTimeout) {
      const toType = match.activeTimeout.type ?? 'player';
      if (toType === 'referee') {
        // Referee timeout: no countdown, manual end only
        timeoutTimer.stop();
      } else {
        const duration = toType === 'medical' ? 300 : 60;
        const elapsed = Math.floor((Date.now() - match.activeTimeout.startTime) / 1000);
        const remaining = Math.max(0, duration - elapsed);
        if (remaining > 0) timeoutTimer.start(remaining);
      }
    } else {
      timeoutTimer.stop();
    }
  }, [match?.activeTimeout, timeoutTimer]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (penaltyDropdown && penaltyDropdownRef.current && !penaltyDropdownRef.current.contains(e.target as Node)) {
        setPenaltyDropdown(null);
      }
      if (timeoutDropdown && timeoutDropdownRef.current && !timeoutDropdownRef.current.contains(e.target as Node)) {
        setTimeoutDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [penaltyDropdown, timeoutDropdown]);

  // Pause elapsed time counter
  useEffect(() => {
    if (!isPausedLocal) return;
    const interval = setInterval(() => setPauseElapsed(p => p + 1), 1000);
    return () => clearInterval(interval);
  }, [isPausedLocal]);

  // Sync coach from match
  useEffect(() => {
    if (match?.player1Coach && !player1Coach) setPlayer1Coach(match.player1Coach);
    if (match?.player2Coach && !player2Coach) setPlayer2Coach(match.player2Coach);
  }, [match?.player1Coach, match?.player2Coach]);

  // Sync pause state from match
  useEffect(() => {
    if (match?.isPaused && !isPausedLocal) {
      setIsPausedLocal(true);
      setPauseReason(match.pauseReason ?? '');
      setPauseElapsed(match.pauseStartTime ? Math.floor((Date.now() - match.pauseStartTime) / 1000) : 0);
    }
  }, [match?.isPaused]);

  const handleStartMatch = useCallback(async (firstServe: 'player1' | 'player2') => {
    if (!match) return;
    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
    const winnerName = tossWinner === 'player1' ? p1Name : p2Name;
    const choiceLabel = firstServe === (tossWinner ?? 'player1') ? '서브' : '리시브';
    const serverName = firstServe === 'player1' ? p1Name : p2Name;

    const coinTossEntry: ScoreHistoryEntry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      scoringPlayer: '',
      actionPlayer: winnerName,
      actionType: 'coin_toss',
      actionLabel: `동전던지기 → ${winnerName} 승리, ${choiceLabel} 선택`,
      points: 0,
      set: 1,
      server: serverName,
      serveNumber: 1,
      scoreBefore: { player1: 0, player2: 0 },
      scoreAfter: { player1: 0, player2: 0 },
      serverSide: firstServe,
    };

    const matchStartEntry: ScoreHistoryEntry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      scoringPlayer: '',
      actionPlayer: '',
      actionType: 'match_start',
      actionLabel: '경기 시작',
      points: 0,
      set: 1,
      server: serverName,
      serveNumber: 1,
      scoreBefore: { player1: 0, player2: 0 },
      scoreAfter: { player1: 0, player2: 0 },
      serverSide: firstServe,
    };

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
      scoreHistory: [matchStartEntry, coinTossEntry],
      warmupUsed: false,
      coinTossWinner: tossWinner ?? undefined,
      coinTossChoice: firstServe === (tossWinner ?? 'player1') ? 'serve' : 'receive',
      player1Coach: player1Coach || undefined,
      player2Coach: player2Coach || undefined,
    });
  }, [match, updateMatch, tossWinner, player1Coach, player2Coach]);

  // Warmup
  const handleWarmup = useCallback(async () => {
    if (!match || match.warmupUsed) return;
    const currentSetData = match.sets?.[match.currentSet ?? 0];
    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
    const currentServe = match.currentServe ?? 'player1';
    const serverName = currentServe === 'player1' ? p1Name : p2Name;

    const warmupEntry: ScoreHistoryEntry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      scoringPlayer: '',
      actionPlayer: '',
      actionType: 'warmup_start',
      actionLabel: '워밍업 시작 (60초)',
      points: 0,
      set: (match.currentSet ?? 0) + 1,
      server: serverName,
      serveNumber: (match.serveCount ?? 0) + 1,
      scoreBefore: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      scoreAfter: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      serverSide: currentServe,
    };

    const prevHistory = match.scoreHistory ?? [];
    await updateMatch({ warmupUsed: true, scoreHistory: [warmupEntry, ...prevHistory] });
    warmupTimer.start(60); // Individual: 60 seconds
    setShowWarmup(true);
  }, [match, updateMatch, warmupTimer]);

  // Pause
  const handlePause = useCallback(async () => {
    if (!match || match.status !== 'in_progress' || isPausedLocal) return;
    const reason = prompt('일시정지 사유를 입력하세요:\n(예: 부상, 장비 문제, 기타)');
    if (reason === null) return;
    setIsPausedLocal(true);
    setPauseReason(reason || '사유 없음');
    setPauseElapsed(0);
    const pauseEntry = {
      time: new Date().toLocaleTimeString('ko-KR'),
      reason: reason || '사유 없음',
      set: (match.currentSet ?? 0) + 1,
    };
    const prevPauseHistory = match.pauseHistory ?? [];
    const currentSetData = match.sets?.[match.currentSet ?? 0];
    const pauseHistoryEntry: ScoreHistoryEntry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      set: (match.currentSet ?? 0) + 1,
      scoringPlayer: '',
      actionPlayer: reason || '사유 없음',
      actionType: 'pause' as ScoreActionType,
      actionLabel: '일시정지',
      points: 0,
      scoreBefore: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      scoreAfter: { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 },
      server: match.currentServe === 'player1' ? (match.player1Name ?? '') : (match.player2Name ?? ''),
      serveNumber: (match.serveCount ?? 0) + 1,
      serverSide: match.currentServe ?? 'player1',
    };
    const prevScoreHistory = match.scoreHistory ?? [];
    await updateMatch({
      isPaused: true, pauseReason: reason || '사유 없음', pauseStartTime: Date.now(),
      pauseHistory: [...prevPauseHistory, pauseEntry],
      scoreHistory: [pauseHistoryEntry, ...prevScoreHistory],
    });
  }, [match, updateMatch, isPausedLocal]);

  const handleResume = useCallback(async () => {
    if (!match) return;
    setIsPausedLocal(false);
    const prevPauseHistory = match.pauseHistory ?? [];
    const updated = [...prevPauseHistory];
    if (updated.length > 0) {
      updated[updated.length - 1] = { ...updated[updated.length - 1], duration: pauseElapsed };
    }
    const currentSetData = match.sets?.[match.currentSet ?? 0];
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
      server: match.currentServe === 'player1' ? (match.player1Name ?? '') : (match.player2Name ?? ''),
      serveNumber: (match.serveCount ?? 0) + 1,
      serverSide: match.currentServe ?? 'player1',
    };
    const prevScoreHistory = match.scoreHistory ?? [];
    setPauseElapsed(0);
    setPauseReason('');
    await updateMatch({ isPaused: false, pauseReason: '', pauseStartTime: undefined, pauseHistory: updated, scoreHistory: [resumeHistoryEntry, ...prevScoreHistory] });
  }, [match, updateMatch, pauseElapsed]);

  // Walkover (부전승)
  const handleWalkover = useCallback(async (winnerPlayer: 1 | 2) => {
    if (!match) return;
    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
    const winnerName = winnerPlayer === 1 ? p1Name : p2Name;
    const loserName = winnerPlayer === 1 ? p2Name : p1Name;

    if (!window.confirm(`${loserName} 기권으로 ${winnerName} 부전승 처리하시겠습니까?`)) return;

    const reason = prompt('부전승 사유를 입력하세요:\n(예: 부상, 기권, 미출석)') || '기권';

    const winnerId = winnerPlayer === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: winnerName,
      actionPlayer: loserName,
      actionType: 'walkover',
      actionLabel: `부전승 (${reason})`,
      points: 0,
      set: (match.currentSet ?? 0) + 1,
      server: (match.currentServe ?? 'player1') === 'player1' ? p1Name : p2Name,
      serveNumber: (match.serveCount ?? 0) + 1,
      scoreBefore: { player1: match.sets?.[match.currentSet ?? 0]?.player1Score ?? 0, player2: match.sets?.[match.currentSet ?? 0]?.player2Score ?? 0 },
      scoreAfter: { player1: match.sets?.[match.currentSet ?? 0]?.player1Score ?? 0, player2: match.sets?.[match.currentSet ?? 0]?.player2Score ?? 0 },
      serverSide: match.currentServe ?? 'player1',
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

    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
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

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;

    // 시각적 피드백: 누가 무엇을 했고 → 누가 득점했는지 명확히 표시
    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${pName} +${points}점`
      : `${pName} 골! +${points}점`;
    setLastAction(`${actionDesc} | ${scoreAfter.player1} : ${scoreAfter.player2}`);

    const serverScore = nextServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = nextServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;
    setAnnouncement(
      `${pName} ${points}점. 스코어 ${serverScore} 대 ${receiverScore}. ${nextServerName} ${nextCount + 1}번째 서브`
    );

    // Set winner check with confirmation dialog
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, gameConfig);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, gameConfig);

      // Block scoring IMMEDIATELY to prevent race condition during 500ms delay
      setShowSetEndConfirm(true);

      // Save state first
      await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory,
      });

      // Show dialog message after 500ms delay (dialog already blocks via showSetEndConfirm)
      setTimeout(() => {
        if (matchWinner) {
          const winnerName = matchWinner === 1 ? p1Name : p2Name;
          const setWinsCalc = countSetWins(sets, gameConfig);
          setSetEndMessage(`경기 종료!\n\n${winnerName} 승리! (세트 ${setWinsCalc.player1}:${setWinsCalc.player2})\n현재 점수: ${cs.player1Score} - ${cs.player2Score}`);
          setIsMatchEnd(true);
        } else {
          const setWinsCalc = countSetWins(sets, gameConfig);
          setSetEndMessage(`세트 ${ci + 1}을(를) 종료하시겠습니까?\n\n현재 점수: ${cs.player1Score} - ${cs.player2Score}\n세트 스코어: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
          setIsMatchEnd(false);
        }
      }, 500);
      return;
    }

    // Side change check
    if (shouldSideChange('individual', cs, match.sideChangeUsed ?? false, sets, gameConfig) && !match.activeTimeout) {
      await updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory,
      });
      sideChangeTimer.start(60);
      setShowSideChange(true);
      return;
    }

    await updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory,
    });
    if (tournamentId) autoBackupDebounced(tournamentId);
  }, [match, gameConfig, updateMatch, canAct, sideChangeTimer, tournamentId, showSetEndConfirm, showSideChange, showWarmup, warmupTimer]);

  // Confirm set end
  const handleConfirmSetEnd = useCallback(async () => {
    if (!match?.sets) return;
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet ?? 0;

    const matchWinner = checkMatchWinner(sets, gameConfig);
    if (matchWinner) {
      const winnerId = matchWinner === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
      await updateMatch({ sets, status: 'completed', winnerId });
      if (tournamentId) autoBackupToLocal(tournamentId);
    } else {
      sets.push(createEmptySet());
      await updateMatch({
        sets, currentSet: ci + 1,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        sideChangeUsed: false,
      });
    }
    setShowSetEndConfirm(false);
  }, [match, gameConfig, updateMatch, tournamentId]);

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

    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
    const undoServerName = currentServe === 'player1' ? p1Name : p2Name;
    const msg = `취소됨. ${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}. ${undoServerName} 서브`;
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
    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
    const currentServe = match.currentServe ?? 'player1';
    const serveCount = match.serveCount ?? 0;
    const sName = currentServe === 'player1' ? p1Name : p2Name;
    const callerName = callingPlayer === 1 ? p1Name : p2Name;
    const scoreBefore = { player1: currentSetData?.player1Score ?? 0, player2: currentSetData?.player2Score ?? 0 };

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: '',
      actionPlayer: callerName,
      actionType: 'dead_ball',
      actionLabel: `${callerName} 데드볼 → 재서브`,
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

    setLastAction(`${callerName} 데드볼 - ${sName} 재서브`);
    setAnnouncement(`${callerName} 데드볼. ${sName} 재서브`);
  }, [match, updateMatch]);

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

    const p1Name = match.player1Name ?? '선수1';
    const p2Name = match.player2Name ?? '선수2';
    const actorName = actingPlayer === 1 ? p1Name : p2Name;

    const penaltyLabels: Record<string, string> = {
      penalty_table_pushing: '테이블 푸싱',
      penalty_electronic: '전자기기 소리',
      penalty_talking: '경기 중 말하기',
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
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        scoringPlayer: '',
        actionPlayer: actorName,
        actionType: penaltyType,
        actionLabel: `${label} 경고`,
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
      setLastAction(`${actorName} ${label} 경고`);
      setAnnouncement(`${actorName} ${label} 경고`);
    } else {
      // Point deduction - opponent gets +2
      await handleIBSAScore(actingPlayer, penaltyType, 2, true, `${actorName} ${label}`);
    }

    setPenaltyDropdown(null);
  }, [match, handleIBSAScore, updateMatch, showSetEndConfirm, showSideChange, showWarmup, warmupTimer]);

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
      const playerName = player === 1 ? (match.player1Name ?? '선수1') : (match.player2Name ?? '선수2');
      const medicalUsed = (match.scoreHistory || []).filter(h =>
        h.actionType === 'timeout_medical' && h.actionPlayer === playerName
      ).length;
      if (medicalUsed >= 1) return;
    }

    const playerId = player === 1 ? (match.player1Id ?? 'player1') : (match.player2Id ?? 'player2');
    const playerName = player === 1 ? (match.player1Name ?? '선수1') : (match.player2Name ?? '선수2');
    const currentSetData = match.sets?.[match.currentSet ?? 0];

    const actionTypeMap: Record<string, ScoreActionType> = {
      player: 'timeout_player',
      medical: 'timeout_medical',
      referee: 'timeout_referee',
    };
    const labelMap: Record<string, string> = {
      player: '선수 타임아웃 (1분)',
      medical: '메디컬 타임아웃 (5분)',
      referee: '레프리 타임아웃',
    };

    const timeoutEntry: ScoreHistoryEntry = {
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
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
    setTimeoutDropdown(null);
  }, [match, updateMatch]);

  if (matchLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-2xl text-gray-400 animate-pulse">경기 로딩 중...</p>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-2xl text-red-400">경기를 찾을 수 없습니다.</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>목록으로</button>
      </div>
    );
  }

  const player1Name = match.player1Name ?? '선수1';
  const player2Name = match.player2Name ?? '선수2';

  // ===== PENDING: serve selection =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
        <h1 className="text-3xl font-bold text-yellow-400">경기 준비</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{player1Name}</span>
          <span className="text-gray-400">vs</span>
          <span className="text-cyan-400 font-bold">{player2Name}</span>
        </div>
        {match.courtName && <p className="text-gray-400 text-lg">코트: {match.courtName}</p>}

        {/* 코치 등록 */}
        <div className="card w-full max-w-md space-y-3">
          <h2 className="text-lg font-bold text-center text-gray-300">코치 등록</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-yellow-400 mb-1">{player1Name} 코치</label>
              <input
                type="text"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                placeholder="코치 이름"
                value={player1Coach}
                onChange={e => setPlayer1Coach(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-cyan-400 mb-1">{player2Name} 코치</label>
              <input
                type="text"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                placeholder="코치 이름"
                value={player2Coach}
                onChange={e => setPlayer2Coach(e.target.value)}
              />
            </div>
          </div>
        </div>

        {coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">동전던지기 승자</h2>
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
              {tossWinner === 'player1' ? player1Name : player2Name} 승리!
            </h2>
            <p className="text-gray-400 text-center">서브 또는 리시브를 선택하세요</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner); setCoinTossStep('warmup_ask'); }} aria-label={`${tossWinner === 'player1' ? player1Name : player2Name}가 서브 선택`}>
                서브
              </button>
              <button className="btn btn-accent btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner === 'player1' ? 'player2' : 'player1'); setCoinTossStep('warmup_ask'); }} aria-label={`${tossWinner === 'player1' ? player1Name : player2Name}가 리시브 선택`}>
                리시브
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }} aria-label="동전던지기 다시 선택" style={{ minHeight: '44px' }}>
              다시 선택
            </button>
          </div>
        )}
        {coinTossStep === 'warmup_ask' && pendingFirstServe && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">워밍업 진행</h2>
            <p className="text-gray-400 text-center">경기 시작 전 워밍업(60초)을 진행하시겠습니까?</p>
            <div className="flex gap-4">
              <button
                className="btn btn-success btn-large flex-1 text-xl py-6"
                onClick={async () => {
                  await handleStartMatch(pendingFirstServe);
                  warmupTimer.start(60);
                  setShowWarmup(true);
                }}
                aria-label="워밍업 진행 후 경기 시작"
              >
                워밍업 진행
              </button>
              <button
                className="btn btn-accent btn-large flex-1 text-xl py-6"
                onClick={() => handleStartMatch(pendingFirstServe)}
                aria-label="워밍업 없이 경기 시작"
              >
                바로 시작
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('choice'); setPendingFirstServe(null); }} aria-label="서브 선택으로 돌아가기" style={{ minHeight: '44px' }}>
              뒤로
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
                {player1Name} 부전승
              </button>
              <button
                className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
                onClick={() => handleWalkover(2)}
              >
                {player2Name} 부전승
              </button>
            </div>
          </div>
        </div>

        <button className="btn btn-accent" onClick={() => navigate('/referee/games')}>목록으로</button>
      </div>
    );
  }

  // ===== COMPLETED =====
  if (match.status === 'completed') {
    const winnerName = match.winnerId === match.player1Id ? player1Name : player2Name;
    const setWins = Array.isArray(match.sets) && match.sets.length > 0 ? countSetWins(match.sets, gameConfig) : { player1: 0, player2: 0 };
    const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];
    return (
      <div className="min-h-screen flex flex-col p-4">
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-yellow-400">경기 종료</h1>
          <div className="text-4xl font-bold text-green-400 mt-2" role="status" aria-live="assertive">🏆 {winnerName} 승리!</div>
          <div className="text-2xl text-gray-300 mt-1" aria-label={`세트 스코어 ${setWins.player1} 대 ${setWins.player2}`}>세트 스코어: {setWins.player1} - {setWins.player2}</div>
        </div>
        {/* 세트별 결과 */}
        {match.sets && match.sets.length > 0 && (
          <div className="w-full max-w-lg mx-auto mb-4">
            <div className="grid grid-cols-1 gap-2">
              {match.sets.map((s: SetScore, i: number) => {
                const winner = s.player1Score > s.player2Score ? player1Name : player2Name;
                return (
                  <div key={i} className="flex justify-between items-center bg-gray-800 rounded px-4 py-2" aria-label={`세트 ${i + 1}: ${player1Name} ${s.player1Score} 대 ${player2Name} ${s.player2Score}, ${winner} 승리`}>
                    <span className="text-sm text-gray-400">세트 {i + 1}</span>
                    <span className="text-lg font-bold">
                      <span className="text-yellow-400">{s.player1Score}</span>
                      <span className="text-gray-400"> - </span>
                      <span className="text-cyan-400">{s.player2Score}</span>
                    </span>
                    <span className="text-sm text-green-400">🏆 {winner} 승</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 상세 경기 기록 */}
        {history.length > 0 && (
          <div className="w-full max-w-lg mx-auto flex-1 flex flex-col min-h-0">
            <h3 className="text-lg font-bold text-gray-300 mb-2">상세 경기 기록 ({history.length})</h3>
            <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 380px)' }}>
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
  const currentSetIndex = match.currentSet ?? 0;
  const currentSet = sets[currentSetIndex] ?? createEmptySet();
  const setWins = countSetWins(sets, gameConfig);
  const currentServe = match.currentServe ?? 'player1';
  const serveCountVal = match.serveCount ?? 0;
  const serverName = currentServe === 'player1' ? player1Name : player2Name;
  const maxServes = getMaxServes('individual');
  const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];

  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);

  // Server-based score display flip (server = left side)
  const isFlipped = currentServe === 'player2';
  const leftName = isFlipped ? player2Name : player1Name;
  const rightName = isFlipped ? player1Name : player2Name;
  const leftScore = isFlipped ? currentSet.player2Score : currentSet.player1Score;
  const rightScore = isFlipped ? currentSet.player1Score : currentSet.player2Score;
  const leftColor = isFlipped ? 'text-cyan-400' : 'text-yellow-400';
  const rightColor = isFlipped ? 'text-yellow-400' : 'text-cyan-400';

  const p1TimeoutsUsed = match.player1Timeouts ?? 0;
  const p2TimeoutsUsed = match.player2Timeouts ?? 0;

  // Keyboard shortcuts disabled - was causing React #310 error

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
          subtitle="개인전 워밍업 (60초)"
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); }}
          closeLabel="워밍업 종료"
        />
      )}

      {/* Side Change Timer Modal */}
      {showSideChange && (
        <TimerModal
          title="사이드 체인지!"
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle="1분 휴식"
          onClose={() => { sideChangeTimer.stop(); setShowSideChange(false); }}
          closeLabel="확인"
        />
      )}

      {/* Timeout Modal - countdown for player/medical, elapsed for referee */}
      {match.activeTimeout && (match.activeTimeout.type === 'referee' || timeoutTimer.isRunning) && (
        <TimeoutModal
          match={match}
          player1Name={player1Name}
          player2Name={player2Name}
          timeoutTimer={timeoutTimer}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); }}
        />
      )}

      {/* Set End Confirmation Dialog */}
      {showSetEndConfirm && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onKeyDown={e => { if (e.key === 'Escape' && !isMatchEnd) handleCancelSetEnd(); }}>
          <div ref={setEndTrapRef} className="flex flex-col items-center gap-6 p-8 max-w-sm" role="dialog" aria-modal="true" aria-label="세트 종료 확인">
            <h2 className="text-2xl font-bold text-yellow-400">세트 종료 확인</h2>
            <p className="text-lg text-gray-300 text-center whitespace-pre-line">{setEndMessage}</p>
            <div className="flex gap-4 w-full">
              <button className="btn btn-success btn-large flex-1" onClick={handleConfirmSetEnd}>확인</button>
              {!isMatchEnd && (
                <button className="btn btn-secondary btn-large flex-1" onClick={handleCancelSetEnd}>취소</button>
              )}
            </div>
          </div>
        </div>
      )}

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
            <h1 className="text-lg font-bold text-yellow-400">세트 {currentSetIndex + 1}/{gameConfig.MAX_SETS}</h1>
            <div className="text-sm text-gray-400" aria-label={`세트 스코어 ${setWins.player1} 대 ${setWins.player2}`}>세트 스코어: {setWins.player1} - {setWins.player2}</div>
          </div>
          <div className="text-sm text-gray-400 text-right">
            {match.courtName && <div>{match.courtName}</div>}
            {match.refereeName && <div>{match.refereeName}</div>}
          </div>
        </div>
      </div>

      {/* Serve display */}
      <div className="bg-blue-900/50 px-4 py-2 text-center" role="status" aria-label={`${serverName} 서브 ${serveCountVal + 1}/${maxServes}회차`}>
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {serveCountVal + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label="서브권 수동 변경" style={{ minHeight: '44px', minWidth: '44px' }}>
          서브권 변경
        </button>
      </div>

      {/* Score display - server on left */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-4 px-2 border-r border-gray-700" style={{ border: isFlipped ? undefined : '3px solid rgba(234,179,8,0.3)', borderRadius: 0 }}>
          <h2 className={`text-xl font-bold ${leftColor}`}>
            🎾 {leftName}
          </h2>
          {(isFlipped ? match.player2Coach : match.player1Coach) && (
            <span className="text-xs text-gray-400">코치: {isFlipped ? match.player2Coach : match.player1Coach}</span>
          )}
          <div key={`left-${scoreFlash}`} className={`text-7xl font-bold my-2 ${leftColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${leftName} ${leftScore}점`}>
            {leftScore}
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-4 px-2">
          <h2 className={`text-xl font-bold ${rightColor}`}>
            {rightName}
          </h2>
          {(isFlipped ? match.player1Coach : match.player2Coach) && (
            <span className="text-xs text-gray-400">코치: {isFlipped ? match.player1Coach : match.player2Coach}</span>
          )}
          <div key={`right-${scoreFlash}`} className={`text-7xl font-bold my-2 ${rightColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${rightName} ${rightScore}점`}>
            {rightScore}
          </div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* Scoring area (buttons always player1 left, player2 right - muscle memory) */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Goal +2 */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">⚽ 골 득점 (+2점)</h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="btn btn-success text-lg py-4 font-bold"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning)}
              onClick={() => handleIBSAScore(1, 'goal', 2, false, `${player1Name} 골`)}
              aria-label={`${player1Name} 골 득점. ${player1Name}에게 2점 추가`}
            >
              {player1Name}<br/>골 +2점
            </button>
            <button
              className="btn btn-success text-lg py-4 font-bold"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning)}
              onClick={() => handleIBSAScore(2, 'goal', 2, false, `${player2Name} 골`)}
              aria-label={`${player2Name} 골 득점. ${player2Name}에게 2점 추가`}
            >
              {player2Name}<br/>골 +2점
            </button>
          </div>
        </div>

        {/* Foul +1 (opponent scores) */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">🟡 파울 +1점 (상대 득점)</h3>
          <div className="space-y-2">
            {foulActions.map(action => (
              <div key={action.type} className="grid grid-cols-2 gap-2">
                {(action.type !== 'irregular_serve' || currentServe === 'player1') ? (
                  <button
                    className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                    disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning)}
                    onClick={() => handleIBSAScore(1, action.type, action.points, true, `${player1Name} ${action.label}`)}
                    aria-label={`${player1Name} ${action.label}. ${player2Name}에게 1점 추가`}
                  >
                    {player1Name} {action.label}<br/>
                    <span className="text-xs opacity-75">→ {player2Name} +1점</span>
                  </button>
                ) : <div />}
                {(action.type !== 'irregular_serve' || currentServe === 'player2') ? (
                  <button
                    className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-sm py-3"
                    disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning)}
                    onClick={() => handleIBSAScore(2, action.type, action.points, true, `${player2Name} ${action.label}`)}
                    aria-label={`${player2Name} ${action.label}. ${player1Name}에게 1점 추가`}
                  >
                    {player2Name} {action.label}<br/>
                    <span className="text-xs opacity-75">→ {player1Name} +1점</span>
                  </button>
                ) : <div />}
              </div>
            ))}
          </div>
        </div>

        {/* Penalty dropdown (per player) */}
        <div>
          <h3 className="text-sm font-bold text-red-400 mb-2">🔴 벌점 (상대 득점)</h3>
          <div className="grid grid-cols-2 gap-3">
            {([1, 2] as const).map(playerNum => {
              const pName = playerNum === 1 ? player1Name : player2Name;
              const opName = playerNum === 1 ? player2Name : player1Name;
              const dropdownKey = playerNum === 1 ? 'player1' : 'player2';
              const isOpen = penaltyDropdown === dropdownKey;

              // Total penalty counts for this player (warning+deduction pairs)
              const tablePushTotal = (match.scoreHistory || []).filter(h =>
                h.actionType === 'penalty_table_pushing' && h.actionPlayer === pName
              ).length;
              const talkingTotal = (match.scoreHistory || []).filter(h =>
                h.actionType === 'penalty_talking' && h.actionPlayer === pName
              ).length;

              return (
                <div key={playerNum} className="relative" ref={playerNum === 1 ? penaltyDropdownRef : undefined}>
                  <button
                    className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3 w-full"
                    disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning)}
                    onClick={() => setPenaltyDropdown(isOpen ? null : dropdownKey)}
                    aria-expanded={isOpen}
                    aria-haspopup="true"
                    aria-label={`${pName} 벌점 메뉴`}
                  >
                    {pName} 벌점 ▾
                  </button>
                  {isOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden" ref={playerNum === 2 ? penaltyDropdownRef : undefined}>
                      {/* 테이블 푸싱 */}
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-red-900/50 text-sm border-b border-gray-700"
                        onClick={() => handlePenalty(playerNum, 'penalty_table_pushing')}
                      >
                        <span className="text-red-300 font-semibold">테이블 푸싱</span>
                        <span className="block text-xs text-gray-400 mt-0.5">
                          {tablePushTotal % 2 === 0 ? '→ 경고 (0점)' : `→ ${opName} +2점`}
                        </span>
                      </button>
                      {/* 전자기기 소리 */}
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-red-900/50 text-sm border-b border-gray-700"
                        onClick={() => handlePenalty(playerNum, 'penalty_electronic')}
                      >
                        <span className="text-red-300 font-semibold">전자기기 소리</span>
                        <span className="block text-xs text-gray-400 mt-0.5">→ {opName} +2점 (즉시)</span>
                      </button>
                      {/* 경기 중 말하기 */}
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-red-900/50 text-sm"
                        onClick={() => handlePenalty(playerNum, 'penalty_talking')}
                      >
                        <span className="text-red-300 font-semibold">경기 중 말하기</span>
                        <span className="block text-xs text-gray-400 mt-0.5">
                          {talkingTotal % 2 === 0 ? '→ 경고 (0점)' : `→ ${opName} +2점`}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button className="btn btn-danger flex-1" onClick={handleUndo} disabled={history.length === 0} aria-label="마지막 점수 취소">
            ↩️ 취소
          </button>
        </div>

        {/* Timeout dropdown (per player) */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">⏱️ 타임아웃</h3>
          <div className="grid grid-cols-2 gap-3">
            {([1, 2] as const).map(playerNum => {
              const pName = playerNum === 1 ? player1Name : player2Name;
              const dropdownKey = playerNum === 1 ? 'player1' : 'player2';
              const isOpen = timeoutDropdown === dropdownKey;
              const usedTimeouts = playerNum === 1 ? p1TimeoutsUsed : p2TimeoutsUsed;

              return (
                <div key={playerNum} className="relative" ref={playerNum === 1 ? timeoutDropdownRef : undefined}>
                  <button
                    className="btn btn-secondary text-sm py-3 w-full"
                    disabled={!!match.activeTimeout}
                    onClick={() => setTimeoutDropdown(isOpen ? null : dropdownKey)}
                    aria-expanded={isOpen}
                    aria-haspopup="true"
                    aria-label={`${pName} 타임아웃 메뉴`}
                  >
                    {pName} 타임아웃 ▾
                  </button>
                  {isOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden" ref={playerNum === 2 ? timeoutDropdownRef : undefined}>
                      {/* 선수 타임아웃 */}
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-blue-900/50 text-sm border-b border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={usedTimeouts >= 1}
                        onClick={() => handleTimeout(playerNum, 'player')}
                      >
                        <span className="text-blue-300 font-semibold">선수 타임아웃 (1분)</span>
                        <span className="block text-xs text-gray-400 mt-0.5">
                          {usedTimeouts >= 1 ? '이미 사용함' : `남은 횟수: ${1 - usedTimeouts}회`}
                        </span>
                      </button>
                      {/* 메디컬 타임아웃 */}
                      {(() => {
                        const pName = playerNum === 1 ? (match.player1Name ?? '선수1') : (match.player2Name ?? '선수2');
                        const medUsed = (match.scoreHistory || []).filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === pName).length;
                        return (
                          <button
                            className="w-full text-left px-4 py-3 hover:bg-green-900/50 text-sm border-b border-gray-700"
                            onClick={() => handleTimeout(playerNum, 'medical')}
                            disabled={medUsed >= 1}
                          >
                            <span className="text-green-300 font-semibold">메디컬 타임아웃 (5분)</span>
                            <span className="block text-xs text-gray-400 mt-0.5">{medUsed >= 1 ? '이미 사용함' : `남은 횟수: 1회`}</span>
                          </button>
                        );
                      })()}
                      {/* 레프리 타임아웃 */}
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-yellow-900/50 text-sm"
                        onClick={() => handleTimeout(playerNum, 'referee')}
                      >
                        <span className="text-yellow-300 font-semibold">레프리 타임아웃</span>
                        <span className="block text-xs text-gray-400 mt-0.5">시간 제한 없음 (수동 종료)</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Dead Ball - both players */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">🔵 데드볼 (재서브)</h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="btn bg-purple-700 hover:bg-purple-600 text-white py-3"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning) || match.status !== 'in_progress'}
              onClick={() => handleDeadBall(1)}
              aria-label={`${player1Name} 데드볼. 현재 서브를 무효로 하고 재서브`}
            >
              {player1Name} 데드볼
            </button>
            <button
              className="btn bg-purple-700 hover:bg-purple-600 text-white py-3"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (showWarmup && warmupTimer.isRunning) || match.status !== 'in_progress'}
              onClick={() => handleDeadBall(2)}
              aria-label={`${player2Name} 데드볼. 현재 서브를 무효로 하고 재서브`}
            >
              {player2Name} 데드볼
            </button>
          </div>
        </div>

        {/* Warmup + Pause */}
        <div className="flex gap-3">
          {!match.warmupUsed && (
            <button className="btn flex-1 bg-orange-700 hover:bg-orange-600 text-white" onClick={handleWarmup} aria-label="워밍업 60초 시작">
              🔥 워밍업 60초
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
              aria-label={`${player1Name} 부전승 처리`}
            >
              {player1Name} 부전승
            </button>
            <button
              className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
              onClick={() => handleWalkover(2)}
              disabled={match.status !== 'in_progress' && match.status !== 'pending'}
              aria-label={`${player2Name} 부전승 처리`}
            >
              {player2Name} 부전승
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

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2">세트 기록</h3>
          <div className="flex gap-4 overflow-x-auto">
            {sets.map((s: SetScore, i: number) => (
              <div key={i} className={`text-center px-3 py-1 rounded ${i === currentSetIndex ? 'bg-gray-700' : ''}`} aria-label={`세트 ${i + 1}: ${player1Name} ${s.player1Score} 대 ${player2Name} ${s.player2Score}${i === currentSetIndex ? ' (현재 세트)' : ''}`} aria-current={i === currentSetIndex ? 'true' : undefined}>
                <div className="text-xs text-gray-400">세트 {i + 1}</div>
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
