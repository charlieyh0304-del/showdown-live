import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { IBSA_SCORE_ACTIONS } from '@shared/types';
import type { SetScore, ScoreActionType, PracticeMatch } from '@shared/types';

// Practice mode descriptive labels for learning referees
const PRACTICE_DESCRIPTIVE_LABELS: Record<string, string> = {
  goal: '골 득점 (공이 상대 골라인 통과)',
  irregular_serve: '부정 서브 (서브 규칙 위반)',
  centerboard: '센터보드 터치 (공이 센터보드 접촉)',
  body_touch: '바디 터치 (선수 몸에 공 접촉)',
  illegal_defense: '일리걸 디펜스 (수비 규칙 위반)',
  out: '아웃 (공이 경기장 밖으로)',
  ball_holding: '볼 홀딩 (2초 이상 공 보유)',
  mask_touch: '마스크/고글 터치 (경기 중 장비 접촉)',
  penalty: '기타 벌점 (규정 위반)',
};

import { useCountdownTimer } from '../../hooks/useCountdownTimer';
import { useDoubleClickGuard } from '../../hooks/useDoubleClickGuard';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import TimerModal from '../../components/TimerModal';
import SetGroupedHistory from '../../components/SetGroupedHistory';
import ActionToast from '../../components/ActionToast';

