import type { Tournament, Match, SetScore, Team, ScoreHistoryEntry, ScoreActionType, ScheduleSlot } from '../types';
import { formatTime, formatTimeShort } from '@shared/utils/locale';
import { resolveCompetitionRules, resolveMatchScoring, setWinnerByRules, type ScoringRuleSet } from '../rules/competitionRules';
import { servesPerTurnOf, sideChangePointOf } from '../rules/serve';
import { computeFinalsSeeding } from './competition';

/*
 * 관리자 시뮬레이션 (실제 DB에 기록된다). 판정·진출·시드·순위결정전 여부는 모두 대회 규칙 단일 설정원을 쓴다:
 * 경기 점수 = resolveMatchScoring(경기, 대회), 진출자·시드 = computeFinalsSeeding(서버 generate_finals와 같은 규칙),
 * 3/4위전·5~8위 결정전 = resolveCompetitionRules(대회, 본선).finalRanking, 서브 수·사이드 체인지 = shared/rules/serve.
 */

// 가상 이름 생성용
const LAST_NAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황'];
const FIRST_NAMES = ['민준', '서연', '도윤', '지우', '서준', '하은', '예준', '지민', '시우', '수아', '주원', '유진', '지호', '채원', '현우', '소율'];

// 랜덤 이름 생성
function generateName(index: number): string {
  return LAST_NAMES[index % LAST_NAMES.length] + FIRST_NAMES[index % FIRST_NAMES.length];
}

// 파울 액션 타입과 라벨 매핑
const FOUL_ACTIONS: { type: ScoreActionType; label: string; points: number }[] = [
  { type: 'irregular_serve', label: '부정서브', points: 1 },
  { type: 'centerboard', label: '센터보드', points: 1 },
  { type: 'body_touch', label: '바디터치', points: 1 },
  { type: 'illegal_defense', label: '일리걸디펜스', points: 1 },
  { type: 'out', label: '아웃', points: 1 },
  { type: 'ball_holding', label: '볼홀딩(2초)', points: 1 },
  { type: 'mask_touch', label: '마스크터치', points: 2 },
];

