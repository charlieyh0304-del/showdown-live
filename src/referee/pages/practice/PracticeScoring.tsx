import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getLocale } from '@shared/utils/locale';
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
import type { ScoreHistoryEntry } from '@shared/types';
import { IBSA_SCORE_ACTIONS } from '@shared/types';
import { formatTime } from '@shared/utils/locale';
import type { SetScore, ScoreActionType, PracticeMatch } from '@shared/types';

import { useCountdownTimer } from '../../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../../hooks/useDoubleClickGuard';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import TimerModal from '../../components/TimerModal';
import SetGroupedHistory from '../../components/SetGroupedHistory';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import ActionToast from '../../components/ActionToast';

export default function PracticeScoring() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addSession } = usePracticeHistory();
  const { canAct, startProcessing, done } = useDoubleClickGuard();

  const PRACTICE_DESCRIPTIVE_LABELS: Record<string, string> = {
    goal: t('referee.practice.scoring.descriptiveLabels.goal'),
    irregular_serve: t('referee.practice.scoring.descriptiveLabels.irregularServe'),
    centerboard: t('referee.practice.scoring.descriptiveLabels.centerboard'),
    body_touch: t('referee.practice.scoring.descriptiveLabels.bodyTouch'),
    illegal_defense: t('referee.practice.scoring.descriptiveLabels.illegalDefense'),
    out: t('referee.practice.scoring.descriptiveLabels.out'),
    ball_holding: t('referee.practice.scoring.descriptiveLabels.ballHolding'),
    mask_touch: t('referee.practice.scoring.descriptiveLabels.maskTouch'),
    penalty: t('referee.practice.scoring.descriptiveLabels.penalty'),
  };

  const matchType = (searchParams.get('type') || 'individual') as 'individual' | 'team';
  const p1Name = searchParams.get('p1') || t('referee.practice.setup.practicePlayerA');
  const p2Name = searchParams.get('p2') || t('referee.practice.setup.practicePlayerB');
  const defaultConfig = matchType === 'team'
    ? { SETS_TO_WIN: 1, MAX_SETS: 1, POINTS_TO_WIN: 31, MIN_POINT_DIFF: 2 }
    : { SETS_TO_WIN: 2, MAX_SETS: 3, POINTS_TO_WIN: 11, MIN_POINT_DIFF: 2 };
  const config = JSON.parse(searchParams.get('config') || JSON.stringify(defaultConfig));
  const team1Members: string[] = matchType === 'team' ? JSON.parse(searchParams.get('t1m') || '[]') : [];
  const team2Members: string[] = matchType === 'team' ? JSON.parse(searchParams.get('t2m') || '[]') : [];

  const { match, updateMatch, startMatch, addAction } = usePracticeMatch({
    matchType,
    player1Name: p1Name,
    player2Name: p2Name,
    config,
    team1Members,
    team2Members,
  });

  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);
  const [showSideChange, setShowSideChange] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSetEndConfirm, setShowSetEndConfirm] = useState(false);
  const [setEndMessage, setSetEndMessage] = useState('');
  // Warmup
  const [showWarmup, setShowWarmup] = useState(false);
  // Coin toss
  const [coinTossStep, setCoinTossStep] = useState<'toss' | 'choice' | 'warmup_ask'>('toss');
  const [tossWinner, setTossWinner] = useState<'player1' | 'player2' | null>(null);
  const [pendingFirstServe, setPendingFirstServe] = useState<'player1' | 'player2' | null>(null);
  // Coach - read from URL params (individual: p1c/p2c, team: t1c/t2c)
  const [player1Coach, setPlayer1Coach] = useState(searchParams.get('p1c') || '');
  const [player2Coach, setPlayer2Coach] = useState(searchParams.get('p2c') || '');
  const t1c = searchParams.get('t1c') || '';
  const t2c = searchParams.get('t2c') || '';
  // Penalty & timeout dropdowns (same as real match mode)
  type DropdownKey = 'player1' | 'player2' | null;
  const [penaltyDropdown, setPenaltyDropdown] = useState<DropdownKey>(null);
  const [timeoutDropdown, setTimeoutDropdown] = useState<DropdownKey>(null);
  const penaltyDropdownRef = useRef<HTMLDivElement>(null);
  const timeoutDropdownRef = useRef<HTMLDivElement>(null);
  // Pause
  const [isPausedLocal, setIsPausedLocal] = useState(false);
  const [rotationInfo, setRotationInfo] = useState('');
  const [showSubModal, setShowSubModal] = useState(false);
  const [subTeam, setSubTeam] = useState<1 | 2 | null>(null);
  const [subOutIdx, setSubOutIdx] = useState<number | null>(null);
  const [subInIdx, setSubInIdx] = useState<number | null>(null);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const [pauseReason, setPauseReason] = useState('');

  const setEndTrapRef = useFocusTrap(showSetEndConfirm);
  const subModalTrapRef = useFocusTrap(showSubModal);

  // TTS helper
  function speak(text: string) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = getLocale();
      utterance.rate = 1.2;
      window.speechSynthesis.speak(utterance);
    }
  }

  // Timers
  const sideChangeTimer = useCountdownTimer(() => setShowSideChange(false));
  const warmupTimer = useCountdownTimer(() => setShowWarmup(false));
  const timeoutTimer = useCountdownTimer(() => updateMatch({ activeTimeout: null }));

  // 15초 안내 (타임아웃)
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

  // 워밍업 15초 알림
  useEffect(() => {
    if (warmupTimer.isRunning) {
      if (matchType === 'team') {
        if (warmupTimer.seconds === 30) {
          setLastAction(`⚠️ ${t('referee.scoring.fifteenSecondsLeft')}`);
          setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
          speak(t('referee.scoring.fifteenSecondsLeft'));
        }
      } else {
        if (warmupTimer.seconds === 15) {
          setLastAction(`⚠️ ${t('referee.scoring.fifteenSecondsLeft')}`);
          setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
          speak(t('referee.scoring.fifteenSecondsLeft'));
        }
      }
    }
  }, [warmupTimer.seconds, warmupTimer.isRunning, matchType]);

  // localStorage sharing (spectator mode)
  useEffect(() => {
    if (match.status === 'in_progress') {
      localStorage.setItem('showdown_practice_live', JSON.stringify([match]));
    } else if (match.status === 'completed') {
      localStorage.removeItem('showdown_practice_live');
      // 완료된 경기를 별도 저장 (관람용)
      try {
        const completed: PracticeMatch[] = JSON.parse(localStorage.getItem('showdown_practice_completed') || '[]');
        completed.unshift(match);
        localStorage.setItem('showdown_practice_completed', JSON.stringify(completed.slice(0, 20)));
      } catch { /* ignore */ }
    }
    return () => { localStorage.removeItem('showdown_practice_live'); };
  }, [match]);

  // Timeout timer
  useEffect(() => {
    if (match.activeTimeout) {
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
  }, [match.activeTimeout, timeoutTimer]);

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

  // Pause elapsed counter
  useEffect(() => {
    if (!isPausedLocal) return;
    const interval = setInterval(() => setPauseElapsed(p => p + 1), 1000);
    return () => clearInterval(interval);
  }, [isPausedLocal]);

  // Pause
  const handlePause = useCallback(() => {
    if (match.status !== 'in_progress' || isPausedLocal) return;
    const reason = prompt(t('referee.scoring.pausePrompt'));
    if (reason === null) return;
    const actualReason = reason || t('referee.scoring.noReason');
    setIsPausedLocal(true);
    setPauseReason(actualReason);
    setPauseElapsed(0);
    const pauseEntry = {
      time: formatTime(),
      reason: actualReason,
      set: match.currentSet + 1,
    };
    updateMatch({ isPaused: true, pauseHistory: [...match.pauseHistory, pauseEntry] });
  }, [match.status, match.currentSet, match.pauseHistory, isPausedLocal, updateMatch]);

  const handleResume = useCallback(() => {
    const updated = [...match.pauseHistory];
    if (updated.length > 0) {
      updated[updated.length - 1] = { ...updated[updated.length - 1], duration: pauseElapsed };
    }
    setIsPausedLocal(false);
    setPauseElapsed(0);
    setPauseReason('');
    updateMatch({ isPaused: false, pauseHistory: updated });
  }, [match.pauseHistory, pauseElapsed, updateMatch]);

  // IBSA score
  const handleIBSAScore = useCallback((
    actingPlayer: 1 | 2,
    actionType: ScoreActionType,
    points: number,
    toOpponent: boolean,
    label: string,
  ) => {
    if (!canAct()) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout || showSideChange) return;

    startProcessing();
    try {

    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    const scoreBefore = { player1: cs.player1Score, player2: cs.player2Score };
    const scoringPlayer = toOpponent ? (actingPlayer === 1 ? 2 : 1) : actingPlayer;

    if (scoringPlayer === 1) cs.player1Score += points;
    else cs.player2Score += points;
    sets[ci] = cs;

    const scoreAfter = { player1: cs.player1Score, player2: cs.player2Score };

    const serverName = match.currentServe === 'player1' ? p1Name : p2Name;
    const serveNumber = match.serveCount + 1;

    const historyEntry = createScoreHistoryEntry({
      scoringPlayer: scoringPlayer === 1 ? p1Name : p2Name,
      actionPlayer: actingPlayer === 1 ? p1Name : p2Name,
      actionType, actionLabel: label, points,
      set: ci + 1,
      server: serverName, serveNumber,
      scoreBefore, scoreAfter,
    });

    const { currentServe: nextServe, serveCount: nextCount } = advanceServe(
      match.currentServe, match.serveCount, matchType,
    );

    // 팀전: 서브를 마친 팀이 선수 교체 (로테이션)
    let rotationEntry: ReturnType<typeof createScoreHistoryEntry> | null = null;
    let rotationUpdate: Partial<PracticeMatch> = {};
    let rotationAnnounce = '';
    if (matchType === 'team' && nextCount === 0 && nextServe !== match.currentServe) {
      // 서브를 마친 팀 = match.currentServe 쪽 팀이 로테이션
      const finishedServeTeam = match.currentServe; // 서브를 방금 마친 팀
      const rotTeamName = finishedServeTeam === 'player1' ? p1Name : p2Name;
      const rotMembers = finishedServeTeam === 'player1' ? match.team1Members : match.team2Members;
      const rotIdxKey = finishedServeTeam === 'player1' ? 'team1CurrentPlayerIndex' : 'team2CurrentPlayerIndex';
      const currentRotIdx = (finishedServeTeam === 'player1' ? match.team1CurrentPlayerIndex : match.team2CurrentPlayerIndex) ?? 0;
      const activeCount = Math.min(3, rotMembers?.length ?? 0);
      const nextRotIdx = activeCount > 0 ? (currentRotIdx + 1) % activeCount : 0;
      const prevPlayerName = rotMembers?.[currentRotIdx] || '';
      const nextPlayerName = rotMembers?.[nextRotIdx] || '';

      rotationEntry = createScoreHistoryEntry({
        scoringPlayer: '',
        actionPlayer: rotTeamName,
        actionType: 'player_rotation',
        actionLabel: nextPlayerName ? `${t('common.matchHistory.substitution')}: ${prevPlayerName} → ${nextPlayerName} (${rotTeamName})` : `${t('common.matchHistory.playerRotation')} (${rotTeamName})`,
        points: 0,
        set: ci + 1,
        server: nextServe === 'player1' ? p1Name : p2Name,
        serveNumber: 1,
        scoreBefore: scoreAfter,
        scoreAfter: scoreAfter,
        serverSide: nextServe,
      });
      rotationUpdate = rotIdxKey === 'team1CurrentPlayerIndex'
        ? { team1CurrentPlayerIndex: nextRotIdx }
        : { team2CurrentPlayerIndex: nextRotIdx };
      if (nextPlayerName && prevPlayerName !== nextPlayerName) {
        rotationAnnounce = `${rotTeamName} ${t('common.matchHistory.substitution')}: ${prevPlayerName} → ${nextPlayerName}`;
        setRotationInfo(rotationAnnounce);
        setTimeout(() => setRotationInfo(''), 4000);
      }
    }

    const newHistory = rotationEntry
      ? [rotationEntry, historyEntry, ...match.scoreHistory]
      : [historyEntry, ...match.scoreHistory];

    addAction({ type: 'score', player: actingPlayer, detail: `${label} (${points}${t('common.units.point')})` });
    setScoreFlash(f => f + 1);

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;

    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${pName} +${points}${t('common.units.point')}`
      : `${pName} ${t('common.scoreActions.goal')}! +${points}${t('common.units.point')}`;
    setLastAction(rotationAnnounce
      ? `${actionDesc} | ${scoreAfter.player1} : ${scoreAfter.player2} | ${rotationAnnounce}`
      : `${actionDesc} | ${scoreAfter.player1} : ${scoreAfter.player2}`);

    const serverScore = nextServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = nextServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;
    const announceBase = `${pName} ${points}${t('common.units.point')}. ${t('common.matchHistory.score')} ${serverScore} : ${receiverScore}. ${t('referee.scoring.firstServe', { name: nextServerName })}`;
    setAnnouncement(rotationAnnounce ? `${announceBase}. ${rotationAnnounce}` : announceBase);

    // Set winner check with confirmation
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, config);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? 'player1' : 'player2';
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, config);

      // Save state first
      updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory, ...rotationUpdate,
      });

      // Show confirmation after 500ms delay
      setTimeout(() => {
        if (matchWinner) {
          const winnerName = matchWinner === 1 ? p1Name : p2Name;
          const setWinsCalc = countSetWins(sets, config);
          setSetEndMessage(`${winnerName}! (${t('common.units.set')} ${setWinsCalc.player1}:${setWinsCalc.player2})\n${t('common.matchHistory.score')}: ${cs.player1Score} - ${cs.player2Score}`);
        } else {
          const setWinsCalc = countSetWins(sets, config);
          setSetEndMessage(`${t('common.matchHistory.setLabel', { num: ci + 1 })}?\n\n${t('common.matchHistory.score')}: ${cs.player1Score} - ${cs.player2Score}\n${t('common.units.set')}: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
        }
        setShowSetEndConfirm(true);
      }, 500);
      return;
    }

    // Side change
    if (shouldSideChange(matchType, cs, match.sideChangeUsed, sets, config)) {
      updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        sideChangeUsed: true, scoreHistory: newHistory, ...rotationUpdate,
      });
      sideChangeTimer.start(60);
      setShowSideChange(true);
      return;
    }

    updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory, ...rotationUpdate,
    });

    } finally { done(); }
  }, [match, config, updateMatch, addAction, p1Name, p2Name, matchType, canAct, startProcessing, done, sideChangeTimer, showSideChange]);

  // Confirm set end
  const handleConfirmSetEnd = useCallback(() => {
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;

    const matchWinner = checkMatchWinner(sets, config);
    if (matchWinner) {
      const winnerId = matchWinner === 1 ? 'player1' : 'player2';
      updateMatch({
        sets, status: 'completed', winnerId, completedAt: Date.now(),
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
    } else {
      sets.push(createEmptySet());
      updateMatch({
        sets, currentSet: ci + 1,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        sideChangeUsed: false,
      });
    }
    setShowSetEndConfirm(false);
  }, [match, config, updateMatch, matchType, addSession]);

  const handleCancelSetEnd = useCallback(() => {
    setShowSetEndConfirm(false);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (match.status !== 'in_progress' || match.scoreHistory.length === 0) return;

    const lastEntry = match.scoreHistory[0];
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    cs.player1Score = lastEntry.scoreBefore.player1;
    cs.player2Score = lastEntry.scoreBefore.player2;
    cs.winnerId = null;
    sets[ci] = cs;

    const { currentServe, serveCount } = revertServe(
      match.currentServe, match.serveCount, matchType,
    );

    updateMatch({ sets, currentServe, serveCount, scoreHistory: match.scoreHistory.slice(1) });
    const serverAfterUndo = currentServe === 'player1' ? p1Name : p2Name;
    const msg = `${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}. ${serverAfterUndo} ${t('common.matchHistory.serve')}`;
    setAnnouncement(msg);
    setLastAction(`↩️ ${msg}`);
  }, [match, updateMatch, p1Name, p2Name, matchType]);

  const handleChangeServe = useCallback(() => {
    if (match.status !== 'in_progress') return;
    updateMatch({
      currentServe: match.currentServe === 'player1' ? 'player2' : 'player1',
      serveCount: 0,
    });
    const newServer = match.currentServe === 'player1' ? p2Name : p1Name;
    setAnnouncement(`${t('common.matchHistory.serve')}: ${newServer}`);
  }, [match, updateMatch, p1Name, p2Name]);

  // Dead Ball - 양쪽 모두 가능
  const handleDeadBall = useCallback((player: 1 | 2) => {
    if (match.status !== 'in_progress' || match.isPaused || match.activeTimeout) return;
    const ci = match.currentSet;
    const cs = match.sets[ci];
    if (!cs) return;
    const sName = match.currentServe === 'player1' ? p1Name : p2Name;
    const actionName = player === 1 ? p1Name : p2Name;
    const scoreBefore = { player1: cs.player1Score, player2: cs.player2Score };
    const entry = createScoreHistoryEntry({
      scoringPlayer: '',
      actionPlayer: actionName,
      actionType: 'dead_ball',
      actionLabel: `${actionName} ${t('common.matchHistory.deadBall', { server: '' })}`,
      points: 0,
      set: ci + 1,
      server: sName,
      serveNumber: match.serveCount + 1,
      scoreBefore,
      scoreAfter: scoreBefore,
      serverSide: match.currentServe,
    });
    updateMatch({ scoreHistory: [entry, ...match.scoreHistory] });
    setLastAction(`${actionName} ${t('common.matchHistory.deadBall', { server: sName })}`);
    setAnnouncement(`${actionName} ${t('common.matchHistory.deadBall', { server: sName })}`);
  }, [match, updateMatch, p1Name, p2Name]);

  const handleSubstitution = useCallback(() => {
    if (subTeam === null || subOutIdx === null || subInIdx === null) return;
    const members = subTeam === 1 ? [...(match.team1Members || [])] : [...(match.team2Members || [])];
    const activeCount = 3; // first 3 are active
    const outName = members[subOutIdx];
    const inName = members[activeCount + subInIdx];
    // Swap
    members[subOutIdx] = inName;
    members[activeCount + subInIdx] = outName;

    const teamName = subTeam === 1 ? p1Name : p2Name;
    const entry = createScoreHistoryEntry({
      scoringPlayer: '',
      actionPlayer: teamName,
      actionType: 'substitution',
      actionLabel: `${t('common.matchHistory.substitution')}: ${outName} → ${inName} (${teamName})`,
      points: 0,
      set: match.currentSet + 1,
      server: match.currentServe === 'player1' ? p1Name : p2Name,
      serveNumber: match.serveCount + 1,
      scoreBefore: { player1: match.sets[match.currentSet]?.player1Score ?? 0, player2: match.sets[match.currentSet]?.player2Score ?? 0 },
      scoreAfter: { player1: match.sets[match.currentSet]?.player1Score ?? 0, player2: match.sets[match.currentSet]?.player2Score ?? 0 },
      serverSide: match.currentServe,
    });

    const update: Partial<PracticeMatch> = {
      scoreHistory: [entry, ...match.scoreHistory],
    };
    if (subTeam === 1) {
      update.team1Members = members;
      update.team1PlayerOrder = members.slice(0, activeCount);
      update.team1SubUsed = true;
    } else {
      update.team2Members = members;
      update.team2PlayerOrder = members.slice(0, activeCount);
      update.team2SubUsed = true;
    }
    updateMatch(update);

    setLastAction(`${teamName} ${t('common.matchHistory.substitution')}: ${outName} → ${inName}`);
    setAnnouncement(`${teamName} ${t('common.matchHistory.substitution')}. ${outName} → ${inName}`);
    setShowSubModal(false);
    setSubTeam(null);
    setSubOutIdx(null);
    setSubInIdx(null);
  }, [match, subTeam, subOutIdx, subInIdx, p1Name, p2Name, updateMatch]);

  const handleTimeout = useCallback((player: 1 | 2, type: 'player' | 'medical' | 'referee' = 'player') => {
    if (match.status !== 'in_progress') return;
    // player timeout: 1회 제한
    if (type === 'player') {
      const used = player === 1 ? match.player1Timeouts : match.player2Timeouts;
      if (used >= 1) return;
    }
    // medical timeout: 1회 제한
    if (type === 'medical') {
      const pName = player === 1 ? p1Name : p2Name;
      const medUsed = match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === pName).length;
      if (medUsed >= 1) return;
    }
    const actionType = type === 'player' ? 'timeout_player' : type === 'medical' ? 'timeout_medical' : 'timeout_referee';
    const actionLabel = type === 'player' ? t('referee.scoring.timeoutTitle.player') : type === 'medical' ? t('referee.scoring.timeoutTitle.medical') : t('referee.scoring.timeoutTitle.referee');
    const pName = type === 'referee' ? '' : (player === 1 ? p1Name : p2Name);
    const ci = match.currentSet;
    const cs = match.sets[ci];
    const scoreBefore = { player1: cs?.player1Score ?? 0, player2: cs?.player2Score ?? 0 };
    const timeoutEntry = createScoreHistoryEntry({
      scoringPlayer: '',
      actionPlayer: pName,
      actionType: actionType as ScoreActionType,
      actionLabel,
      points: 0,
      set: ci + 1,
      server: match.currentServe === 'player1' ? p1Name : p2Name,
      serveNumber: match.serveCount + 1,
      scoreBefore,
      scoreAfter: scoreBefore,
      serverSide: match.currentServe,
    });
    const duration = type === 'player' ? 60 : type === 'medical' ? 300 : 0;
    const up: Partial<typeof match> = {
      activeTimeout: { playerId: `player${player}`, startTime: Date.now(), type },
      scoreHistory: [timeoutEntry, ...match.scoreHistory],
    };
    if (type === 'player') {
      if (player === 1) up.player1Timeouts = match.player1Timeouts + 1;
      else up.player2Timeouts = match.player2Timeouts + 1;
    }
    updateMatch(up);
    addAction({ type: 'timeout', player });
    if (duration > 0) timeoutTimer.start(duration);
  }, [match, updateMatch, addAction, p1Name, p2Name, timeoutTimer]);

  // 벌점 핸들러: 경고 카운트를 scoreHistory에서 동적 계산
  // Note: canAct() is NOT called here to avoid double-guard with handleIBSAScore
  const handlePenalty = useCallback((
    actingPlayer: 1 | 2,
    penaltyType: 'penalty_table_pushing' | 'penalty_electronic' | 'penalty_talking',
  ) => {
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout || showSideChange) return;

    const actorName = actingPlayer === 1 ? p1Name : p2Name;

    // penalty_electronic은 즉시 2점
    if (penaltyType === 'penalty_electronic') {
      const label = `${actorName} ${t('common.scoreActions.penaltyElectronic')}`;
      handleIBSAScore(actingPlayer, penaltyType, 2, true, label);
      return;
    }

    // penalty_table_pushing, penalty_talking: 경고 → 실점 → 경고 → 실점 (반복 사이클)
    const totalPenaltyCount = match.scoreHistory.filter(
      h => h.actionType === penaltyType && h.actionPlayer === actorName
    ).length;

    if (totalPenaltyCount % 2 === 0) {
      // 첫 번째: 경고만
      const ci = match.currentSet;
      const cs = match.sets[ci];
      const scoreBefore = { player1: cs?.player1Score ?? 0, player2: cs?.player2Score ?? 0 };
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? t('common.scoreActions.penaltyTablePushing') : t('common.scoreActions.penaltyTalking');
      const warningEntry = createScoreHistoryEntry({
        scoringPlayer: '',
        actionPlayer: actorName,
        actionType: penaltyType as ScoreActionType,
        actionLabel: penaltyLabel,
        points: 0,
        set: ci + 1,
        server: match.currentServe === 'player1' ? p1Name : p2Name,
        serveNumber: match.serveCount + 1,
        scoreBefore,
        scoreAfter: scoreBefore,
        serverSide: match.currentServe,
      });
      warningEntry.penaltyWarning = true;
      updateMatch({ scoreHistory: [warningEntry, ...match.scoreHistory] });
      setLastAction(`⚠️ ${actorName} ${t('common.matchHistory.warning', { player: actorName, action: penaltyLabel })}`);
      setAnnouncement(`${actorName} ${t('common.matchHistory.warning', { player: actorName, action: penaltyLabel })}`);
    } else {
      // 2회 이상: 2점 실점
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? t('common.scoreActions.penaltyTablePushing') : t('common.scoreActions.penaltyTalking');
      const label = `${actorName} ${penaltyLabel}`;
      handleIBSAScore(actingPlayer, penaltyType, 2, true, label);
    }
  }, [match, canAct, startProcessing, done, handleIBSAScore, updateMatch, p1Name, p2Name, showSideChange]);

  // Helper: start match with full history entries (matching real match mode)
  const handleStartPracticeMatch = useCallback((firstServe: 'player1' | 'player2', withWarmup: boolean) => {
    const winnerName = tossWinner === 'player1' ? p1Name : p2Name;
    const choiceLabel = firstServe === (tossWinner ?? 'player1') ? t('referee.scoring.serveChoice') : t('referee.scoring.receiveChoice');
    const serverName = firstServe === 'player1' ? p1Name : p2Name;
    const now = () => formatTime();
    const baseMeta = {
      server: serverName, serveNumber: 1,
      scoreBefore: { player1: 0, player2: 0 }, scoreAfter: { player1: 0, player2: 0 },
      serverSide: firstServe as 'player1' | 'player2',
    };

    const coinTossEntry: ScoreHistoryEntry = {
      time: now(), scoringPlayer: '', actionPlayer: winnerName,
      actionType: 'coin_toss',
      actionLabel: t('referee.scoring.coinTossWinner', { winner: winnerName, choice: choiceLabel }),
      points: 0, set: 1, ...baseMeta,
    };

    // Effective coach values (team mode uses URL params, individual uses local state)
    const c1 = matchType === 'team' ? t1c : player1Coach;
    const c2 = matchType === 'team' ? t2c : player2Coach;

    const coachEntries: ScoreHistoryEntry[] = [];
    if (c1 || c2) {
      const coachInfo = [c1 ? `${p1Name}: ${c1}` : '', c2 ? `${p2Name}: ${c2}` : ''].filter(Boolean).join(', ');
      coachEntries.push({
        time: now(), scoringPlayer: '', actionPlayer: '', actionType: 'match_start',
        actionLabel: coachInfo, points: 0, set: 1, ...baseMeta,
      });
    }

    const matchStartEntry: ScoreHistoryEntry = {
      time: now(), scoringPlayer: '', actionPlayer: '', actionType: 'match_start',
      actionLabel: t('referee.scoring.matchStartLabel'), points: 0, set: 1, ...baseMeta,
    };

    const warmupEntries: ScoreHistoryEntry[] = [];
    if (withWarmup) {
      const warmupDuration = matchType === 'team' ? 90 : 60;
      warmupEntries.push({
        time: now(), scoringPlayer: '', actionPlayer: '', actionType: 'warmup_start',
        actionLabel: `${t('referee.scoring.warmupStart')} (${warmupDuration}${t('common.time.seconds')})`, points: 0, set: 1, ...baseMeta,
      });
    }

    startMatch(firstServe);
    updateMatch({
      scoreHistory: [...warmupEntries, matchStartEntry, ...coachEntries, coinTossEntry],
      warmupUsed: withWarmup,
      coinTossWinner: tossWinner === 'player1' ? 'team1' : 'team2',
      coinTossChoice: firstServe === (tossWinner ?? 'player1') ? 'serve' : 'receive',
      player1Coach: c1 || undefined,
      player2Coach: c2 || undefined,
    });

    if (withWarmup) {
      warmupTimer.start(matchType === 'team' ? 90 : 60);
      setShowWarmup(true);
    }
  }, [tossWinner, p1Name, p2Name, matchType, player1Coach, player2Coach, t1c, t2c, startMatch, updateMatch, warmupTimer]);

  // ===== PENDING =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>{t('referee.practice.home.title')}</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{p1Name}</span>
          <span className="text-gray-400">vs</span>
          <span className="text-cyan-400 font-bold">{p2Name}</span>
        </div>
        <p className="text-gray-400">
          {matchType === 'team' ? t('referee.practice.scoring.rulesDisplayTeam') : t('referee.practice.scoring.rulesDisplay', { points: config.POINTS_TO_WIN, setsToWin: config.SETS_TO_WIN })}
        </p>

        {/* {t('referee.practice.setup.coachOptional')} (개인전만 - 팀전은 설정에서 입력) */}
        {matchType === 'individual' && coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-3">
            <h2 className="text-lg font-bold text-center text-gray-300">{t('referee.practice.setup.coachOptional')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-yellow-400 mb-1">{p1Name} {t('referee.practice.setup.coachOptional')}</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                  placeholder={t('referee.practice.setup.coachAriaLabel')}
                  value={player1Coach}
                  onChange={e => setPlayer1Coach(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-cyan-400 mb-1">{p2Name} {t('referee.practice.setup.coachOptional')}</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                  placeholder={t('referee.practice.setup.coachAriaLabel')}
                  value={player2Coach}
                  onChange={e => setPlayer2Coach(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.coinToss')}</h2>
            <div className="flex gap-4">
              <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { setTossWinner('player1'); setCoinTossStep('choice'); }}>
                {p1Name}
              </button>
              <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { setTossWinner('player2'); setCoinTossStep('choice'); }}>
                {p2Name}
              </button>
            </div>
          </div>
        )}
        {coinTossStep === 'choice' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">
              {tossWinner === 'player1' ? p1Name : p2Name} !
            </h2>
            <p className="text-gray-400 text-center">{t('referee.scoring.serveChoice')} / {t('referee.scoring.receiveChoice')}</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner); setCoinTossStep('warmup_ask'); }} aria-label={`${tossWinner === 'player1' ? p1Name : p2Name} ${t('referee.scoring.serveChoice')}`}>
                {t('referee.scoring.serveChoice')}
              </button>
              <button className="btn btn-accent btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner === 'player1' ? 'player2' : 'player1'); setCoinTossStep('warmup_ask'); }} aria-label={`${tossWinner === 'player1' ? p1Name : p2Name} ${t('referee.scoring.receiveChoice')}`}>
                {t('referee.scoring.receiveChoice')}
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }} aria-label={t('referee.practice.scoring.coinTossBackAriaLabel')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        )}
        {coinTossStep === 'warmup_ask' && pendingFirstServe && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.warmupStart')}</h2>
            <p className="text-gray-400 text-center">{t('referee.practice.scoring.coinTossWarmupAsk', { duration: matchType === 'team' ? `90${t('common.time.seconds')}` : `60${t('common.time.seconds')}` })}</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => {
                handleStartPracticeMatch(pendingFirstServe, true);
              }}>
                {t('referee.scoring.warmupStart')}
              </button>
              <button className="btn btn-secondary btn-large flex-1 text-xl py-6" onClick={() => {
                handleStartPracticeMatch(pendingFirstServe, false);
              }}>
                {t('referee.scoring.matchStartLabel')}
              </button>
            </div>
          </div>
        )}

        <button className="btn btn-accent" onClick={() => navigate('/referee/practice/setup')}>{t('common.back')}</button>
      </div>
    );
  }

  // ===== COMPLETED =====
  if (match.status === 'completed') {
    const winnerName = match.winnerId === 'player1' ? p1Name : p2Name;
    const setWins = countSetWins(match.sets, config);
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>{t('referee.practice.scoring.matchEnd')} - {t('referee.practice.home.title')}</h1>
        <div className="text-4xl font-bold text-green-400" role="status" aria-live="assertive">🏆 {winnerName} !</div>
        <div className="text-2xl text-gray-300" aria-label={t('referee.practice.scoring.setScoreAriaLabel', { p1: setWins.player1, p2: setWins.player2 })}>{t('referee.practice.scoring.setScoreResult', { p1: setWins.player1, p2: setWins.player2 })}</div>
        {match.sets.map((s: SetScore, i: number) => {
          const winner = s.player1Score > s.player2Score ? p1Name : p2Name;
          return (
            <div key={i} className="text-lg text-gray-400">
              {t('referee.practice.scoring.setResultDetail', { num: i + 1, p1Score: s.player1Score, p2Score: s.player2Score, winner })}
            </div>
          );
        })}
        <p className="text-gray-400">{t('referee.practice.scoring.totalActions', { count: match.actionLog.length, seconds: Math.floor((match.completedAt! - match.startedAt) / 1000) })}</p>

        {match.scoreHistory.length > 0 && (
          <div className="w-full max-w-lg mx-auto flex-1 min-h-0">
            <ScoreHistoryView history={match.scoreHistory} sets={match.sets} />
          </div>
        )}

        <div className="flex gap-4">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/practice/setup')}>{t('referee.practice.home.startPractice')}</button>
          <button className="btn btn-secondary btn-large" onClick={() => navigate('/referee/practice')}>{t('common.home')}</button>
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

  const foulActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points === 1);
  const penaltyActions = IBSA_SCORE_ACTIONS.filter(a => a.toOpponent && a.points >= 2);

  // Server-based score flip
  const isFlipped = match.currentServe === 'player2';
  const leftName = isFlipped ? p2Name : p1Name;
  const rightName = isFlipped ? p1Name : p2Name;
  const leftScore = isFlipped ? cs.player2Score : cs.player1Score;
  const rightScore = isFlipped ? cs.player1Score : cs.player2Score;
  const leftColor = isFlipped ? 'text-cyan-400' : 'text-yellow-400';
  const rightColor = isFlipped ? 'text-yellow-400' : 'text-cyan-400';

  return (
    <div className="min-h-screen flex flex-col">
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>
      <ActionToast message={lastAction} />

      {/* Warmup Timer Modal */}
      {showWarmup && warmupTimer.isRunning && (
        <TimerModal
          title={`🔥 ${t('referee.practice.scoring.warmupTitle')}`}
          seconds={warmupTimer.seconds}
          isWarning={warmupTimer.isWarning}
          subtitle={matchType === 'team' ? `${t('referee.home.teamMatch')} (90${t('common.time.seconds')})` : `${t('referee.practice.setup.individual')} (60${t('common.time.seconds')})`}
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); }}
          closeLabel={t('referee.practice.scoring.warmupEnd')}
        />
      )}

      {/* Side Change Timer */}
      {showSideChange && (
        <TimerModal
          title={t('referee.practice.scoring.sideChangeTitle')}
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle={t('referee.practice.scoring.sideChangeSubtitle')}
          onClose={() => { sideChangeTimer.stop(); setShowSideChange(false); }}
          closeLabel={t('referee.practice.scoring.confirmButton')}
          required
        />
      )}

      {/* Timeout Modal */}
      {match.activeTimeout && (timeoutTimer.isRunning || match.activeTimeout.type === 'referee') && (
        <TimerModal
          title={match.activeTimeout.type === 'medical' ? `🏥 ${t('referee.scoring.timeoutTitle.medical')}` : match.activeTimeout.type === 'referee' ? `🟨 ${t('referee.scoring.timeoutTitle.referee')}` : `⏱️ ${t('referee.scoring.timeoutTitle.player')}`}
          seconds={timeoutTimer.seconds}
          isWarning={timeoutTimer.isWarning}
          subtitle={match.activeTimeout.type === 'referee' ? '' : undefined}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); }}
          closeLabel={t('referee.practice.scoring.timeoutEndButton')}
        />
      )}

      {/* Substitution Modal */}
      {showSubModal && subTeam && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onKeyDown={e => { if (e.key === 'Escape') { setShowSubModal(false); setSubTeam(null); setSubOutIdx(null); setSubInIdx(null); } }}>
          <div ref={subModalTrapRef} className="flex flex-col items-center gap-4 p-6 max-w-sm w-full" role="dialog" aria-modal="true" aria-label={t('referee.practice.scoring.substitutionModal')}>
            <h2 className="text-xl font-bold text-yellow-400">{t('referee.practice.scoring.playerSubstitution', { name: subTeam === 1 ? p1Name : p2Name })}</h2>
            <div className="w-full space-y-3">
              <div>
                <p className="text-sm text-gray-400 mb-2">{t('referee.practice.scoring.selectOutPlayer')}</p>
                <div className="flex flex-col gap-1">
                  {(subTeam === 1 ? match.team1Members : match.team2Members)?.slice(0, 3).map((name, i) => (
                    <button key={i} className={`btn text-left py-2 px-3 ${subOutIdx === i ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white'}`} aria-pressed={subOutIdx === i} onClick={() => setSubOutIdx(i)}>
                      {i + 1}. {name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-400 mb-2">{t('referee.practice.scoring.selectInPlayer')}</p>
                <div className="flex flex-col gap-1">
                  {(subTeam === 1 ? match.team1Members : match.team2Members)?.slice(3).map((name, i) => (
                    <button key={i} className={`btn text-left py-2 px-3 ${subInIdx === i ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white'}`} aria-pressed={subInIdx === i} onClick={() => setSubInIdx(i)}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 w-full">
              <button className="btn btn-success flex-1" onClick={handleSubstitution} disabled={subOutIdx === null || subInIdx === null}>{t('referee.practice.scoring.confirmSubstitution')}</button>
              <button className="btn btn-secondary flex-1" onClick={() => { setShowSubModal(false); setSubTeam(null); setSubOutIdx(null); setSubInIdx(null); }}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Set End Confirmation */}
      {showSetEndConfirm && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onKeyDown={e => { if (e.key === 'Escape') handleCancelSetEnd(); }}>
          <div ref={setEndTrapRef} className="flex flex-col items-center gap-6 p-8 max-w-sm" role="dialog" aria-modal="true" aria-label={t('referee.practice.scoring.setEndConfirm')}>
            <h2 className="text-2xl font-bold text-yellow-400">{t('referee.practice.scoring.setEndConfirm')}</h2>
            <p className="text-lg text-gray-300 text-center whitespace-pre-line">{setEndMessage}</p>
            <div className="flex gap-4 w-full">
              <button className="btn btn-success btn-large flex-1" onClick={handleConfirmSetEnd}>{t('common.confirm')}</button>
              <button className="btn btn-secondary btn-large flex-1" onClick={handleCancelSetEnd}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Banner */}
      {isPausedLocal && (
        <div className="bg-orange-900/80 px-4 py-3 flex items-center justify-between" role="status" aria-live="polite" aria-label={t('referee.practice.scoring.matchPaused')}>
          <div>
            <span className="text-orange-300 font-bold">⏸️ {t('referee.practice.scoring.matchPaused')}</span>
            <span className="text-orange-200 ml-3" aria-label={`${t('referee.scoring.elapsedTime')} ${Math.floor(pauseElapsed / 60)}${t('common.time.minutes')} ${pauseElapsed % 60}${t('common.time.seconds')}`}>
              {Math.floor(pauseElapsed / 60)}:{(pauseElapsed % 60).toString().padStart(2, '0')}
            </span>
            {pauseReason && <span className="text-orange-200/70 ml-3 text-sm">({pauseReason})</span>}
          </div>
          <button className="btn btn-success text-sm px-4 py-1" onClick={handleResume} aria-label={t('referee.practice.scoring.resumeAriaLabel')}>▶ {t('referee.practice.scoring.resumeButton')}</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/practice')} aria-label={`${t('referee.practice.scoring.practiceHome')} ${t('common.back')}`}>← {t('referee.practice.scoring.practiceHome')}</button>
          <div className="text-center">
            <h1 className="text-lg font-bold" style={{ color: '#c084fc' }}>
              {matchType === 'team' ? t('referee.home.teamMatch') : `${t('common.matchHistory.setLabel', { num: ci + 1 })}/${config.MAX_SETS}`}
            </h1>
            {matchType === 'individual' && (
              <div className="text-sm text-gray-400" aria-label={t('referee.practice.scoring.setScoreAriaLabel', { p1: setWins.player1, p2: setWins.player2 })}>{t('referee.practice.scoring.setScoreResult', { p1: setWins.player1, p2: setWins.player2 })}</div>
            )}
          </div>
          <div className="text-sm text-gray-400">{t('referee.practice.scoring.practiceLabel')}</div>
        </div>
      </div>

      {/* Serve */}
      <div className="bg-blue-900/50 px-4 py-2 text-center" role="status" aria-label={t('referee.practice.scoring.serveInfo', { name: serverName, current: match.serveCount + 1, max: maxServes })}>
        <span className="text-blue-300 font-semibold">
          🎾 {t('referee.practice.scoring.serveInfo', { name: serverName, current: match.serveCount + 1, max: maxServes })}
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label={t('referee.practice.scoring.changeServeAriaLabel')} style={{ minHeight: '44px', minWidth: '44px' }}>
          {t('referee.practice.scoring.changeServe')}
        </button>
      </div>

      {/* 팀전: 현재 출전 선수 표시 */}
      {matchType === 'team' && match.team1Members && match.team1Members.length > 0 && (
        <div className="bg-gray-800/50 px-4 py-1.5 text-center text-sm flex justify-center gap-4">
          <span className="text-yellow-400">
            {p1Name}: <strong>{match.team1Members[match.team1CurrentPlayerIndex ?? 0]}</strong>
          </span>
          <span className="text-gray-400">|</span>
          <span className="text-cyan-400">
            {p2Name}: <strong>{match.team2Members?.[match.team2CurrentPlayerIndex ?? 0]}</strong>
          </span>
        </div>
      )}
      {rotationInfo && (
        <div className="bg-purple-900/70 px-4 py-2 text-center" role="alert">
          <span className="text-purple-300 font-bold">🔄 {rotationInfo}</span>
        </div>
      )}

      {/* Score display - server on left */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-4 px-2 border-r border-gray-700" style={{ border: isFlipped ? undefined : '3px solid rgba(234,179,8,0.3)', borderRadius: 0 }}>
          <h2 className={`text-xl font-bold ${leftColor}`}>
            🎾 {leftName}
          </h2>
          {(isFlipped ? match.player2Coach : match.player1Coach) && (
            <span className="text-xs text-gray-400">{t('referee.practice.setup.coachOptional')}: {isFlipped ? match.player2Coach : match.player1Coach}</span>
          )}
          <div key={`left-${scoreFlash}`} className={`text-7xl font-bold my-2 ${leftColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${leftName} ${leftScore}${t('common.units.point')}`}>
            {leftScore}
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-4 px-2">
          <h2 className={`text-xl font-bold ${rightColor}`}>
            {rightName}
          </h2>
          {(isFlipped ? match.player1Coach : match.player2Coach) && (
            <span className="text-xs text-gray-400">{t('referee.practice.setup.coachOptional')}: {isFlipped ? match.player1Coach : match.player2Coach}</span>
          )}
          <div key={`right-${scoreFlash}`} className={`text-7xl font-bold my-2 ${rightColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${rightName} ${rightScore}${t('common.units.point')}`}>
            {rightScore}
          </div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* Scoring area (buttons always p1 left, p2 right - muscle memory) */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center text-yellow-400 font-bold text-lg">{p1Name}</div>
          <div className="text-center text-cyan-400 font-bold text-lg">{p2Name}</div>
        </div>

        {/* Goal */}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn bg-green-800 hover:bg-green-700 text-white text-lg py-5 font-bold rounded-xl"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handleIBSAScore(1, 'goal', 2, false, `${p1Name} ${t('common.scoreActions.goal')}`)}
            aria-label={t('referee.practice.scoring.goalAriaLabel', { name: p1Name })}
          >
            ⚽ {t('referee.practice.scoring.goalButton', { name: p1Name })}<br/>
            <span className="text-xs opacity-75">{t('referee.practice.scoring.goalPoints', { name: p1Name })}</span>
          </button>
          <button
            className="btn bg-green-800 hover:bg-green-700 text-white text-lg py-5 font-bold rounded-xl"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handleIBSAScore(2, 'goal', 2, false, `${p2Name} ${t('common.scoreActions.goal')}`)}
            aria-label={t('referee.practice.scoring.goalAriaLabel', { name: p2Name })}
          >
            ⚽ {t('referee.practice.scoring.goalButton', { name: p2Name })}<br/>
            <span className="text-xs opacity-75">{t('referee.practice.scoring.goalPoints', { name: p2Name })}</span>
          </button>
        </div>

        {/* Fouls */}
        <div className="text-center text-xs text-gray-400 font-semibold">{t('referee.practice.scoring.foulSection')}</div>
        {foulActions.map(action => (
          <div key={action.type} className="grid grid-cols-2 gap-2">
            <button
              className="btn bg-yellow-900/80 hover:bg-yellow-800 text-yellow-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (action.type === 'irregular_serve' && match.currentServe !== 'player1')}
              onClick={() => handleIBSAScore(1, action.type, action.points, true, `${p1Name} ${action.label}`)}
              aria-label={t('referee.practice.scoring.foulAriaLabel', { name: p1Name, action: PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label, opponent: p2Name, points: action.points })}
            >
              🟡 {p1Name} {PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}<br/>
              <span className="text-xs opacity-75">{t('referee.practice.scoring.foulPoints', { opponent: p2Name, points: action.points })}</span>
            </button>
            <button
              className="btn bg-yellow-900/80 hover:bg-yellow-800 text-yellow-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (action.type === 'irregular_serve' && match.currentServe !== 'player2')}
              onClick={() => handleIBSAScore(2, action.type, action.points, true, `${p2Name} ${action.label}`)}
              aria-label={t('referee.practice.scoring.foulAriaLabel', { name: p2Name, action: PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label, opponent: p1Name, points: action.points })}
            >
              🟡 {p2Name} {PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}<br/>
              <span className="text-xs opacity-75">{t('referee.practice.scoring.foulPoints', { opponent: p1Name, points: action.points })}</span>
            </button>
          </div>
        ))}

        {/* Dead Ball */}
        <div>
          <h3 className="text-sm font-bold text-gray-400 mb-2">🔵 {t('common.matchHistory.deadBall', { server: '' })}</h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="btn bg-purple-700 hover:bg-purple-600 text-white py-3"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
              onClick={() => handleDeadBall(1)}
              aria-label={t('referee.practice.scoring.deadBallAriaLabel', { name: p1Name })}
            >
              {p1Name} {t('common.matchHistory.deadBall', { server: '' })}
            </button>
            <button
              className="btn bg-purple-700 hover:bg-purple-600 text-white py-3"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
              onClick={() => handleDeadBall(2)}
              aria-label={t('referee.practice.scoring.deadBallAriaLabel', { name: p2Name })}
            >
              {p2Name} {t('common.matchHistory.deadBall', { server: '' })}
            </button>
          </div>
        </div>

        {/* Penalty dropdown (per player) - same structure as real match mode */}
        <div>
          <h3 className="text-sm font-bold text-red-400 mb-2">🔴 {t('common.scoreActions.penalty')}</h3>
          <div className="grid grid-cols-2 gap-3">
            {([1, 2] as const).map(playerNum => {
              const pName = playerNum === 1 ? p1Name : p2Name;
              const opName = playerNum === 1 ? p2Name : p1Name;
              const dropdownKey = playerNum === 1 ? 'player1' : 'player2';
              const isOpen = penaltyDropdown === dropdownKey;

              const tablePushTotal = match.scoreHistory.filter(h =>
                h.actionType === 'penalty_table_pushing' && h.actionPlayer === pName
              ).length;
              const talkingTotal = match.scoreHistory.filter(h =>
                h.actionType === 'penalty_talking' && h.actionPlayer === pName
              ).length;

              return (
                <div key={playerNum} className="relative" ref={playerNum === 1 ? penaltyDropdownRef : undefined}>
                  <button
                    className="btn bg-red-900 hover:bg-red-800 text-red-200 text-sm py-3 w-full"
                    disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
                    onClick={() => setPenaltyDropdown(isOpen ? null : dropdownKey)}
                    aria-expanded={isOpen}
                    aria-haspopup="true"
                    aria-label={`${pName} ${t('common.scoreActions.penalty')}`}
                  >
                    {pName} {t('common.scoreActions.penalty')} ▾
                  </button>
                  {isOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden" ref={playerNum === 2 ? penaltyDropdownRef : undefined}>
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-red-900/50 text-sm border-b border-gray-700"
                        onClick={() => { handlePenalty(playerNum, 'penalty_table_pushing'); setPenaltyDropdown(null); }}
                      >
                        <span className="text-red-300 font-semibold">{t('common.scoreActions.penaltyTablePushing')}</span>
                        <span className="block text-xs text-gray-400 mt-0.5">
                          {tablePushTotal % 2 === 0 ? `→ ${t('referee.practice.scoring.penaltyWarningInfo')}` : `→ ${opName} +2${t('common.units.point')}`}
                        </span>
                      </button>
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-red-900/50 text-sm border-b border-gray-700"
                        onClick={() => { handlePenalty(playerNum, 'penalty_electronic'); setPenaltyDropdown(null); }}
                      >
                        <span className="text-red-300 font-semibold">{t('common.scoreActions.penaltyElectronic')}</span>
                        <span className="block text-xs text-gray-400 mt-0.5">→ {opName} +2{t('common.units.point')}</span>
                      </button>
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-red-900/50 text-sm border-b border-gray-700"
                        onClick={() => { handlePenalty(playerNum, 'penalty_talking'); setPenaltyDropdown(null); }}
                      >
                        <span className="text-red-300 font-semibold">{t('common.scoreActions.penaltyTalking')}</span>
                        <span className="block text-xs text-gray-400 mt-0.5">
                          {talkingTotal % 2 === 0 ? `→ ${t('referee.practice.scoring.penaltyWarningInfo')}` : `→ ${opName} +2${t('common.units.point')}`}
                        </span>
                      </button>
                      {penaltyActions.filter(a => !['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'].includes(a.type)).map(action => (
                        <button
                          key={action.type}
                          className="w-full text-left px-4 py-3 hover:bg-red-900/50 text-sm border-b border-gray-700 last:border-0"
                          onClick={() => { handleIBSAScore(playerNum, action.type, action.points, true, `${pName} ${PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}`); setPenaltyDropdown(null); }}
                        >
                          <span className="text-red-300 font-semibold">{PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}</span>
                          <span className="block text-xs text-gray-400 mt-0.5">→ {opName} +{action.points}{t('common.units.point')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* History (set-grouped) */}
        <div>
          <button
            className="text-sm text-gray-400 underline mb-2"
            onClick={() => setShowHistory(!showHistory)}
            aria-expanded={showHistory}
            aria-label={showHistory ? t('common.matchHistory.title') : t('common.matchHistory.titleWithCount', { count: match.scoreHistory.length })}
            style={{ minHeight: '44px' }}
          >
            {showHistory ? `▲ ${t('referee.practice.scoring.historyClose')}` : `▼ ${t('referee.practice.scoring.historyToggle', { count: match.scoreHistory.length })}`}
          </button>
          {showHistory && match.scoreHistory.length > 0 && (
            <div className="max-h-48 overflow-y-auto">
              <SetGroupedHistory history={match.scoreHistory} sets={sets} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom fixed action bar */}
      <div className="bg-gray-900 border-t border-gray-700 px-3 py-2">
        <div className="flex gap-2">
          <button
            className="btn btn-danger flex-1 py-3"
            onClick={handleUndo}
            disabled={match.scoreHistory.length === 0}
            aria-label={t('referee.practice.scoring.undoAriaLabel')}
          >
            ↩️ {t('referee.practice.scoring.undoButton')}
          </button>
        </div>
        {/* 타임아웃 (3종류) */}
        <div className="mt-2 space-y-2">
          {/* 선수 타임아웃 (1분, 1회) */}
          <div className="flex gap-2">
            <button
              className="btn btn-secondary flex-1 py-2 text-sm"
              onClick={() => handleTimeout(1, 'player')}
              disabled={match.player1Timeouts >= 1 || !!match.activeTimeout}
              aria-label={t('referee.practice.scoring.playerTimeoutAriaLabel', { name: p1Name, remaining: 1 - match.player1Timeouts })}
            >
              ⏱️ {t('referee.practice.scoring.playerTimeoutButton', { name: p1Name })}
              <span className="block text-xs opacity-75">{t('referee.practice.scoring.playerTimeoutInfo', { remaining: 1 - match.player1Timeouts })}</span>
            </button>
            <button
              className="btn btn-secondary flex-1 py-2 text-sm"
              onClick={() => handleTimeout(2, 'player')}
              disabled={match.player2Timeouts >= 1 || !!match.activeTimeout}
              aria-label={t('referee.practice.scoring.playerTimeoutAriaLabel', { name: p2Name, remaining: 1 - match.player2Timeouts })}
            >
              ⏱️ {t('referee.practice.scoring.playerTimeoutButton', { name: p2Name })}
              <span className="block text-xs opacity-75">{t('referee.practice.scoring.playerTimeoutInfo', { remaining: 1 - match.player2Timeouts })}</span>
            </button>
          </div>
          {/* 메디컬 타임아웃 (5분, 1회) */}
          {(() => {
            const med1 = match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p1Name).length;
            const med2 = match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p2Name).length;
            return (
              <div className="flex gap-2">
                <button
                  className="btn flex-1 bg-teal-800 hover:bg-teal-700 text-white py-2 text-sm"
                  onClick={() => handleTimeout(1, 'medical')}
                  disabled={!!match.activeTimeout || med1 >= 1}
                  aria-label={t('referee.practice.scoring.medicalTimeoutAriaLabel', { name: p1Name })}
                >
                  🏥 {t('referee.practice.scoring.medicalTimeoutButton', { name: p1Name })}
                  <span className="block text-xs opacity-75">{med1 >= 1 ? '-' : t('referee.practice.scoring.medicalTimeoutInfo')}</span>
                </button>
                <button
                  className="btn flex-1 bg-teal-800 hover:bg-teal-700 text-white py-2 text-sm"
                  onClick={() => handleTimeout(2, 'medical')}
                  disabled={!!match.activeTimeout || med2 >= 1}
                  aria-label={t('referee.practice.scoring.medicalTimeoutAriaLabel', { name: p2Name })}
                >
                  🏥 {t('referee.practice.scoring.medicalTimeoutButton', { name: p2Name })}
                  <span className="block text-xs opacity-75">{med2 >= 1 ? '-' : t('referee.practice.scoring.medicalTimeoutInfo')}</span>
                </button>
              </div>
            );
          })()}
          {/* 레프리 타임아웃 (제한없음) */}
          <button
            className="btn bg-yellow-800 hover:bg-yellow-700 text-white py-2 text-sm w-full"
            onClick={() => handleTimeout(1, 'referee')}
            disabled={!!match.activeTimeout}
            aria-label={t('referee.practice.scoring.refereeTimeoutAriaLabel')}
          >
            🟨 {t('referee.practice.scoring.refereeTimeoutButton')}
            <span className="block text-xs opacity-75">{t('referee.practice.scoring.refereeTimeoutInfo')}</span>
          </button>
        </div>
        {/* Dead Ball (양쪽) + Substitution + Pause */}
        <div className="flex gap-2 mt-2">
          {matchType === 'team' && (match.team1Members?.length ?? 0) > 3 && !match.team1SubUsed && (
            <button
              className="btn flex-1 bg-purple-800 hover:bg-purple-700 text-white py-2 text-sm"
              onClick={() => { setSubTeam(1); setSubOutIdx(null); setSubInIdx(null); setShowSubModal(true); }}
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
              aria-label={t('referee.practice.scoring.substitutionAriaLabel', { name: p1Name })}
            >
              🔄 {t('referee.practice.scoring.substitutionButton', { name: p1Name })}
            </button>
          )}
          {matchType === 'team' && (match.team2Members?.length ?? 0) > 3 && !match.team2SubUsed && (
            <button
              className="btn flex-1 bg-purple-800 hover:bg-purple-700 text-white py-2 text-sm"
              onClick={() => { setSubTeam(2); setSubOutIdx(null); setSubInIdx(null); setShowSubModal(true); }}
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
              aria-label={t('referee.practice.scoring.substitutionAriaLabel', { name: p2Name })}
            >
              🔄 {t('referee.practice.scoring.substitutionButton', { name: p2Name })}
            </button>
          )}
          {!isPausedLocal && (
            <button className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white py-2 text-sm" onClick={handlePause} aria-label={t('referee.practice.scoring.pauseAriaLabel')}>
              ⏸️ {t('referee.practice.scoring.pauseButton')}
            </button>
          )}
        </div>
      </div>

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <div className="flex gap-4 overflow-x-auto">
            {sets.map((s: SetScore, i: number) => (
              <div key={i} className={`text-center px-3 py-1 rounded ${i === ci ? 'bg-gray-700' : ''}`} aria-label={`${t('referee.practice.scoring.setLabel', { num: i + 1 })}: ${p1Name} ${s.player1Score} vs ${p2Name} ${s.player2Score}${i === ci ? ` ${t('referee.practice.scoring.currentSetLabel')}` : ''}`} aria-current={i === ci ? 'true' : undefined}>
                <div className="text-xs text-gray-400">{t('referee.practice.scoring.setLabel', { num: i + 1 })}</div>
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
