import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { speak } from '@shared/utils/locale';
import { usePracticeMatch, loadSavedPracticeMatch } from '../../hooks/usePracticeMatch';
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
import { formatTime } from '@shared/utils/locale';
import type { SetScore, ScoreActionType, PracticeMatch } from '@shared/types';

import { useCountdownTimer } from '../../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../../hooks/useDoubleClickGuard';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useWhistle } from '@shared/hooks/useWhistle';
import TimerModal from '../../components/TimerModal';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import ActionToast from '../../components/ActionToast';
import FoulClassifyOverlay from '../../components/FoulClassifyOverlay';

export default function PracticeScoring() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addSession } = usePracticeHistory();
  const { canAct, startProcessing, done } = useDoubleClickGuard();
  const { shortWhistle, longWhistle, goalWhistle, initAudio } = useWhistle();

  const matchType = (searchParams.get('type') || 'individual') as 'individual' | 'team';
  const p1Name = searchParams.get('p1') || t('referee.practice.setup.practicePlayerA');
  const p2Name = searchParams.get('p2') || t('referee.practice.setup.practicePlayerB');
  const defaultConfig = matchType === 'team'
    ? { SETS_TO_WIN: 1, MAX_SETS: 1, POINTS_TO_WIN: 31, MIN_POINT_DIFF: 2 }
    : { SETS_TO_WIN: 2, MAX_SETS: 3, POINTS_TO_WIN: 11, MIN_POINT_DIFF: 2 };
  const config = JSON.parse(searchParams.get('config') || JSON.stringify(defaultConfig));
  const team1Members: string[] = matchType === 'team' ? JSON.parse(searchParams.get('t1m') || '[]') : [];
  const team2Members: string[] = matchType === 'team' ? JSON.parse(searchParams.get('t2m') || '[]') : [];

  // Resume support: load saved match if resume=true
  const isResume = searchParams.get('resume') === 'true';
  const [savedMatch] = useState<PracticeMatch | null>(() => isResume ? loadSavedPracticeMatch() : null);

  const { match, updateMatch, startMatch, addAction } = usePracticeMatch({
    matchType: savedMatch?.type || matchType,
    player1Name: savedMatch?.player1Name || p1Name,
    player2Name: savedMatch?.player2Name || p2Name,
    config: savedMatch?.gameConfig || config,
    team1Members: savedMatch?.team1Members || team1Members,
    team2Members: savedMatch?.team2Members || team2Members,
    resumeMatch: savedMatch,
  });

  const [announcement, setAnnouncement] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [scoreFlash, setScoreFlash] = useState(0);
  const [showSideChange, setShowSideChange] = useState(false);
  const [sideChangeConfirmed, setSideChangeConfirmed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSetEndConfirm, setShowSetEndConfirm] = useState(false);
  const [setEndMessage, setSetEndMessage] = useState('');
  // Warmup
  const [showWarmup, setShowWarmup] = useState(false);
  // Coin toss
  const [coinTossStep, setCoinTossStep] = useState<'toss' | 'choice' | 'court_change' | 'warmup_ask'>('toss');
  const [tossWinner, setTossWinner] = useState<'player1' | 'player2' | null>(null);
  const [pendingFirstServe, setPendingFirstServe] = useState<'player1' | 'player2' | null>(null);
  const [courtChangeByLoser, setCourtChangeByLoser] = useState(false);
  // Coach - read from URL params (individual: p1c/p2c, team: t1c/t2c)
  const player1Coach = searchParams.get('p1c') || '';
  const player2Coach = searchParams.get('p2c') || '';
  const t1c = searchParams.get('t1c') || '';
  const t2c = searchParams.get('t2c') || '';
  // Penalty & timeout dropdowns (same as real match mode)
  type DropdownKey = 'player1' | 'player2' | null;
  const [penaltyDropdown, setPenaltyDropdown] = useState<DropdownKey>(null);
  const [timeoutDropdown, setTimeoutDropdown] = useState<DropdownKey>(null);
  const penaltyDropdownRef = useRef<HTMLDivElement>(null);
  const timeoutDropdownRef = useRef<HTMLDivElement>(null);
  const [rotationInfo, setRotationInfo] = useState('');
  const [showSubModal, setShowSubModal] = useState(false);
  const [subTeam, setSubTeam] = useState<1 | 2 | null>(null);
  const [subOutIdx, setSubOutIdx] = useState<number | null>(null);
  const [subInIdx, setSubInIdx] = useState<number | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const toggleSection = (key: string) => setExpandedSection(prev => prev === key ? null : key);
  const [foulClassify, setFoulClassify] = useState<{ player: 1 | 2 } | null>(null);
  const [timerWarningText, setTimerWarningText] = useState('');

  const setEndTrapRef = useFocusTrap(showSetEndConfirm);
  const subModalTrapRef = useFocusTrap(showSubModal);

  // Timers - longWhistle plays when timer auto-completes
  const sideChangeTimer = useCountdownTimer(() => { setShowSideChange(false); setSideChangeConfirmed(false); longWhistle(); });
  const warmupTimer = useCountdownTimer(() => { setShowWarmup(false); longWhistle(); });
  const timeoutTimer = useCountdownTimer(() => { updateMatch({ activeTimeout: null }); longWhistle(); });

  // Range-based warning tracking (handles mobile interval throttling)
  const timerWarningsRef = useRef<Set<string>>(new Set());

  // 30초/15초 안내 (타임아웃) - TimerModal 내부에만 표시 (ActionToast 중복 방지)
  useEffect(() => {
    if (!timeoutTimer.isRunning || !match.activeTimeout) {
      timerWarningsRef.current.delete('timeout_30');
      timerWarningsRef.current.delete('timeout_15');
      setTimerWarningText('');
      return;
    }
    if (timeoutTimer.seconds <= 30 && !timerWarningsRef.current.has('timeout_30')) {
      timerWarningsRef.current.add('timeout_30');
      setTimerWarningText(`30${t('common.time.seconds')}`);
      speak(`30${t('common.time.seconds')}`);
    }
    if (timeoutTimer.seconds <= 15 && !timerWarningsRef.current.has('timeout_15')) {
      timerWarningsRef.current.add('timeout_15');
      setTimerWarningText(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [timeoutTimer.seconds, timeoutTimer.isRunning, match.activeTimeout]);

  // 15초 안내 (사이드 체인지)
  useEffect(() => {
    if (!sideChangeTimer.isRunning || !showSideChange) {
      timerWarningsRef.current.delete('sideChange_15');
      setTimerWarningText('');
      return;
    }
    if (sideChangeTimer.seconds <= 15 && !timerWarningsRef.current.has('sideChange_15')) {
      timerWarningsRef.current.add('sideChange_15');
      setTimerWarningText(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [sideChangeTimer.seconds, sideChangeTimer.isRunning, showSideChange]);

  // 워밍업 알림: 개인전 15초 전, 팀전 30초마다
  useEffect(() => {
    if (!warmupTimer.isRunning) {
      timerWarningsRef.current.delete('warmup_60');
      timerWarningsRef.current.delete('warmup_30');
      timerWarningsRef.current.delete('warmup_15');
      setTimerWarningText('');
      return;
    }
    if (matchType === 'team') {
      if (warmupTimer.seconds <= 60 && !timerWarningsRef.current.has('warmup_60')) {
        timerWarningsRef.current.add('warmup_60');
        setTimerWarningText(`60${t('common.time.seconds')}`);
        speak(`60${t('common.time.seconds')}`);
      }
      if (warmupTimer.seconds <= 30 && !timerWarningsRef.current.has('warmup_30')) {
        timerWarningsRef.current.add('warmup_30');
        setTimerWarningText(`30${t('common.time.seconds')}`);
        speak(`30${t('common.time.seconds')}`);
      }
    } else {
      if (warmupTimer.seconds <= 15 && !timerWarningsRef.current.has('warmup_15')) {
        timerWarningsRef.current.add('warmup_15');
        setTimerWarningText(t('referee.scoring.fifteenSecondsLeft'));
        speak(t('referee.scoring.fifteenSecondsLeft'));
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

  // Timeout timer - 화면 복귀 시 이미 종료된 타임아웃 즉시 정리
  useEffect(() => {
    if (match.activeTimeout) {
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

    // Whistle: goal (2pt) = goalWhistle, foul/1pt = shortWhistle
    if (actionType === 'goal') goalWhistle();
    else shortWhistle();

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;

    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${pName} +${points}${t('common.units.point')}`
      : `${pName} ${t('common.scoreActions.goal')}! +${points}${t('common.units.point')}`;
    const nextServeDisplay = `${nextServerName} ${t('common.matchHistory.serve')} ${nextCount + 1}/${getMaxServes(matchType)}`;
    setLastAction(rotationAnnounce
      ? `${actionDesc} | ${p1Name} ${scoreAfter.player1} : ${scoreAfter.player2} ${p2Name} | ${nextServeDisplay} | ${rotationAnnounce}`
      : `${actionDesc} | ${p1Name} ${scoreAfter.player1} : ${scoreAfter.player2} ${p2Name} | ${nextServeDisplay}`);

    const announceBase = `${pName} ${points}${t('common.units.point')}. ${p1Name} ${scoreAfter.player1} : ${scoreAfter.player2} ${p2Name}. ${nextServeDisplay}`;
    setAnnouncement(rotationAnnounce ? `${announceBase}. ${rotationAnnounce}` : announceBase);

    // Set winner check with confirmation
    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, config);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? 'player1' : 'player2';
      sets[ci] = cs;

      const matchWinner = checkMatchWinner(sets, config);
      if (matchWinner) setTimeout(() => longWhistle(), 500); // match end whistle after score sound

      // Save state first
      updateMatch({
        sets, currentServe: nextServe, serveCount: nextCount,
        scoreHistory: newHistory, ...rotationUpdate,
      });

      // Show confirmation after 500ms delay
      setTimeout(() => {
        const setWinnerName = setWinner === 1 ? p1Name : p2Name;
        const winScore = setWinner === 1 ? cs.player1Score : cs.player2Score;
        const loseScore = setWinner === 1 ? cs.player2Score : cs.player1Score;
        const setWinsCalc = countSetWins(sets, config);

        if (matchWinner) {
          setSetEndMessage(`🏆 ${setWinnerName}!\n${t('common.matchHistory.score')}: ${winScore} - ${loseScore}\n${t('common.units.set')}: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
        } else {
          setSetEndMessage(`${setWinnerName} ${t('common.matchHistory.setLabel', { num: ci + 1 })} ${winScore} - ${loseScore}\n\n${t('common.units.set')}: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
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
      setShowSideChange(true);
      return;
    }

    updateMatch({
      sets, currentServe: nextServe, serveCount: nextCount,
      scoreHistory: newHistory, ...rotationUpdate,
    });

    } finally { done(); }
  }, [match, config, updateMatch, addAction, p1Name, p2Name, matchType, canAct, startProcessing, done, showSideChange, goalWhistle, shortWhistle]);

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
      longWhistle(); // match end whistle
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
      // 세트 전환: 코트 체인지 + 1분 휴식 + 서브권 교대
      // IBSA: 이전 세트 첫 서브의 반대 선수가 다음 세트 첫 서브
      sets.push(createEmptySet());
      const nextSetIndex = ci + 1;
      let nextSetServe: 'player1' | 'player2';
      if (match.coinTossWinner && match.coinTossChoice) {
        const firstSetServer: 'player1' | 'player2' = match.coinTossChoice === 'serve'
          ? (match.coinTossWinner === 'team1' ? 'player1' : 'player2')
          : (match.coinTossWinner === 'team1' ? 'player2' : 'player1');
        nextSetServe = nextSetIndex % 2 === 0 ? firstSetServer : (firstSetServer === 'player1' ? 'player2' : 'player1');
      } else {
        nextSetServe = match.currentServe === 'player1' ? 'player2' : 'player1';
      }
      const nextServerName = nextSetServe === 'player1' ? p1Name : p2Name;
      const sideChangeEntry = createScoreHistoryEntry({
        scoringPlayer: '',
        actionPlayer: '',
        actionType: 'side_change',
        actionLabel: t('common.matchHistory.sideChange'),
        points: 0,
        set: ci + 2,
        server: nextServerName,
        serveNumber: 1,
        scoreBefore: { player1: 0, player2: 0 },
        scoreAfter: { player1: 0, player2: 0 },
        serverSide: nextSetServe,
      });
      updateMatch({
        sets, currentSet: ci + 1,
        currentServe: nextSetServe, serveCount: 0,
        player1Timeouts: 0, player2Timeouts: 0, activeTimeout: null,
        sideChangeUsed: false,
        scoreHistory: [sideChangeEntry, ...match.scoreHistory],
      });
      setShowSideChange(true);
      longWhistle(); // court change whistle
    }
    setShowSetEndConfirm(false);
  }, [match, config, updateMatch, matchType, addSession, longWhistle, p1Name, p2Name, t]);

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

  // Serve Miss - 서브권 있는 선수가 1점 실점 (상대에게 +1)
  const handleServeMiss = useCallback(() => {
    const servingPlayer = match.currentServe === 'player1' ? 1 : 2;
    const sName = servingPlayer === 1 ? p1Name : p2Name;
    handleIBSAScore(servingPlayer as 1 | 2, 'serve_miss', 1, true, `${sName} ${t('common.scoreActions.serveMiss', '서브 미스')}`);
  }, [match.currentServe, p1Name, p2Name, handleIBSAScore, t]);

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
    shortWhistle(); // dead ball whistle
    setLastAction(`${actionName} ${t('common.matchHistory.deadBall', { server: sName })}`);
    setAnnouncement(`${actionName} ${t('common.matchHistory.deadBall', { server: sName })}`);
  }, [match, updateMatch, p1Name, p2Name, shortWhistle]);

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
    longWhistle(); // timeout start whistle
  }, [match, updateMatch, addAction, p1Name, p2Name, timeoutTimer, longWhistle]);

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
      shortWhistle(); // warning whistle
      setLastAction(`⚠️ ${actorName} ${t('common.matchHistory.warning', { player: actorName, action: penaltyLabel })}`);
      setAnnouncement(`${actorName} ${t('common.matchHistory.warning', { player: actorName, action: penaltyLabel })}`);
    } else {
      // 2회 이상: 실점 (penalty_talking: 1점, others: 2점)
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? t('common.scoreActions.penaltyTablePushing') : t('common.scoreActions.penaltyTalking');
      const penaltyPoints = penaltyType === 'penalty_talking' ? 1 : 2;
      const label = `${actorName} ${penaltyLabel}`;
      handleIBSAScore(actingPlayer, penaltyType, penaltyPoints, true, label);
    }
  }, [match, canAct, startProcessing, done, handleIBSAScore, updateMatch, p1Name, p2Name, showSideChange, shortWhistle]);

  // Quick foul: 1-tap generic foul (+1 to opponent)
  const handleQuickFoul = useCallback((actingPlayer: 1 | 2) => {
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    handleIBSAScore(actingPlayer, 'foul', 1, true, `${actorName} ${t('common.scoreActions.foul')}`);
    setFoulClassify({ player: actingPlayer });
  }, [handleIBSAScore, p1Name, p2Name, t]);

  // Classify a previously recorded foul
  const handleClassifyFoul = useCallback((type: ScoreActionType, label: string) => {
    if (!match?.scoreHistory || match.scoreHistory.length === 0) return;
    const updatedHistory = [...match.scoreHistory];
    const last = { ...updatedHistory[0] };
    if (last.actionType === 'foul') {
      last.actionType = type;
      last.actionLabel = `${last.actionPlayer} ${label}`;
      updatedHistory[0] = last;
      updateMatch({ scoreHistory: updatedHistory });
    }
    setFoulClassify(null);
  }, [match, updateMatch]);

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

    const loserName = tossWinner === 'player1' ? p2Name : p1Name;
    const courtChangeLabel = t('referee.scoring.coinTossLoserCourtChange', {
      loser: loserName,
      decision: courtChangeByLoser ? t('referee.scoring.courtChangeYes') : t('referee.scoring.courtChangeNo'),
    });

    const coinTossEntry: ScoreHistoryEntry = {
      time: now(), scoringPlayer: '', actionPlayer: winnerName,
      actionType: 'coin_toss',
      actionLabel: `${t('referee.scoring.coinTossWinner', { winner: winnerName, choice: choiceLabel })} / ${courtChangeLabel}`,
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
      courtChangeByLoser,
      player1Coach: c1 || undefined,
      player2Coach: c2 || undefined,
    });

    if (withWarmup) {
      warmupTimer.start(matchType === 'team' ? 90 : 60);
      setShowWarmup(true);
      longWhistle(); // warmup start whistle
    } else {
      longWhistle(); // match start whistle
    }
  }, [tossWinner, p1Name, p2Name, matchType, courtChangeByLoser, player1Coach, player2Coach, t1c, t2c, startMatch, updateMatch, warmupTimer, longWhistle]);

  // ===== PENDING =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
        <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>{t('referee.practice.home.title')}</h1>
        <div className="flex items-center justify-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{p1Name}</span>
          <span className="text-gray-400">vs</span>
          <span className="text-cyan-400 font-bold">{p2Name}</span>
        </div>
        <p className="text-gray-400 text-center">
          {matchType === 'team' ? t('referee.practice.scoring.rulesDisplayTeam') : t('referee.practice.scoring.rulesDisplay', { points: config.POINTS_TO_WIN, setsToWin: config.SETS_TO_WIN })}
        </p>

        {coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.coinToss')}</h2>
            <div className="flex gap-4">
              <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { initAudio(); setTossWinner('player1'); setCoinTossStep('choice'); }}>
                {p1Name}
              </button>
              <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { initAudio(); setTossWinner('player2'); setCoinTossStep('choice'); }}>
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
              <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'player1' ? p1Name : p2Name} ${t('referee.scoring.serveChoice')}`}>
                {t('referee.scoring.serveChoice')}
              </button>
              <button className="btn btn-accent btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner === 'player1' ? 'player2' : 'player1'); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'player1' ? p1Name : p2Name} ${t('referee.scoring.receiveChoice')}`}>
                {t('referee.scoring.receiveChoice')}
              </button>
            </div>
            <div className="text-center">
              <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }} aria-label={t('referee.practice.scoring.coinTossBackAriaLabel')} style={{ minHeight: '44px' }}>
                {t('common.back')}
              </button>
            </div>
          </div>
        )}
        {coinTossStep === 'court_change' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.courtChangeTitle')}</h2>
            <p className="text-gray-400 text-center" aria-live="polite">
              {t('referee.scoring.courtChangeQuestion', { loser: tossWinner === 'player1' ? p2Name : p1Name })}
            </p>
            <div className="flex gap-4" role="group" aria-label={t('referee.scoring.courtChangeAriaLabel')}>
              <button
                className="btn btn-primary btn-large flex-1 text-xl py-6"
                onClick={() => { setCourtChangeByLoser(true); setCoinTossStep('warmup_ask'); }}
                aria-label={`${tossWinner === 'player1' ? p2Name : p1Name}: ${t('referee.scoring.courtChangeYesButton')}`}
              >
                {t('referee.scoring.courtChangeYesButton')}
              </button>
              <button
                className="btn bg-gray-700 text-white btn-large flex-1 text-xl py-6"
                onClick={() => { setCourtChangeByLoser(false); setCoinTossStep('warmup_ask'); }}
                aria-label={`${tossWinner === 'player1' ? p2Name : p1Name}: ${t('referee.scoring.courtChangeNoButton')}`}
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

        <div className="text-center">
          <button className="btn btn-accent" onClick={() => navigate('/referee/practice/setup')}>{t('common.back')}</button>
        </div>
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
        <p className="text-gray-400 text-center">{t('referee.practice.scoring.totalActions', { count: match.actionLog.length, seconds: Math.floor((match.completedAt! - match.startedAt) / 1000) })}</p>

        {match.scoreHistory.length > 0 && (
          <div className="w-full max-w-lg mx-auto flex-1 min-h-0">
            <ScoreHistoryView history={match.scoreHistory} sets={match.sets} />
          </div>
        )}

        <div className="flex justify-center gap-4">
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


  // W/P/T.O. counts from score history
  const practiceHistory: ScoreHistoryEntry[] = match.scoreHistory ?? [];
  const currentSetHistory = practiceHistory.filter(h => h.set === ci + 1);
  const p1Warnings = currentSetHistory.filter(h => h.penaltyWarning && h.actionPlayer === p1Name).length;
  const p2Warnings = currentSetHistory.filter(h => h.penaltyWarning && h.actionPlayer === p2Name).length;
  const p1Penalties = currentSetHistory.filter(h =>
    (h.actionType === 'penalty_table_pushing' || h.actionType === 'penalty_electronic' || h.actionType === 'penalty_talking')
    && !h.penaltyWarning && h.actionPlayer === p1Name
  ).length;
  const p2Penalties = currentSetHistory.filter(h =>
    (h.actionType === 'penalty_table_pushing' || h.actionType === 'penalty_electronic' || h.actionType === 'penalty_talking')
    && !h.penaltyWarning && h.actionPlayer === p2Name
  ).length;


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
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); longWhistle(); }}
          closeLabel={t('referee.practice.scoring.warmupEnd')}
          warningText={timerWarningText}
        />
      )}

      {/* Side Change: Phase 1 - Prompt */}
      {showSideChange && !sideChangeConfirmed && (
        <TimerModal
          title={t('referee.practice.scoring.sideChangeTitle')}
          seconds={0}
          isWarning={false}
          subtitle={t('referee.practice.scoring.sideChangeSubtitle')}
          onClose={() => { setSideChangeConfirmed(true); sideChangeTimer.start(60); longWhistle(); }}
          closeLabel={`⏱️ ${t('referee.practice.scoring.sideChangeSubtitle')} ${t('common.start')}`}
          required
        />
      )}

      {/* Side Change: Phase 2 - Timer countdown */}
      {showSideChange && sideChangeConfirmed && (
        <TimerModal
          title={t('referee.practice.scoring.sideChangeTitle')}
          seconds={sideChangeTimer.seconds}
          isWarning={sideChangeTimer.isWarning}
          subtitle={t('referee.practice.scoring.sideChangeSubtitle')}
          onClose={() => { sideChangeTimer.stop(); setShowSideChange(false); setSideChangeConfirmed(false); longWhistle(); }}
          closeLabel={`🎾 ${t('common.matchHistory.resumeMatch', '경기 재개')}`}
          required
          warningText={timerWarningText}
        />
      )}

      {/* Timeout Modal */}
      {match.activeTimeout && (timeoutTimer.isRunning || match.activeTimeout.type === 'referee') && (
        <TimerModal
          title={match.activeTimeout.type === 'medical' ? `🏥 ${t('referee.scoring.timeoutTitle.medical')}` : match.activeTimeout.type === 'referee' ? `🟨 ${t('referee.scoring.timeoutTitle.referee')}` : `⏱️ ${t('referee.scoring.timeoutTitle.player')}`}
          seconds={timeoutTimer.seconds}
          isWarning={timeoutTimer.isWarning}
          subtitle={match.activeTimeout.type === 'referee' ? '' : undefined}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); longWhistle(); }}
          closeLabel={t('referee.practice.scoring.timeoutEndButton')}
          warningText={timerWarningText}
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
      <div className="bg-blue-900/50 px-4 py-1.5 flex items-center justify-center gap-3" role="status" aria-label={t('referee.practice.scoring.serveInfo', { name: serverName, current: match.serveCount + 1, max: maxServes })}>
        <span className="text-blue-300 font-semibold text-sm">
          🎾 {t('referee.practice.scoring.serveInfo', { name: serverName, current: match.serveCount + 1, max: maxServes })}
        </span>
        <button className="text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label={t('referee.practice.scoring.changeServeAriaLabel')} style={{ minHeight: '44px', minWidth: '44px' }}>
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

      {/* Score display */}
      <div className="flex border-b border-gray-700" aria-live="polite">
        <div className="flex-1 flex flex-col items-center py-3 px-2 border-r border-gray-700" style={match.currentServe === 'player1' ? { borderLeft: '3px solid rgba(234,179,8,0.4)' } : undefined}>
          <h2 className="text-lg font-bold text-yellow-400">
            {match.currentServe === 'player1' && '🎾 '}{p1Name}
          </h2>
          {match.player1Coach && <span className="text-xs text-gray-500">{match.player1Coach}</span>}
          <div key={`p1-${scoreFlash}`} className="text-7xl font-bold my-1 text-yellow-400" style={{ animation: 'scoreFlash 0.3s ease-out' }}>
            {cs.player1Score}
          </div>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 font-bold">W{p1Warnings}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-800/60 text-red-300 font-bold">P{p1Penalties}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-800/60 text-blue-300 font-bold">T{match.player1Timeouts}</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 px-2" style={match.currentServe === 'player2' ? { borderRight: '3px solid rgba(6,182,212,0.4)' } : undefined}>
          <h2 className="text-lg font-bold text-cyan-400">
            {match.currentServe === 'player2' && '🎾 '}{p2Name}
          </h2>
          {match.player2Coach && <span className="text-xs text-gray-500">{match.player2Coach}</span>}
          <div key={`p2-${scoreFlash}`} className="text-7xl font-bold my-1 text-cyan-400" style={{ animation: 'scoreFlash 0.3s ease-out' }}>
            {cs.player2Score}
          </div>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 font-bold">W{p2Warnings}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-800/60 text-red-300 font-bold">P{p2Penalties}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-800/60 text-blue-300 font-bold">T{match.player2Timeouts}</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes scoreFlash { 0% { transform: scale(1.2); } 100% { transform: scale(1); } }`}</style>

      {/* Scoring area - 4 main buttons */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {(() => {
          const scoringDisabled = !!match.activeTimeout || showSideChange;
          return (
            <>
              {/* Row 1: 골 +2 */}
              <div className="grid grid-cols-2 gap-3">
                <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
                  onClick={() => handleIBSAScore(1, 'goal', 2, false, `${p1Name} ${t('common.scoreActions.goal')}`)}>
                  ⚽ {p1Name}<br/>{t('common.scoreActions.goal')} +2
                </button>
                <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
                  onClick={() => handleIBSAScore(2, 'goal', 2, false, `${p2Name} ${t('common.scoreActions.goal')}`)}>
                  ⚽ {p2Name}<br/>{t('common.scoreActions.goal')} +2
                </button>
              </div>

              {/* Row 2: 파울 +1 */}
              <div className="grid grid-cols-2 gap-3">
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={scoringDisabled}
                  onClick={() => handleQuickFoul(1)}>
                  🟡 {p1Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {p2Name} +1</span>
                </button>
                <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={scoringDisabled}
                  onClick={() => handleQuickFoul(2)}>
                  🟡 {p2Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {p1Name} +1</span>
                </button>
              </div>
            </>
          );
        })()}

        {/* Dead ball & Serve miss */}
        <div className="grid grid-cols-2 gap-3">
          <button className="btn bg-purple-700 hover:bg-purple-600 text-white py-3" disabled={!!match.activeTimeout || showSideChange || match.status !== 'in_progress'}
            onClick={() => handleDeadBall(match.currentServe === 'player1' ? 1 : 2)}>
            🔵 {t('common.matchHistory.deadBall', { server: '' }).trim()}
          </button>
          <button className="btn bg-orange-700 hover:bg-orange-600 text-white py-3" disabled={!!match.activeTimeout || showSideChange || match.status !== 'in_progress'}
            onClick={handleServeMiss}>
            🎾 {t('common.scoreActions.serveMiss', '서브 미스')}
          </button>
        </div>

        {/* Row 3: 취소 */}
        <button className="btn btn-danger py-3 w-full" onClick={handleUndo} disabled={match.scoreHistory.length === 0}>↩️ {t('referee.practice.scoring.undoButton')}</button>

        {/* 접이식: 타임아웃 */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('timeout')} aria-expanded={expandedSection === 'timeout'}>
            <span className="text-sm font-bold text-gray-300">⏱️ {t('referee.scoring.timeoutTitle.player')}</span>
            <span className="text-gray-400">{expandedSection === 'timeout' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'timeout' && (
            <div className="px-3 py-3 space-y-2 bg-gray-900/50">
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-secondary text-sm py-2" onClick={() => handleTimeout(1, 'player')} disabled={match.player1Timeouts >= 1 || !!match.activeTimeout}
                  aria-label={`${p1Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - match.player1Timeouts}/1)`}>
                  ⏱️ {p1Name} {t('referee.scoring.timeoutTitle.player')} ({1 - match.player1Timeouts}/1)
                </button>
                <button className="btn btn-secondary text-sm py-2" onClick={() => handleTimeout(2, 'player')} disabled={match.player2Timeouts >= 1 || !!match.activeTimeout}
                  aria-label={`${p2Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - match.player2Timeouts}/1)`}>
                  ⏱️ {p2Name} {t('referee.scoring.timeoutTitle.player')} ({1 - match.player2Timeouts}/1)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => handleTimeout(1, 'medical')} disabled={!!match.activeTimeout || match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p1Name).length >= 1}
                  aria-label={`${p1Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p1Name).length}/1)`}>
                  🏥 {p1Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p1Name).length}/1)
                </button>
                <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => handleTimeout(2, 'medical')} disabled={!!match.activeTimeout || match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p2Name).length >= 1}
                  aria-label={`${p2Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p2Name).length}/1)`}>
                  🏥 {p2Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p2Name).length}/1)
                </button>
              </div>
              <button className="btn bg-yellow-800 hover:bg-yellow-700 text-white text-sm py-2 w-full" onClick={() => handleTimeout(1, 'referee')} disabled={!!match.activeTimeout}
                aria-label={t('referee.scoring.timeoutTitle.referee')}>
                🟨 {t('referee.scoring.timeoutTitle.referee')}
              </button>
            </div>
          )}
        </div>

        {/* 접이식: 페널티 */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => toggleSection('penalty')} aria-expanded={expandedSection === 'penalty'}>
            <span className="text-sm font-bold text-gray-300">🔴 {t('common.scoreActions.penalty')}</span>
            <span className="text-gray-400">{expandedSection === 'penalty' ? '▲' : '▼'}</span>
          </button>
          {expandedSection === 'penalty' && (
            <div className="px-3 py-3 bg-gray-900/50">
              <div className="grid grid-cols-2 gap-2">
                {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => (
                  <button key={`p1-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded"
                    disabled={!!match.activeTimeout}
                    onClick={() => handlePenalty(1, pType)}>
                    {p1Name} {t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`)}
                  </button>
                ))}
                {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => (
                  <button key={`p2-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded"
                    disabled={!!match.activeTimeout}
                    onClick={() => handlePenalty(2, pType)}>
                    {p2Name} {t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 팀전: 선수 교체 */}
        {matchType === 'team' && ((match.team1Members?.length ?? 0) > 3 || (match.team2Members?.length ?? 0) > 3) && (
          <div className="grid grid-cols-2 gap-2">
            {(match.team1Members?.length ?? 0) > 3 && !match.team1SubUsed && (
              <button className="btn bg-purple-800 hover:bg-purple-700 text-white py-2 text-sm" onClick={() => { setSubTeam(1); setSubOutIdx(null); setSubInIdx(null); setShowSubModal(true); }} disabled={!!match.activeTimeout || showSideChange}>
                🔄 {p1Name} {t('common.matchHistory.substitution')}
              </button>
            )}
            {(match.team2Members?.length ?? 0) > 3 && !match.team2SubUsed && (
              <button className="btn bg-purple-800 hover:bg-purple-700 text-white py-2 text-sm" onClick={() => { setSubTeam(2); setSubOutIdx(null); setSubInIdx(null); setShowSubModal(true); }} disabled={!!match.activeTimeout || showSideChange}>
                🔄 {p2Name} {t('common.matchHistory.substitution')}
              </button>
            )}
          </div>
        )}

        {/* History */}
        <div>
          <button className="text-sm text-gray-400 underline mb-2" onClick={() => setShowHistory(!showHistory)} style={{ minHeight: '44px' }}>
            {showHistory ? `▲ ${t('referee.practice.scoring.historyClose')}` : `▼ ${t('referee.practice.scoring.historyToggle', { count: match.scoreHistory.length })}`}
          </button>
          {showHistory && match.scoreHistory.length > 0 && (
            <div className="w-full">
              <ScoreHistoryView history={match.scoreHistory} sets={sets} />
            </div>
          )}
        </div>
      </div>

      {/* Foul classification overlay */}
      {foulClassify && (
        <FoulClassifyOverlay
          playerName={foulClassify.player === 1 ? p1Name : p2Name}
          onClassify={handleClassifyFoul}
          onDismiss={() => setFoulClassify(null)}
        />
      )}

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <div className="flex justify-center gap-4 overflow-x-auto">
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