// 세트별 scoreHistory 생성
function simulateScoreHistory(
  p1Name: string,
  p2Name: string,
  _p1Id: string,
  _p2Id: string,
  sets: SetScore[],
  matchType: 'individual' | 'team',
  teamServeOrders: { team1: string[]; team2: string[] } | undefined,
  rules: ScoringRuleSet,
): ScoreHistoryEntry[] {
  const history: ScoreHistoryEntry[] = [];
  const maxServes = servesPerTurnOf(rules, matchType);
  // 경기 시작 기준 시각 (현재 시각에서 역산)
  const baseTime = Date.now() - sets.length * 10 * 60 * 1000;

  // 코인토스 결정 (첫 서버 결정)
  const coinTossWinner: 'player1' | 'player2' = Math.random() < 0.5 ? 'player1' : 'player2';
  const coinTossChoice: 'serve' | 'receive' = Math.random() < 0.5 ? 'serve' : 'receive';
  const courtChangeByLoser = Math.random() < 0.3; // 30% 확률로 코트 체인지
  const firstServer: 'player1' | 'player2' = coinTossChoice === 'serve' ? coinTossWinner : (coinTossWinner === 'player1' ? 'player2' : 'player1');
  const tossWinnerName = coinTossWinner === 'player1' ? p1Name : p2Name;
  const tossLoserName = coinTossWinner === 'player1' ? p2Name : p1Name;

  // 코인토스 이벤트
  const coinTossTime = new Date(baseTime - 120000); // 경기 시작 2분 전
  const courtChangeText = `${tossLoserName}: 코트 체인지 ${courtChangeByLoser ? '요청' : '유지'}`;
  history.push({
    time: formatTime(coinTossTime),
    scoringPlayer: tossWinnerName,
    actionPlayer: tossWinnerName,
    actionType: 'coin_toss' as ScoreActionType,
    actionLabel: `동전던지기: ${tossWinnerName} 승리 → ${coinTossChoice === 'serve' ? '서브' : '리시브'} 선택 / ${courtChangeText}`,
    points: 0,
    set: 1,
    server: firstServer === 'player1' ? p1Name : p2Name,
    serveNumber: 0,
    scoreBefore: { player1: 0, player2: 0 },
    scoreAfter: { player1: 0, player2: 0 },
    serverSide: firstServer,
  });

  // 워밍업 이벤트 (80% 확률)
  if (Math.random() < 0.8) {
    const warmupTime = new Date(baseTime - 90000); // 경기 시작 1분 30초 전
    history.push({
      time: formatTime(warmupTime),
      scoringPlayer: '',
      actionPlayer: '',
      actionType: 'warmup_start' as ScoreActionType,
      actionLabel: matchType === 'team' ? '워밍업 시작 (90초)' : '워밍업 시작 (60초)',
      points: 0,
      set: 1,
      server: firstServer === 'player1' ? p1Name : p2Name,
      serveNumber: 0,
      scoreBefore: { player1: 0, player2: 0 },
      scoreAfter: { player1: 0, player2: 0 },
      serverSide: firstServer,
    });
  }

  // 팀전 서브 순서 추적
  let team1RotIdx = 0;
  let team2RotIdx = 0;

  for (let setIdx = 0; setIdx < sets.length; setIdx++) {
    const set = sets[setIdx];
    let p1 = 0;
    let p2 = 0;
    // 첫 세트는 코인토스 결과, 이후 세트는 교대
    let server: 'player1' | 'player2' = setIdx === 0 ? firstServer : (setIdx % 2 === 0 ? firstServer : (firstServer === 'player1' ? 'player2' : 'player1'));
    let serveCount = 0;
    // 서브 교대 카운터 (로테이션 이벤트 추적)
    const targetP1 = set.player1Score;
    const targetP2 = set.player2Score;
    let entryIndex = 0;
    let sideChanged = false;
    // 결정 세트 판별: 양쪽 모두 setsToWin - 1 세트를 이겼을 때만 결정 세트
    const setsToWin = rules.setsToWin;
    let p1SetWins = 0, p2SetWins = 0;
    for (let si = 0; si < setIdx; si++) {
      if (sets[si].player1Score > sets[si].player2Score) p1SetWins++;
      else if (sets[si].player2Score > sets[si].player1Score) p2SetWins++;
    }
    const isDecidingSet = p1SetWins === setsToWin - 1 && p2SetWins === setsToWin - 1;

    // 세트 시작 시 첫 서브 기록 (서브 시작 이벤트)
    const setStartTime = new Date(baseTime + setIdx * 10 * 60 * 1000);
    const firstServerName = server === 'player1' ? p1Name : p2Name;
    const setStartIdx = history.length; // 이 세트의 시작 인덱스 기억
    history.push({
      time: formatTime(setStartTime),
      scoringPlayer: firstServerName,
      actionPlayer: firstServerName,
      actionType: 'match_start' as ScoreActionType,
      actionLabel: setIdx === 0 ? `${firstServerName} 첫 서브` : `세트 ${setIdx + 1} 시작 - ${firstServerName} 서브`,
      points: 0,
      set: setIdx + 1,
      server: firstServerName,
      serveNumber: 1,
      scoreBefore: { player1: 0, player2: 0 },
      scoreAfter: { player1: 0, player2: 0 },
      serverSide: server,
    });
    entryIndex++;

    // 실시간 득점 시뮬레이션: winScore 도달하면 즉시 세트 종료
    const winScore = targetP1 > targetP2 ? targetP1 : targetP2;

    while (p1 < winScore && p2 < winScore) {
      const scoreBefore = { player1: p1, player2: p2 };

      // 득점자 결정 (랜덤)
      const scoringPlayer1 = Math.random() < 0.5;

      // 액션 결정: 65% 골(+2), 35% 파울(+1)
      const isGoal = Math.random() < 0.65;
      let actionType: ScoreActionType;
      let points: number;
      let actingPlayer: string;
      let scoringName: string;
      let label: string;

      if (isGoal) {
        actionType = 'goal';
        points = 2;
        if (scoringPlayer1) {
          actingPlayer = p1Name;
          scoringName = p1Name;
          p1 += 2;
        } else {
          actingPlayer = p2Name;
          scoringName = p2Name;
          p2 += 2;
        }
        label = `${actingPlayer} 골`;
      } else {
        // 파울: 상대에게 1점
        let foulCandidates = FOUL_ACTIONS;

        if (scoringPlayer1) {
          if (server !== 'player2') {
            foulCandidates = FOUL_ACTIONS.filter(f => f.type !== 'irregular_serve');
          }
        } else {
          if (server !== 'player1') {
            foulCandidates = FOUL_ACTIONS.filter(f => f.type !== 'irregular_serve');
          }
        }

        const foul = foulCandidates[Math.floor(Math.random() * foulCandidates.length)];
        actionType = foul.type;
        points = foul.points;

        // 마스크터치(2점)로 winScore를 넘을 수 있음 → OK (실제 규칙과 동일)
        if (scoringPlayer1) {
          actingPlayer = p2Name;
          scoringName = p1Name;
          p1 += points;
        } else {
          actingPlayer = p1Name;
          scoringName = p2Name;
          p2 += points;
        }
        label = `${actingPlayer} ${foul.label}`;
      }

      const scoreAfter = { player1: p1, player2: p2 };
      const serverName = server === 'player1' ? p1Name : p2Name;
      const entryTime = new Date(baseTime + setIdx * 10 * 60 * 1000 + entryIndex * 30000);

      history.push({
        time: formatTime(entryTime),
        scoringPlayer: scoringName,
        actionPlayer: actingPlayer,
        actionType,
        actionLabel: label,
        points,
        set: setIdx + 1,
        server: serverName,
        serveNumber: serveCount + 1,
        scoreBefore,
        scoreAfter,
        serverSide: server,
      });

      entryIndex++;

      // 사이드 체인지: 결정 세트(단판 포함)에서 규칙의 사이드 체인지 점수(기본 ceil(목표/2))
      if (!sideChanged) {
        const shouldChange = isDecidingSet && Math.max(p1, p2) >= sideChangePointOf(rules);
        if (shouldChange) {
          sideChanged = true;
          const scTime = new Date(baseTime + setIdx * 10 * 60 * 1000 + entryIndex * 30000);
          history.push({
            time: formatTime(scTime),
            scoringPlayer: '',
            actionPlayer: '',
            actionType: 'side_change' as ScoreActionType,
            actionLabel: '사이드 체인지 (1분 휴식)',
            points: 0,
            set: setIdx + 1,
            server: server === 'player1' ? p1Name : p2Name,
            serveNumber: serveCount + 1,
            scoreBefore: scoreAfter,
            scoreAfter: scoreAfter,
            serverSide: server,
          });
          entryIndex++;
        }
      }

      // 서브 교대
      serveCount++;
      if (serveCount >= maxServes) {
        server = server === 'player1' ? 'player2' : 'player1';
        serveCount = 0;

        // 팀전: 서브 교대 시 선수 로테이션 이벤트 (서브 순서가 있는 경우)
        if (matchType === 'team' && teamServeOrders) {
          const rotTeam = server === 'player1' ? 'team1' : 'team2';
          const rotTeamName = server === 'player1' ? p1Name : p2Name;
          const rotOrder = teamServeOrders[rotTeam];
          if (rotOrder && rotOrder.length > 1) {
            // 이전 서버가 해당 팀이면 로테이션 발생
            const rotIdx = rotTeam === 'team1' ? team1RotIdx : team2RotIdx;
            const nextIdx = (rotIdx + 1) % rotOrder.length;
            const prevPlayerName = rotOrder[rotIdx];
            const nextPlayerName = rotOrder[nextIdx];
            if (rotTeam === 'team1') team1RotIdx = nextIdx;
            else team2RotIdx = nextIdx;

            if (prevPlayerName !== nextPlayerName) {
              const rotTime = new Date(baseTime + setIdx * 10 * 60 * 1000 + entryIndex * 30000);
              history.push({
                time: formatTime(rotTime),
                scoringPlayer: '',
                actionPlayer: rotTeamName,
                actionType: 'player_rotation' as ScoreActionType,
                actionLabel: `선수 교체: ${prevPlayerName} → ${nextPlayerName} (${rotTeamName})`,
                points: 0,
                set: setIdx + 1,
                server: server === 'player1' ? p1Name : p2Name,
                serveNumber: 1,
                scoreBefore: scoreAfter,
                scoreAfter: scoreAfter,
                serverSide: server,
              });
              entryIndex++;
            }
          }
        }
      }
    }

    // 실제 시뮬레이션 점수로 sets 업데이트 (목표 점수와 다를 수 있음)
    set.player1Score = p1;
    set.player2Score = p2;

    // 세트당 랜덤으로 타임아웃 1회 삽입 (50% 확률, 이 세트 범위 내에서만)
    if (Math.random() < 0.5) {
      const timeoutCaller: 'player1' | 'player2' = Math.random() < 0.5 ? 'player1' : 'player2';
      const callerName = timeoutCaller === 'player1' ? p1Name : p2Name;
      // 이 세트 엔트리 중간에 삽입 (세트 시작 이후, 세트 끝 이전)
      const setEntryCount = history.length - setStartIdx;
      const insertIdx = setStartIdx + Math.max(1, Math.floor(setEntryCount / 2));
      // 삽입 위치 바로 이전 엔트리의 점수를 참조 (타임아웃 시점의 실제 점수)
      const prevEntry = history[insertIdx - 1];
      const timeoutScore = prevEntry ? prevEntry.scoreAfter : { player1: 0, player2: 0 };
      const timeoutTime = new Date(baseTime + setIdx * 10 * 60 * 1000 + Math.floor(entryIndex / 2) * 30000);

      history.splice(insertIdx, 0, {
        time: formatTime(timeoutTime),
        scoringPlayer: callerName,
        actionPlayer: callerName,
        actionType: 'timeout',
        actionLabel: `${callerName} 타임아웃`,
        points: 0,
        set: setIdx + 1,
        server: server === 'player1' ? p1Name : p2Name,
        serveNumber: serveCount + 1,
        scoreBefore: timeoutScore,
        scoreAfter: timeoutScore,
        serverSide: server,
      });
    }
  }

  // 최신 기록이 앞에 오도록 역순 정렬
  return history.reverse();
}