export default function PracticeScoring() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addSession } = usePracticeHistory();
  const { canAct } = useDoubleClickGuard();


  const matchType = (searchParams.get('type') || 'individual') as 'individual' | 'team';
  const p1Name = searchParams.get('p1') || '연습선수A';
  const p2Name = searchParams.get('p2') || '연습선수B';
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
  const [coinTossStep, setCoinTossStep] = useState<'toss' | 'choice'>('toss');
  const [tossWinner, setTossWinner] = useState<'player1' | 'player2' | null>(null);
  const [pendingFirstServe, setPendingFirstServe] = useState<'player1' | 'player2' | null>(null);
  const [showWarmupChoice, setShowWarmupChoice] = useState(false);
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

  // Timers
  const sideChangeTimer = useCountdownTimer(() => setShowSideChange(false));
  const warmupTimer = useCountdownTimer(() => setShowWarmup(false));
  const timeoutTimer = useCountdownTimer(() => updateMatch({ activeTimeout: null }));

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

  // 워밍업 15초 알림
  useEffect(() => {
    if (warmupTimer.isRunning) {
      if (matchType === 'team') {
        if (warmupTimer.seconds === 60) {
          setLastAction('⚠️ 30초');
          setAnnouncement('30초');
        }
        if (warmupTimer.seconds === 30) {
          setLastAction('⚠️ 30초');
          setAnnouncement('30초');
        }
      } else {
        if (warmupTimer.seconds === 15) {
          setLastAction('⚠️ 15초');
          setAnnouncement('15초');
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

  // Pause elapsed counter
  useEffect(() => {
    if (!isPausedLocal) return;
    const interval = setInterval(() => setPauseElapsed(p => p + 1), 1000);
    return () => clearInterval(interval);
  }, [isPausedLocal]);

  // Pause
  const handlePause = useCallback(() => {
    if (match.status !== 'in_progress' || isPausedLocal) return;
    const reason = prompt('일시정지 사유를 입력하세요:\n(예: 부상, 장비 문제, 기타)');
    if (reason === null) return;
    const actualReason = reason || '사유 없음';
    setIsPausedLocal(true);
    setPauseReason(actualReason);
    setPauseElapsed(0);
    const pauseEntry = {
      time: new Date().toLocaleTimeString('ko-KR'),
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
        actionLabel: nextPlayerName ? `선수 교체: ${prevPlayerName} → ${nextPlayerName} (${rotTeamName})` : `선수 로테이션 (${rotTeamName})`,
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
        rotationAnnounce = `${rotTeamName} 선수 교체: ${prevPlayerName} → ${nextPlayerName}`;
        setRotationInfo(rotationAnnounce);
        setTimeout(() => setRotationInfo(''), 4000);
      }
    }

    const newHistory = rotationEntry
      ? [rotationEntry, historyEntry, ...match.scoreHistory]
      : [historyEntry, ...match.scoreHistory];

    addAction({ type: 'score', player: actingPlayer, detail: `${label} (${points}점)` });
    setScoreFlash(f => f + 1);

    const pName = scoringPlayer === 1 ? p1Name : p2Name;
    const actorName = actingPlayer === 1 ? p1Name : p2Name;
    const nextServerName = nextServe === 'player1' ? p1Name : p2Name;

    const actionDesc = toOpponent
      ? `${actorName} ${label.split(' ').slice(1).join(' ')} → ${pName} +${points}점`
      : `${pName} 골! +${points}점`;
    setLastAction(rotationAnnounce
      ? `${actionDesc} | ${scoreAfter.player1} : ${scoreAfter.player2} | ${rotationAnnounce}`
      : `${actionDesc} | ${scoreAfter.player1} : ${scoreAfter.player2}`);

    const serverScore = nextServe === 'player1' ? scoreAfter.player1 : scoreAfter.player2;
    const receiverScore = nextServe === 'player1' ? scoreAfter.player2 : scoreAfter.player1;
    const announceBase = `${pName} ${points}점. 스코어 ${serverScore} 대 ${receiverScore}. ${nextServerName} ${nextCount + 1}번째 서브`;
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
          setSetEndMessage(`경기 종료!\n\n${winnerName} 승리! (세트 ${setWinsCalc.player1}:${setWinsCalc.player2})\n현재 점수: ${cs.player1Score} - ${cs.player2Score}`);
        } else {
          const setWinsCalc = countSetWins(sets, config);
          setSetEndMessage(`세트 ${ci + 1}을(를) 종료하시겠습니까?\n\n현재 점수: ${cs.player1Score} - ${cs.player2Score}\n세트 스코어: ${setWinsCalc.player1}:${setWinsCalc.player2}`);
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
  }, [match, config, updateMatch, addAction, p1Name, p2Name, matchType, canAct, sideChangeTimer, showSideChange]);

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
    const msg = `취소됨. ${p1Name} ${cs.player1Score}, ${p2Name} ${cs.player2Score}. ${serverAfterUndo} 서브`;
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
    setAnnouncement(`서브권 변경: ${newServer}`);
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
      actionLabel: `${actionName} 데드볼 → 재서브`,
      points: 0,
      set: ci + 1,
      server: sName,
      serveNumber: match.serveCount + 1,
      scoreBefore,
      scoreAfter: scoreBefore,
      serverSide: match.currentServe,
    });
    updateMatch({ scoreHistory: [entry, ...match.scoreHistory] });
    setLastAction(`${actionName} 데드볼 - ${sName} 재서브`);
    setAnnouncement(`${actionName} 데드볼. ${sName} 재서브`);
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
      actionLabel: `선수 교체: ${outName} → ${inName} (${teamName})`,
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

    setLastAction(`${teamName} 선수 교체: ${outName} → ${inName}`);
    setAnnouncement(`${teamName} 선수 교체. ${outName} 퇴장, ${inName} 입장`);
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
    const actionLabel = type === 'player' ? '선수 타임아웃' : type === 'medical' ? '메디컬 타임아웃' : '레프리 타임아웃';
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
  const handlePenalty = useCallback((
    actingPlayer: 1 | 2,
    penaltyType: 'penalty_table_pushing' | 'penalty_electronic' | 'penalty_talking',
  ) => {
    if (!canAct()) return;
    if (match.status !== 'in_progress' || match.isPaused) return;
    if (match.activeTimeout || showSideChange) return;

    const actorName = actingPlayer === 1 ? p1Name : p2Name;

    // penalty_electronic은 즉시 2점
    if (penaltyType === 'penalty_electronic') {
      const label = `${actorName} 전자기기 소리`;
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
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? '테이블 푸싱' : '경기 중 말하기';
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
      setLastAction(`⚠️ ${actorName} ${penaltyLabel} 경고 (1회)`);
      setAnnouncement(`${actorName} ${penaltyLabel} 경고`);
    } else {
      // 2회 이상: 2점 실점
      const penaltyLabel = penaltyType === 'penalty_table_pushing' ? '테이블 푸싱' : '경기 중 말하기';
      const label = `${actorName} ${penaltyLabel}`;
      handleIBSAScore(actingPlayer, penaltyType, 2, true, label);
    }
  }, [match, canAct, handleIBSAScore, updateMatch, p1Name, p2Name, showSideChange]);

  // ===== PENDING =====
  if (match.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>연습 경기</h1>
        <div className="flex items-center gap-8 text-2xl">
          <span className="text-yellow-400 font-bold">{p1Name}</span>
          <span className="text-gray-400">vs</span>
          <span className="text-cyan-400 font-bold">{p2Name}</span>
        </div>
        <p className="text-gray-400">
          {matchType === 'team' ? '31점 단판 | 서브 3회 교대' : `${config.POINTS_TO_WIN}점 | ${config.SETS_TO_WIN}세트 선승`}
        </p>

        {!showWarmupChoice && coinTossStep === 'toss' && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">동전던지기 승자</h2>
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
        {!showWarmupChoice && coinTossStep === 'choice' && tossWinner && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">
              {tossWinner === 'player1' ? p1Name : p2Name} 승리!
            </h2>
            <p className="text-gray-400 text-center">서브 또는 리시브를 선택하세요</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner); setShowWarmupChoice(true); setCoinTossStep('toss'); }}>
                🎾 서브
              </button>
              <button className="btn btn-accent btn-large flex-1 text-xl py-6" onClick={() => { setPendingFirstServe(tossWinner === 'player1' ? 'player2' : 'player1'); setShowWarmupChoice(true); setCoinTossStep('toss'); }}>
                🏓 리시브
              </button>
            </div>
            <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }}>
              다시 선택
            </button>
          </div>
        )}

        {showWarmupChoice && pendingFirstServe && (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">워밍업</h2>
            <p className="text-gray-400 text-center">{matchType === 'team' ? '90초' : '60초'} 워밍업을 진행하시겠습니까?</p>
            <div className="flex gap-4">
              <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => {
                startMatch(pendingFirstServe);
                updateMatch({ warmupUsed: true });
                warmupTimer.start(matchType === 'team' ? 90 : 60);
                setShowWarmup(true);
                setShowWarmupChoice(false);
              }}>
                🔥 워밍업 시작
              </button>
              <button className="btn btn-secondary btn-large flex-1 text-xl py-6" onClick={() => {
                startMatch(pendingFirstServe);
                setShowWarmupChoice(false);
              }}>
                건너뛰기
              </button>
            </div>
          </div>
        )}

        <button className="btn btn-accent" onClick={() => navigate('/referee/practice/setup')}>설정으로</button>
      </div>
    );
  }

  // ===== COMPLETED =====
  if (match.status === 'completed') {
    const winnerName = match.winnerId === 'player1' ? p1Name : p2Name;
    const setWins = countSetWins(match.sets, config);
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>연습 경기 종료</h1>
        <div className="text-4xl font-bold text-green-400" role="status" aria-live="assertive">🏆 {winnerName} 승리!</div>
        <div className="text-2xl text-gray-300" aria-label={`세트 스코어 ${setWins.player1} 대 ${setWins.player2}`}>세트 스코어: {setWins.player1} - {setWins.player2}</div>
        {match.sets.map((s: SetScore, i: number) => {
          const winner = s.player1Score > s.player2Score ? p1Name : p2Name;
          return (
            <div key={i} className="text-lg text-gray-400">
              세트 {i + 1}: {s.player1Score} - {s.player2Score} ({winner} 승)
            </div>
          );
        })}
        <p className="text-gray-400">총 조작: {match.actionLog.length}회 | 소요시간: {Math.floor((match.completedAt! - match.startedAt) / 1000)}초</p>

        {match.scoreHistory.length > 0 && (
          <div className="w-full max-w-lg">
            <h3 className="text-lg font-bold text-gray-300 mb-2">경기 기록 ({match.scoreHistory.length})</h3>
            <div className="max-h-60 overflow-y-auto">
              <SetGroupedHistory history={match.scoreHistory} sets={match.sets} showAll />
            </div>
          </div>
        )}

        <div className="flex gap-4">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/practice/setup')}>다시 하기</button>
          <button className="btn btn-secondary btn-large" onClick={() => navigate('/referee/practice')}>홈으로</button>
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
          title="🔥 워밍업"
          seconds={warmupTimer.seconds}
          isWarning={warmupTimer.isWarning}
          subtitle={matchType === 'team' ? '팀전 워밍업 (90초)' : '개인전 워밍업 (60초)'}
          onClose={() => { warmupTimer.stop(); setShowWarmup(false); }}
          closeLabel="워밍업 종료"
        />
      )}

      {/* Side Change Timer */}
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

      {/* Timeout Modal */}
      {match.activeTimeout && (timeoutTimer.isRunning || match.activeTimeout.type === 'referee') && (
        <TimerModal
          title={match.activeTimeout.type === 'medical' ? '🏥 메디컬 타임아웃' : match.activeTimeout.type === 'referee' ? '🟨 레프리 타임아웃' : '⏱️ 선수 타임아웃'}
          seconds={timeoutTimer.seconds}
          isWarning={timeoutTimer.isWarning}
          subtitle={match.activeTimeout.type === 'referee' ? '수동 종료' : undefined}
          onClose={() => { timeoutTimer.stop(); updateMatch({ activeTimeout: null }); }}
          closeLabel="타임아웃 종료"
        />
      )}

      {/* Substitution Modal */}
      {showSubModal && subTeam && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onKeyDown={e => { if (e.key === 'Escape') { setShowSubModal(false); setSubTeam(null); setSubOutIdx(null); setSubInIdx(null); } }}>
          <div ref={subModalTrapRef} className="flex flex-col items-center gap-4 p-6 max-w-sm w-full" role="dialog" aria-modal="true" aria-label="선수 교체">
            <h2 className="text-xl font-bold text-yellow-400">{subTeam === 1 ? p1Name : p2Name} 선수 교체</h2>
            <div className="w-full space-y-3">
              <div>
                <p className="text-sm text-gray-400 mb-2">교체할 선수 (출전 중)</p>
                <div className="flex flex-col gap-1">
                  {(subTeam === 1 ? match.team1Members : match.team2Members)?.slice(0, 3).map((name, i) => (
                    <button key={i} className={`btn text-left py-2 px-3 ${subOutIdx === i ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white'}`} aria-pressed={subOutIdx === i} onClick={() => setSubOutIdx(i)}>
                      {i + 1}. {name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-400 mb-2">투입할 선수 (예비)</p>
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
              <button className="btn btn-success flex-1" onClick={handleSubstitution} disabled={subOutIdx === null || subInIdx === null}>교체 확인</button>
              <button className="btn btn-secondary flex-1" onClick={() => { setShowSubModal(false); setSubTeam(null); setSubOutIdx(null); setSubInIdx(null); }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* Set End Confirmation */}
      {showSetEndConfirm && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onKeyDown={e => { if (e.key === 'Escape') handleCancelSetEnd(); }}>
          <div ref={setEndTrapRef} className="flex flex-col items-center gap-6 p-8 max-w-sm" role="dialog" aria-modal="true" aria-label="세트 종료 확인">
            <h2 className="text-2xl font-bold text-yellow-400">세트 종료 확인</h2>
            <p className="text-lg text-gray-300 text-center whitespace-pre-line">{setEndMessage}</p>
            <div className="flex gap-4 w-full">
              <button className="btn btn-success btn-large flex-1" onClick={handleConfirmSetEnd}>확인</button>
              <button className="btn btn-secondary btn-large flex-1" onClick={handleCancelSetEnd}>취소</button>
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
          <button className="btn btn-accent text-sm" onClick={() => navigate('/referee/practice')} aria-label="연습 홈으로 돌아가기">← 연습 홈</button>
          <div className="text-center">
            <h1 className="text-lg font-bold" style={{ color: '#c084fc' }}>
              {matchType === 'team' ? '팀전 31점' : `세트 ${ci + 1}/${config.MAX_SETS}`}
            </h1>
            {matchType === 'individual' && (
              <div className="text-sm text-gray-400" aria-label={`세트 스코어 ${setWins.player1} 대 ${setWins.player2}`}>세트 스코어: {setWins.player1} - {setWins.player2}</div>
            )}
          </div>
          <div className="text-sm text-gray-400">연습</div>
        </div>
      </div>

      {/* Serve */}
      <div className="bg-blue-900/50 px-4 py-2 text-center" role="status" aria-label={`${serverName} 서브 ${match.serveCount + 1}/${maxServes}회차`}>
        <span className="text-blue-300 font-semibold">
          🎾 {serverName} 서브 {match.serveCount + 1}/{maxServes}회차
        </span>
        <button className="ml-3 text-xs text-blue-400 underline" onClick={handleChangeServe} aria-label="서브권 수동 변경" style={{ minHeight: '44px', minWidth: '44px' }}>
          서브권 변경
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
        <div className="flex-1 flex flex-col items-center py-4 px-2 border-r border-gray-700">
          <h2 className={`text-xl font-bold ${leftColor}`}>
            🎾 {leftName}
          </h2>
          <div key={`left-${scoreFlash}`} className={`text-7xl font-bold my-2 ${leftColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${leftName} ${leftScore}점`}>
            {leftScore}
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-4 px-2">
          <h2 className={`text-xl font-bold ${rightColor}`}>
            {rightName}
          </h2>
          <div key={`right-${scoreFlash}`} className={`text-7xl font-bold my-2 ${rightColor}`} style={{ animation: 'scoreFlash 0.3s ease-out' }} aria-label={`${rightName} ${rightScore}점`}>
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
            onClick={() => handleIBSAScore(1, 'goal', 2, false, `${p1Name} 골`)}
            aria-label={`${p1Name} 골 득점. ${p1Name}에게 2점 추가`}
          >
            ⚽ {p1Name} 골 득점<br/>
            <span className="text-xs opacity-75">→ {p1Name} +2점</span>
          </button>
          <button
            className="btn bg-green-800 hover:bg-green-700 text-white text-lg py-5 font-bold rounded-xl"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handleIBSAScore(2, 'goal', 2, false, `${p2Name} 골`)}
            aria-label={`${p2Name} 골 득점. ${p2Name}에게 2점 추가`}
          >
            ⚽ {p2Name} 골 득점<br/>
            <span className="text-xs opacity-75">→ {p2Name} +2점</span>
          </button>
        </div>

        {/* Fouls */}
        <div className="text-center text-xs text-gray-400 font-semibold">파울 (상대에게 +1점)</div>
        {foulActions.map(action => (
          <div key={action.type} className="grid grid-cols-2 gap-2">
            <button
              className="btn bg-yellow-900/80 hover:bg-yellow-800 text-yellow-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (action.type === 'irregular_serve' && match.currentServe !== 'player1')}
              onClick={() => handleIBSAScore(1, action.type, action.points, true, `${p1Name} ${action.label}`)}
              aria-label={`${p1Name} ${PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}. ${p2Name}에게 1점 추가`}
            >
              🟡 {p1Name} {PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}<br/>
              <span className="text-xs opacity-75">→ {p2Name} +1점</span>
            </button>
            <button
              className="btn bg-yellow-900/80 hover:bg-yellow-800 text-yellow-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange || (action.type === 'irregular_serve' && match.currentServe !== 'player2')}
              onClick={() => handleIBSAScore(2, action.type, action.points, true, `${p2Name} ${action.label}`)}
              aria-label={`${p2Name} ${PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}. ${p1Name}에게 1점 추가`}
            >
              🟡 {p2Name} {PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}<br/>
              <span className="text-xs opacity-75">→ {p1Name} +1점</span>
            </button>
          </div>
        ))}

        {/* Penalties (경고/실점) */}
        <div className="text-center text-xs text-gray-400 font-semibold">벌점 (경고/실점)</div>
        {/* penalty_table_pushing: 1회 경고 → 2회 2점 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handlePenalty(1, 'penalty_table_pushing')}
            aria-label={`${p1Name} 테이블 푸싱. 1회 경고, 2회 ${p2Name}에게 2점`}
          >
            🔴 {p1Name} 테이블 푸싱<br/>
            <span className="text-xs opacity-75">1회 경고 → 2회 +2점</span>
          </button>
          <button
            className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handlePenalty(2, 'penalty_table_pushing')}
            aria-label={`${p2Name} 테이블 푸싱. 1회 경고, 2회 ${p1Name}에게 2점`}
          >
            🔴 {p2Name} 테이블 푸싱<br/>
            <span className="text-xs opacity-75">1회 경고 → 2회 +2점</span>
          </button>
        </div>
        {/* penalty_electronic: 즉시 2점 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handlePenalty(1, 'penalty_electronic')}
            aria-label={`${p1Name} 전자기기 소리. ${p2Name}에게 즉시 2점`}
          >
            🔴 {p1Name} 전자기기 소리<br/>
            <span className="text-xs opacity-75">→ {p2Name} 즉시 +2점</span>
          </button>
          <button
            className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handlePenalty(2, 'penalty_electronic')}
            aria-label={`${p2Name} 전자기기 소리. ${p1Name}에게 즉시 2점`}
          >
            🔴 {p2Name} 전자기기 소리<br/>
            <span className="text-xs opacity-75">→ {p1Name} 즉시 +2점</span>
          </button>
        </div>
        {/* penalty_talking: 1회 경고 → 2회 2점 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handlePenalty(1, 'penalty_talking')}
            aria-label={`${p1Name} 경기 중 말하기. 1회 경고, 2회 ${p2Name}에게 2점`}
          >
            🔴 {p1Name} 경기 중 말하기<br/>
            <span className="text-xs opacity-75">1회 경고 → 2회 +2점</span>
          </button>
          <button
            className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            onClick={() => handlePenalty(2, 'penalty_talking')}
            aria-label={`${p2Name} 경기 중 말하기. 1회 경고, 2회 ${p1Name}에게 2점`}
          >
            🔴 {p2Name} 경기 중 말하기<br/>
            <span className="text-xs opacity-75">1회 경고 → 2회 +2점</span>
          </button>
        </div>
        {/* mask_touch는 기존 penaltyActions에서 별도 처리 */}
        {penaltyActions.filter(a => !['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'].includes(a.type)).map(action => (
          <div key={action.type} className="grid grid-cols-2 gap-2">
            <button
              className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
              onClick={() => handleIBSAScore(1, action.type, action.points, true, `${p1Name} ${action.label}`)}
              aria-label={`${p1Name} ${PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}. ${p2Name}에게 ${action.points}점 추가`}
            >
              🔴 {p1Name} {PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}<br/>
              <span className="text-xs opacity-75">→ {p2Name} +{action.points}점</span>
            </button>
            <button
              className="btn bg-red-900/80 hover:bg-red-800 text-red-100 text-sm py-3 rounded-lg"
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
              onClick={() => handleIBSAScore(2, action.type, action.points, true, `${p2Name} ${action.label}`)}
              aria-label={`${p2Name} ${PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}. ${p1Name}에게 ${action.points}점 추가`}
            >
              🔴 {p2Name} {PRACTICE_DESCRIPTIVE_LABELS[action.type] || action.label}<br/>
              <span className="text-xs opacity-75">→ {p1Name} +{action.points}점</span>
            </button>
          </div>
        ))}

        {/* History (set-grouped) */}
        <div>
          <button
            className="text-sm text-gray-400 underline mb-2"
            onClick={() => setShowHistory(!showHistory)}
            aria-expanded={showHistory}
            aria-label={showHistory ? '경기 기록 닫기' : `경기 기록 열기, ${match.scoreHistory.length}건`}
            style={{ minHeight: '44px' }}
          >
            {showHistory ? '▲ 경기 기록 닫기' : `▼ 경기 기록 (${match.scoreHistory.length})`}
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
            aria-label="마지막 점수 취소"
          >
            ↩️ 취소
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
              aria-label={`${p1Name} 선수 타임아웃 (1분), 남은 횟수 ${1 - match.player1Timeouts}회`}
            >
              ⏱️ {p1Name} 선수 타임아웃
              <span className="block text-xs opacity-75">1분 | 남은: {1 - match.player1Timeouts}</span>
            </button>
            <button
              className="btn btn-secondary flex-1 py-2 text-sm"
              onClick={() => handleTimeout(2, 'player')}
              disabled={match.player2Timeouts >= 1 || !!match.activeTimeout}
              aria-label={`${p2Name} 선수 타임아웃 (1분), 남은 횟수 ${1 - match.player2Timeouts}회`}
            >
              ⏱️ {p2Name} 선수 타임아웃
              <span className="block text-xs opacity-75">1분 | 남은: {1 - match.player2Timeouts}</span>
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
                  aria-label={`${p1Name} 메디컬 타임아웃 (5분)`}
                >
                  🏥 {p1Name} 메디컬
                  <span className="block text-xs opacity-75">{med1 >= 1 ? '사용완료' : '5분 | 1회'}</span>
                </button>
                <button
                  className="btn flex-1 bg-teal-800 hover:bg-teal-700 text-white py-2 text-sm"
                  onClick={() => handleTimeout(2, 'medical')}
                  disabled={!!match.activeTimeout || med2 >= 1}
                  aria-label={`${p2Name} 메디컬 타임아웃 (5분)`}
                >
                  🏥 {p2Name} 메디컬
                  <span className="block text-xs opacity-75">{med2 >= 1 ? '사용완료' : '5분 | 1회'}</span>
                </button>
              </div>
            );
          })()}
          {/* 레프리 타임아웃 (제한없음) */}
          <button
            className="btn bg-yellow-800 hover:bg-yellow-700 text-white py-2 text-sm w-full"
            onClick={() => handleTimeout(1, 'referee')}
            disabled={!!match.activeTimeout}
            aria-label="레프리 타임아웃 (제한없음)"
          >
            🟨 레프리 타임아웃
            <span className="block text-xs opacity-75">제한없음 (수동 종료)</span>
          </button>
        </div>
        {/* Dead Ball (양쪽) + Substitution + Pause */}
        <div className="flex gap-2 mt-2">
          {matchType === 'team' && (match.team1Members?.length ?? 0) > 3 && !match.team1SubUsed && (
            <button
              className="btn flex-1 bg-purple-800 hover:bg-purple-700 text-white py-2 text-sm"
              onClick={() => { setSubTeam(1); setSubOutIdx(null); setSubInIdx(null); setShowSubModal(true); }}
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
              aria-label={`${p1Name} 선수 교체`}
            >
              🔄 {p1Name} 교체
            </button>
          )}
          {matchType === 'team' && (match.team2Members?.length ?? 0) > 3 && !match.team2SubUsed && (
            <button
              className="btn flex-1 bg-purple-800 hover:bg-purple-700 text-white py-2 text-sm"
              onClick={() => { setSubTeam(2); setSubOutIdx(null); setSubInIdx(null); setShowSubModal(true); }}
              disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
              aria-label={`${p2Name} 선수 교체`}
            >
              🔄 {p2Name} 교체
            </button>
          )}
          <button
            className="btn flex-1 bg-blue-800 hover:bg-blue-700 text-white py-2 text-sm"
            onClick={() => handleDeadBall(1)}
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            aria-label={`${p1Name} 데드볼. 현재 서브를 무효로 하고 재서브`}
          >
            🔵 {p1Name} 데드볼
          </button>
          <button
            className="btn flex-1 bg-blue-800 hover:bg-blue-700 text-white py-2 text-sm"
            onClick={() => handleDeadBall(2)}
            disabled={!!match.activeTimeout || isPausedLocal || showSideChange}
            aria-label={`${p2Name} 데드볼. 현재 서브를 무효로 하고 재서브`}
          >
            🔵 {p2Name} 데드볼
          </button>
          {!isPausedLocal && (
            <button className="btn flex-1 bg-gray-600 hover:bg-gray-500 text-white py-2 text-sm" onClick={handlePause} aria-label="경기 일시정지">
              ⏸️ 일시정지
            </button>
          )}
        </div>
      </div>

      {/* Set history */}
      {sets.length > 1 && (
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-3">
          <div className="flex gap-4 overflow-x-auto">
            {sets.map((s: SetScore, i: number) => (
              <div key={i} className={`text-center px-3 py-1 rounded ${i === ci ? 'bg-gray-700' : ''}`} aria-label={`세트 ${i + 1}: ${p1Name} ${s.player1Score} 대 ${p2Name} ${s.player2Score}${i === ci ? ' (현재 세트)' : ''}`} aria-current={i === ci ? 'true' : undefined}>
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