// 랜덤 세트 점수 생성
function simulateSet(rules: ScoringRuleSet): SetScore {
  const winner = Math.random() < 0.5 ? 1 : 2;
  const loserScore = Math.floor(Math.random() * rules.winScore);
  let winnerScore = Math.max(rules.winScore, loserScore + rules.minLead);
  // 규칙(듀스 캡 포함)으로 끝난 세트가 될 때까지 올린다
  while (!setWinnerByRules(winnerScore, loserScore, rules)) winnerScore++;

  return {
    player1Score: winner === 1 ? winnerScore : loserScore,
    player2Score: winner === 2 ? winnerScore : loserScore,
    player1Faults: Math.floor(Math.random() * 3),
    player2Faults: Math.floor(Math.random() * 3),
    player1Violations: 0,
    player2Violations: 0,
    winnerId: null, // 아래에서 설정
  };
}

// 경기 결과 시뮬레이션 (Best of N 세트)
function simulateMatchResult(
  rules: ScoringRuleSet,
  p1Id: string,
  p2Id: string,
): {
  sets: SetScore[];
  winner: 1 | 2;
} {
  const sets: SetScore[] = [];
  let p1Wins = 0;
  let p2Wins = 0;

  while (p1Wins < rules.setsToWin && p2Wins < rules.setsToWin) {
    const set = simulateSet(rules);
    const setWinner = setWinnerByRules(set.player1Score, set.player2Score, rules) ?? 1;
    // winnerId를 실제 승자 ID로 설정
    set.winnerId = setWinner === 1 ? p1Id : p2Id;
    if (setWinner === 1) p1Wins++;
    else p2Wins++;
    sets.push(set);
  }

  return { sets, winner: p1Wins >= rules.setsToWin ? 1 : 2 };
}

// 다음 2의 거듭제곱으로 올림
function nextPowerOf2(n: number): number {
  let v = 1;
  while (v < n) v *= 2;
  return v;
}

// 라운드 라벨 결정
function getRoundLabel(bracketSize: number, round: number, totalRounds: number): string {
  const remaining = bracketSize / Math.pow(2, round);
  if (remaining === 1) return '결승';
  if (remaining === 2) return '4강';
  if (remaining === 4) return '8강';
  if (remaining === 8) return '16강';
  if (remaining === 16) return '32강';
  // fallback
  const roundFromEnd = totalRounds - round;
  if (roundFromEnd === 0) return '결승';
  if (roundFromEnd === 1) return '4강';
  return `${bracketSize / Math.pow(2, round - 1)}강`;
}

// 참가자 이름 조회 헬퍼
function getParticipantName(id: string, nameMap: Map<string, string>): string {
  return nameMap.get(id) || id;
}

// 본선 싱글엘리미네이션 경기 생성
function generateFinalsMatches(
  slots: ReadonlyArray<{ id: string } | null>,
  nameMap: Map<string, string>,
  tournament: Tournament,
  matchType: 'individual' | 'team',
  stageId: string,
  referees: { id: string; name: string }[],
  courts: { id: string; name: string }[],
  matchCounter: { value: number },
  scheduleBaseTime: Date,
  isTeam: boolean,
  teamsMap?: Map<string, { id: string; name: string; memberIds: string[]; memberNames: string[] }>,
): { matches: Omit<Match, 'id'>[]; schedule: Omit<ScheduleSlot, 'id'>[]; finalMatch?: Omit<Match, 'id'>; semifinalLosers: string[]; quarterFinalLosers: string[] } {
  const matches: Omit<Match, 'id'>[] = [];
  const schedule: Omit<ScheduleSlot, 'id'>[] = [];
  const semifinalLosers: string[] = [];
  const quarterFinalLosers: string[] = [];

  const bracketSize = nextPowerOf2(slots.length);
  const totalRounds = Math.log2(bracketSize);

  // 시드 배치 (computeFinalsSeeding: 표준 시드 위치 + 같은 조 회피, null = BYE)
  const seeded: (string | null)[] = [];
  for (let i = 0; i < bracketSize; i++) seeded.push(slots[i]?.id ?? null);

  let currentParticipants = seeded;
  let finalMatch: Omit<Match, 'id'> | undefined;

  for (let round = 1; round <= totalRounds; round++) {
    const roundLabel = getRoundLabel(bracketSize, round, totalRounds);
    const nextRoundParticipants: (string | null)[] = [];

    for (let i = 0; i < currentParticipants.length; i += 2) {
      const p1 = currentParticipants[i];
      const p2 = currentParticipants[i + 1];

      // BYE 처리
      if (p1 === null && p2 === null) {
        nextRoundParticipants.push(null);
        continue;
      }
      if (p2 === null) {
        nextRoundParticipants.push(p1);
        continue;
      }
      if (p1 === null) {
        nextRoundParticipants.push(p2);
        continue;
      }

      // 실제 경기 시뮬레이션 (그 라운드의 규칙: 라운드별 세트 수 등)
      const rules = resolveMatchScoring({ type: matchType, stageId, roundLabel, bracketRound: roundLabel }, tournament);
      const result = simulateMatchResult(rules, p1, p2);
      const winnerId = result.winner === 1 ? p1 : p2;
      const loserId = result.winner === 1 ? p2 : p1;
      nextRoundParticipants.push(winnerId);

      // 4강 패자 기록
      if (roundLabel === '4강') {
        semifinalLosers.push(loserId);
      }
      // 8강 패자 기록
      if (roundLabel === '8강') {
        quarterFinalLosers.push(loserId);
      }

      const p1Name = getParticipantName(p1, nameMap);
      const p2Name = getParticipantName(p2, nameMap);

      // 팀전 서브 순서 생성
      const teamServeOrders = isTeam && teamsMap ? (() => {
        const t1 = teamsMap.get(p1);
        const t2 = teamsMap.get(p2);
        return {
          team1: t1?.memberNames || [p1Name],
          team2: t2?.memberNames || [p2Name],
        };
      })() : undefined;
      const scoreHistory = simulateScoreHistory(p1Name, p2Name, p1, p2, result.sets, matchType, teamServeOrders, rules);
      const refIndex = matchCounter.value % referees.length;
      const courtIndex = matchCounter.value % courts.length;
      const matchId = `sim_match_${matchCounter.value}`;

      const scheduledTime = new Date(scheduleBaseTime.getTime() + matchCounter.value * 20 * 60 * 1000);
      const timeStr = formatTimeShort(scheduledTime);

      const match: Omit<Match, 'id'> = {
        tournamentId: tournament.id,
        type: matchType,
        status: 'completed',
        round,
        sets: result.sets,
        currentSet: result.sets.length - 1,
        player1Timeouts: 0,
        player2Timeouts: 0,
        activeTimeout: null,
        currentServe: 'player1',
        serveCount: 0,
        serveSelected: true,
        sideChangeUsed: true,
        scoreHistory,
        winnerId,
        refereeId: referees[refIndex].id,
        refereeName: referees[refIndex].name,
        courtId: courts[courtIndex].id,
        courtName: courts[courtIndex].name,
        stageId,
        // groupId 없음 (본선/순위결정전)
        roundLabel,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(isTeam && teamsMap ? {
          team1Id: p1,
          team2Id: p2,
          team1Name: p1Name,
          team2Name: p2Name,
          team1: teamsMap.get(p1) as unknown as Team,
          team2: teamsMap.get(p2) as unknown as Team,
        } : {
          player1Id: p1,
          player2Id: p2,
          player1Name: p1Name,
          player2Name: p2Name,
        }),
      };

      matches.push(match);
      if (roundLabel === '결승') {
        finalMatch = match;
      }

      schedule.push({
        matchId,
        courtId: courts[courtIndex].id,
        courtName: courts[courtIndex].name,
        scheduledTime: timeStr,
        scheduledDate: scheduleBaseTime.toISOString().split('T')[0],
        label: `${p1Name} vs ${p2Name}`,
        status: 'completed',
      });

      // referees are passed from main function with assignedMatchIds
      (referees as unknown as { assignedMatchIds: string[] }[])[refIndex].assignedMatchIds.push(matchId);

      matchCounter.value++;
    }

    currentParticipants = nextRoundParticipants;
  }

  return { matches, schedule, finalMatch, semifinalLosers, quarterFinalLosers };
}

// 순위결정전 단일 경기 생성 헬퍼
function createRankingMatch(
  p1Id: string,
  p2Id: string,
  nameMap: Map<string, string>,
  tournament: Tournament,
  matchType: 'individual' | 'team',
  stageId: string,
  roundLabel: string,
  referees: { id: string; name: string }[],
  courts: { id: string; name: string }[],
  matchCounter: { value: number },
  scheduleBaseTime: Date,
  isTeam: boolean,
  teamsMap?: Map<string, { id: string; name: string; memberIds: string[]; memberNames: string[] }>,
): { match: Omit<Match, 'id'>; slot: Omit<ScheduleSlot, 'id'> } {
  const p1Name = getParticipantName(p1Id, nameMap);
  const p2Name = getParticipantName(p2Id, nameMap);
  // 순위결정전 규칙(placementScoring) 또는 3/4위전(결승 라운드 규칙)
  const rules = resolveMatchScoring({ type: matchType, stageId, roundLabel, bracketRound: roundLabel }, tournament);
  const result = simulateMatchResult(rules, p1Id, p2Id);
  const winnerId = result.winner === 1 ? p1Id : p2Id;
  // 팀전 서브 순서 생성
  const teamServeOrders = isTeam && teamsMap ? (() => {
    const t1 = teamsMap.get(p1Id);
    const t2 = teamsMap.get(p2Id);
    return {
      team1: t1?.memberNames || [p1Name],
      team2: t2?.memberNames || [p2Name],
    };
  })() : undefined;
  const scoreHistory = simulateScoreHistory(p1Name, p2Name, p1Id, p2Id, result.sets, matchType, teamServeOrders, rules);
  const refIndex = matchCounter.value % referees.length;
  const courtIndex = matchCounter.value % courts.length;
  const matchId = `sim_match_${matchCounter.value}`;
  const scheduledTime = new Date(scheduleBaseTime.getTime() + matchCounter.value * 20 * 60 * 1000);
  const timeStr = formatTimeShort(scheduledTime);

  const match: Omit<Match, 'id'> = {
    tournamentId: tournament.id,
    type: matchType,
    status: 'completed',
    round: 1,
    sets: result.sets,
    currentSet: result.sets.length - 1,
    player1Timeouts: 0,
    player2Timeouts: 0,
    activeTimeout: null,
    currentServe: 'player1',
    serveCount: 0,
    serveSelected: true,
    sideChangeUsed: true,
    scoreHistory,
    winnerId,
    refereeId: referees[refIndex].id,
    refereeName: referees[refIndex].name,
    courtId: courts[courtIndex].id,
    courtName: courts[courtIndex].name,
    stageId,
    groupId: undefined,
    roundLabel,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(isTeam && teamsMap ? {
      team1Id: p1Id,
      team2Id: p2Id,
      team1Name: p1Name,
      team2Name: p2Name,
      team1: teamsMap.get(p1Id) as unknown as Team,
      team2: teamsMap.get(p2Id) as unknown as Team,
    } : {
      player1Id: p1Id,
      player2Id: p2Id,
      player1Name: p1Name,
      player2Name: p2Name,
    }),
  };

  const slot: Omit<ScheduleSlot, 'id'> = {
    matchId,
    courtId: courts[courtIndex].id,
    courtName: courts[courtIndex].name,
    scheduledTime: timeStr,
    scheduledDate: scheduleBaseTime.toISOString().split('T')[0],
    label: `${p1Name} vs ${p2Name}`,
    status: 'completed',
  };

  matchCounter.value++;
  return { match, slot };
}

// ===== 메인 시뮬레이션 함수 =====
export interface SimulationResult {
  players: { id: string; name: string }[];
  teams?: { id: string; name: string; memberIds: string[]; memberNames: string[] }[];
  matches: Omit<Match, 'id'>[];
  referees: { id: string; name: string; assignedMatchIds: string[] }[];
  schedule: Omit<ScheduleSlot, 'id'>[];
}

export interface SimulationOptions {
  existingPlayers?: { id: string; name: string }[];
  existingTeams?: { id: string; name: string; memberIds: string[]; memberNames: string[] }[];
  existingReferees?: { id: string; name: string }[];
  existingCourts?: { id: string; name: string }[];
  samplePlayerNames?: string[];
  sampleRefereeNames?: string[];
}

export function simulateTournament(tournament: Tournament, participantCount: number, options?: SimulationOptions): SimulationResult {
  const isTeam = tournament.type === 'team' || tournament.type === 'randomTeamLeague';

  const matchType: 'individual' | 'team' = isTeam ? 'team' : 'individual';

  // stageId 결정
  const qualifyingStageId = tournament.stages?.find(s => s.type === 'qualifying')?.id || 'qualifying';
  const finalsStageId = tournament.stages?.find(s => s.type === 'finals')?.id || 'finals';

  // 본선 설정
  const hasFinalsStage = !!(tournament.stages?.some(s => s.type === 'finals') || tournament.finalsConfig);
  const finalRankingRules = resolveCompetitionRules(tournament, finalsStageId).finalRanking;

  // 1. 참가자: 기존 등록 선수 → 샘플 이름 → 가상 이름 순으로 사용
  const samplePlayers = options?.samplePlayerNames || [];
  const genPlayerName = (i: number): string => {
    if (i < samplePlayers.length) return samplePlayers[i];
    return generateName(i);
  };

  // 기존 팀이 있으면 선수 생성 건너뜀 (팀에 이미 멤버 포함)
  const hasExistingTeams = isTeam && options?.existingTeams && options.existingTeams.length > 0;
  let players: { id: string; name: string; gender?: string }[];

  if (hasExistingTeams) {
    // 기존 팀의 멤버를 players로 추출 (결과에 포함하기 위해)
    players = options!.existingTeams!.flatMap(t =>
      t.memberIds.map((id, i) => ({ id, name: t.memberNames[i] || id }))
    );
  } else {
    players = (options?.existingPlayers && options.existingPlayers.length > 0)
      ? options.existingPlayers.slice(0, participantCount).map(p => ({ ...p }))
      : Array.from({ length: participantCount }, (_, i) => ({
          id: `sim_player_${i}`,
          name: genPlayerName(i),
        }));
    // 부족분 보충 (샘플 → 가상)
    while (players.length < participantCount) {
      players.push({ id: `sim_player_${players.length}`, name: genPlayerName(players.length) });
    }

    // 성별 비율이 설정된 경우 자동 생성된 선수에게 성별 배정
    if (isTeam && tournament.teamRules?.genderRatio) {
      const ratio = tournament.teamRules.genderRatio;
      const teamSize = tournament.teamRules?.teamSize || 3;
      const teamCount = Math.floor(participantCount / teamSize);
      const neededMale = ratio.male * teamCount;
      const neededFemale = ratio.female * teamCount;

      if (!options?.existingPlayers) {
        players.forEach((p, i) => {
          p.gender = i < neededMale ? 'male' : (i < neededMale + neededFemale ? 'female' : undefined);
        });
      }
    }
  }

  // 2. 팀: 기존 팀이 있으면 그대로 사용 (이름/구성 유지), 없으면 가상 생성
  let teams: SimulationResult['teams'];
  const teamsMap = new Map<string, { id: string; name: string; memberIds: string[]; memberNames: string[] }>();
  if (isTeam) {
    if (options?.existingTeams && options.existingTeams.length > 0) {
      // 기존 팀 그대로 사용 (사용자가 만든 팀명/멤버 유지)
      teams = options.existingTeams;
    } else {
      const teamSize = tournament.teamRules?.teamSize || 3;
      const teamCount = Math.floor(participantCount / teamSize);
      const genderRatio = tournament.teamRules?.genderRatio;

      if (genderRatio && (genderRatio.male > 0 || genderRatio.female > 0)) {
        const males = players.filter(p => p.gender === 'male');
        const females = players.filter(p => p.gender === 'female');
        teams = Array.from({ length: teamCount }, (_, i) => {
          const maleMembers = males.slice(i * genderRatio.male, (i + 1) * genderRatio.male);
          const femaleMembers = females.slice(i * genderRatio.female, (i + 1) * genderRatio.female);
          const members = [...maleMembers, ...femaleMembers];
          return {
            id: `sim_team_${i}`,
            name: `${i + 1}팀`,
            memberIds: members.map(p => p.id),
            memberNames: members.map(p => p.name),
          };
        });
      } else {
        teams = Array.from({ length: teamCount }, (_, i) => ({
          id: `sim_team_${i}`,
          name: `${i + 1}팀`,
          memberIds: players.slice(i * teamSize, (i + 1) * teamSize).map(p => p.id),
          memberNames: players.slice(i * teamSize, (i + 1) * teamSize).map(p => p.name),
        }));
      }
    }
    for (const t of teams) {
      teamsMap.set(t.id, t);
    }
  }

  // 3. 심판: 기존 등록 심판 → 샘플 이름 → 가상 이름 순으로 사용
  const sampleRefs = options?.sampleRefereeNames || [];
  const defaultRefNames = sampleRefs.length >= 3
    ? sampleRefs.slice(0, 3)
    : ['심판 A', '심판 B', '심판 C'];
  const referees: { id: string; name: string; assignedMatchIds: string[] }[] =
    (options?.existingReferees && options.existingReferees.length > 0)
      ? options.existingReferees.map(r => ({ id: r.id, name: r.name, assignedMatchIds: [] }))
      : defaultRefNames.map((name, i) => ({ id: `sim_ref_${i + 1}`, name, assignedMatchIds: [] }));

  // 4. 코트: 기존 등록 코트 → 가상 코트 순으로 사용
  const courts = (options?.existingCourts && options.existingCourts.length > 0)
    ? options.existingCourts
    : [
        { id: 'sim_court_1', name: '1코트' },
        { id: 'sim_court_2', name: '2코트' },
      ];

  // 5. 조별 편성 (대회 설정의 groupCount 사용)
  const participants: { id: string; name: string; memberIds?: string[]; memberNames?: string[] }[] = isTeam ? teams! : players;
  const configGroupCount = tournament.qualifyingConfig?.groupCount
    || tournament.stages?.find(s => s.type === 'qualifying')?.groupCount
    || undefined;
  const hasQualifyingStage = !!(tournament.qualifyingConfig || tournament.stages?.some(s => s.type === 'qualifying'));
  const hasGroupStage = hasQualifyingStage && (configGroupCount ? configGroupCount > 1 : participants.length >= 4);
  const groupCount = hasGroupStage ? (configGroupCount || Math.min(Math.ceil(participants.length / 4), 4)) : 1;
  const groups: { id: string; members: typeof participants }[] = [];

  if (hasGroupStage) {
    // Snake draft로 균등 배분 (buildGroupAssignment와 동일 로직)
    const groupMembers: (typeof participants)[] = Array.from({ length: groupCount }, () => []);
    for (let i = 0; i < participants.length; i++) {
      const round = Math.floor(i / groupCount);
      const pos = i % groupCount;
      const groupIndex = round % 2 === 0 ? pos : groupCount - 1 - pos;
      groupMembers[groupIndex].push(participants[i]);
    }
    for (let g = 0; g < groupCount; g++) {
      groups.push({
        id: String.fromCharCode(65 + g), // 'A', 'B', ...
        members: groupMembers[g],
      });
    }
  } else {
    groups.push({ id: 'A', members: [...participants] });
  }

  // 이름 맵 구축
  const nameMap = new Map<string, string>();
  for (const p of participants) {
    nameMap.set(p.id, p.name);
  }

  // 6. 라운드로빈 대진 + 결과 (조별)
  const matches: Omit<Match, 'id'>[] = [];
  const schedule: Omit<ScheduleSlot, 'id'>[] = [];
  const matchCounter = { value: 0 };
  const scheduleBaseTime = new Date();
  scheduleBaseTime.setHours(9, 0, 0, 0); // 오전 9시 시작
  const scheduleDateStr = scheduleBaseTime.toISOString().split('T')[0]; // YYYY-MM-DD

  for (const group of groups) {
    for (let i = 0; i < group.members.length; i++) {
      for (let j = i + 1; j < group.members.length; j++) {
        const p1 = group.members[i];
        const p2 = group.members[j];
        const p1Id = p1.id;
        const p2Id = p2.id;

        const qualRules = resolveMatchScoring({ type: matchType, stageId: qualifyingStageId }, tournament);
        const result = simulateMatchResult(qualRules, p1Id, p2Id);
        const refIndex = matchCounter.value % referees.length;
        const courtIndex = matchCounter.value % courts.length;
        const matchId = `sim_match_${matchCounter.value}`;

        // 심판 배정
        referees[refIndex].assignedMatchIds.push(matchId);

        // 이름 결정
        const p1Name = isTeam
          ? (p1 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).name
          : (p1 as { id: string; name: string }).name;
        const p2Name = isTeam
          ? (p2 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).name
          : (p2 as { id: string; name: string }).name;

        // 팀전 서브 순서 생성
        const teamServeOrders = isTeam ? (() => {
          const t1 = p1 as { id: string; name: string; memberIds: string[]; memberNames: string[] };
          const t2 = p2 as { id: string; name: string; memberIds: string[]; memberNames: string[] };
          return {
            team1: t1.memberNames || [p1Name],
            team2: t2.memberNames || [p2Name],
          };
        })() : undefined;
        // scoreHistory 생성
        const scoreHistory = simulateScoreHistory(
          p1Name, p2Name, p1Id, p2Id,
          result.sets, matchType, teamServeOrders, qualRules,
        );

        // 스케줄 시간 계산 (20분 간격)
        const scheduledTime = new Date(scheduleBaseTime.getTime() + matchCounter.value * 20 * 60 * 1000);
        const timeStr = formatTimeShort(scheduledTime);

        const match: Omit<Match, 'id'> = {
          tournamentId: tournament.id,
          type: matchType,
          status: 'completed',
          round: Math.floor(matchCounter.value / Math.max(1, Math.floor(group.members.length / 2))) + 1,
          sets: result.sets,
          currentSet: result.sets.length - 1,
          player1Timeouts: 0,
          player2Timeouts: 0,
          activeTimeout: null,
          currentServe: 'player1',
          serveCount: 0,
          serveSelected: true,
          sideChangeUsed: true,
          scoreHistory,
          winnerId: result.winner === 1 ? p1Id : p2Id,
          refereeId: referees[refIndex].id,
          refereeName: referees[refIndex].name,
          courtId: courts[courtIndex].id,
          courtName: courts[courtIndex].name,
          stageId: qualifyingStageId,
          ...(hasGroupStage ? { groupId: group.id } : {}),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...(isTeam ? {
            team1Id: (p1 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).id,
            team2Id: (p2 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).id,
            team1Name: p1Name,
            team2Name: p2Name,
            team1: p1 as Team,
            team2: p2 as Team,
          } : {
            player1Id: p1Id,
            player2Id: p2Id,
            player1Name: p1Name,
            player2Name: p2Name,
          }),
        };

        matches.push(match);

        // 스케줄 슬롯 생성
        const label = `${p1Name} vs ${p2Name}`;
        schedule.push({
          matchId,
          courtId: courts[courtIndex].id,
          courtName: courts[courtIndex].name,
          scheduledTime: timeStr,
          scheduledDate: scheduleDateStr,
          label,
          status: 'completed',
        });

        matchCounter.value++;
      }
    }
  }

  // ===== 7. 본선 진출자 선정 + 본선 경기 =====
  // 진출자·시드는 서버 generate_finals와 같은 규칙(computeFinalsSeeding: 조당 인원 + 명시적 와일드카드 + 동률 규칙 + 표준 시드)
  if (hasFinalsStage && hasGroupStage) {
    const qualMatches = matches.map((m, i) => ({ ...m, id: `sim_match_${i}` }) as Match).filter(m => m.stageId === qualifyingStageId);
    const seeding = computeFinalsSeeding(tournament, qualMatches, qualifyingStageId, finalsStageId);
    const realCount = seeding.slots.filter(Boolean).length;
    if (realCount >= 2) {
      const finalsResult = generateFinalsMatches(
        seeding.slots,
        nameMap,
        tournament,
        matchType,
        finalsStageId,
        referees,
        courts,
        matchCounter,
        scheduleBaseTime,
        isTeam,
        teamsMap.size > 0 ? teamsMap : undefined,
      );

      matches.push(...finalsResult.matches);
      schedule.push(...finalsResult.schedule);

      const tm = teamsMap.size > 0 ? teamsMap : undefined;
      const addRanking = (a: string, b: string, stageId: string, label: string) => {
        const r = createRankingMatch(a, b, nameMap, tournament, matchType, stageId, label, referees, courts, matchCounter, scheduleBaseTime, isTeam, tm);
        matches.push(r.match);
        schedule.push(r.slot);
        return r.match;
      };
      const loserOf = (m: Omit<Match, 'id'>) => {
        const a = isTeam ? m.team1Id : m.player1Id;
        const b = isTeam ? m.team2Id : m.player2Id;
        return m.winnerId === a ? b! : a!;
      };

      // ===== 8. 순위결정전 (대회 규칙의 최종 순위 설정) =====
      // 3/4위 결정전: finalRanking.thirdPlace = 'match'
      if (finalRankingRules.thirdPlace === 'match' && finalsResult.semifinalLosers.length === 2) {
        addRanking(finalsResult.semifinalLosers[0], finalsResult.semifinalLosers[1], `${finalsStageId}_3rd`, '3/4위 결정전');
      }

      // 5~8위 결정전: finalRanking.fifthToEighthMatches (8강 패자)
      const losers = finalsResult.quarterFinalLosers;
      const format = finalRankingRules.fifthToEighthMatches;
      const stage58 = `${finalsStageId}_5to8`;
      if (format !== 'none' && losers.length >= 4 && (format === 'simple' || format === 'full')) {
        const semi1 = addRanking(losers[0], losers[1], stage58, '5-8위 결정전');
        const semi2 = addRanking(losers[2], losers[3], stage58, '5-8위 결정전');
        if (format === 'full') {
          addRanking(semi1.winnerId!, semi2.winnerId!, stage58, '5/6위 결정전');
          addRanking(loserOf(semi1), loserOf(semi2), stage58, '7/8위 결정전');
        }
      } else if (format === 'round_robin' && losers.length >= 2) {
        for (let i = 0; i < losers.length; i++) {
          for (let j = i + 1; j < losers.length; j++) {
            addRanking(losers[i], losers[j], stage58, '5~8위 순위 결정전');
          }
        }
      }
    }
  }

  return { players, teams, matches, referees, schedule };
}
