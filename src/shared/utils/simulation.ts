import type { Tournament, Match, SetScore, Team, ScoreHistoryEntry, ScoreActionType, ScheduleSlot } from '../types';

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
): ScoreHistoryEntry[] {
  const history: ScoreHistoryEntry[] = [];
  const maxServes = matchType === 'team' ? 3 : 2;
  // 경기 시작 기준 시각 (현재 시각에서 역산)
  const baseTime = Date.now() - sets.length * 10 * 60 * 1000;

  for (let setIdx = 0; setIdx < sets.length; setIdx++) {
    const set = sets[setIdx];
    let p1 = 0;
    let p2 = 0;
    let server: 'player1' | 'player2' = Math.random() < 0.5 ? 'player1' : 'player2';
    let serveCount = 0;
    const targetP1 = set.player1Score;
    const targetP2 = set.player2Score;
    let entryIndex = 0;

    while (p1 < targetP1 || p2 < targetP2) {
      const remainP1 = targetP1 - p1;
      const remainP2 = targetP2 - p2;
      if (remainP1 <= 0 && remainP2 <= 0) break;

      // 랜덤으로 누가 득점할지 결정 (남은 점수 비율 기반)
      const scoringPlayer1 = remainP1 > 0 && (remainP2 <= 0 || Math.random() < remainP1 / (remainP1 + remainP2));
      const scoreBefore = { player1: p1, player2: p2 };

      // 액션 타입 결정 (65% 골, 35% 파울)
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
          p1 = Math.min(p1 + 2, targetP1);
        } else {
          actingPlayer = p2Name;
          scoringName = p2Name;
          p2 = Math.min(p2 + 2, targetP2);
        }
        label = `${actingPlayer} 골`;
      } else {
        // 파울: 상대에게 점수
        const foul = FOUL_ACTIONS[Math.floor(Math.random() * FOUL_ACTIONS.length)];
        actionType = foul.type;
        points = foul.points;

        if (scoringPlayer1) {
          // p1이 점수를 받음 = p2가 파울
          actingPlayer = p2Name;
          scoringName = p1Name;
          p1 = Math.min(p1 + points, targetP1);
        } else {
          actingPlayer = p1Name;
          scoringName = p2Name;
          p2 = Math.min(p2 + points, targetP2);
        }
        label = `${actingPlayer} ${foul.label}`;
      }

      const scoreAfter = { player1: p1, player2: p2 };
      const serverName = server === 'player1' ? p1Name : p2Name;
      const entryTime = new Date(baseTime + setIdx * 10 * 60 * 1000 + entryIndex * 30000);

      history.push({
        time: entryTime.toLocaleTimeString('ko-KR'),
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
      });

      entryIndex++;

      // 서브 교대
      serveCount++;
      if (serveCount >= maxServes) {
        server = server === 'player1' ? 'player2' : 'player1';
        serveCount = 0;
      }
    }
  }

  // 최신 기록이 앞에 오도록 역순 정렬
  return history.reverse();
}

// 랜덤 세트 점수 생성
function simulateSet(winScore: number, minLead: number): SetScore {
  const winner = Math.random() < 0.5 ? 1 : 2;
  const loserScore = Math.floor(Math.random() * winScore);
  const winnerScore = Math.max(winScore, loserScore + minLead);

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
function simulateMatch(
  setsToWin: number,
  winScore: number,
  minLead: number,
  p1Id: string,
  p2Id: string,
): {
  sets: SetScore[];
  winner: 1 | 2;
} {
  const sets: SetScore[] = [];
  let p1Wins = 0;
  let p2Wins = 0;

  while (p1Wins < setsToWin && p2Wins < setsToWin) {
    const set = simulateSet(winScore, minLead);
    const setWinner = set.player1Score > set.player2Score ? 1 : 2;
    // winnerId를 실제 승자 ID로 설정
    set.winnerId = setWinner === 1 ? p1Id : p2Id;
    if (setWinner === 1) p1Wins++;
    else p2Wins++;
    sets.push(set);
  }

  return { sets, winner: p1Wins >= setsToWin ? 1 : 2 };
}

// ===== 메인 시뮬레이션 함수 =====
export interface SimulationResult {
  players: { id: string; name: string }[];
  teams?: { id: string; name: string; memberIds: string[]; memberNames: string[] }[];
  matches: Omit<Match, 'id'>[];
  referees: { id: string; name: string; assignedMatchIds: string[] }[];
  schedule: Omit<ScheduleSlot, 'id'>[];
}

export function simulateTournament(tournament: Tournament, participantCount: number): SimulationResult {
  const isTeam = tournament.type === 'team' || tournament.type === 'randomTeamLeague';

  // 대회 설정에서 스코어링 규칙 읽기 (scoringRules > gameConfig > teamMatchSettings > 기본값)
  const scoringRules = tournament.scoringRules || (tournament.gameConfig
    ? {
        winScore: tournament.gameConfig.winScore,
        setsToWin: tournament.gameConfig.setsToWin,
        maxSets: (tournament.gameConfig.setsToWin * 2 - 1),
        minLead: 2,
        deuceEnabled: true,
      }
    : {
        winScore: isTeam ? 31 : 11,
        setsToWin: isTeam ? 1 : 2,
        maxSets: isTeam ? 1 : 3,
        minLead: 2,
        deuceEnabled: true,
      });
  const winScore = scoringRules.winScore || (isTeam ? (tournament.teamMatchSettings?.winScore || 31) : 11);
  const setsToWin = scoringRules.setsToWin || (isTeam ? (tournament.teamMatchSettings?.setsToWin || 1) : 2);
  const minLead = scoringRules.minLead || tournament.teamMatchSettings?.minLead || 2;
  const matchType: 'individual' | 'team' = isTeam ? 'team' : 'individual';

  // stageId 결정
  const qualifyingStageId = tournament.stages?.find(s => s.type === 'qualifying')?.id || 'qualifying';

  // 1. 참가자 생성
  const players = Array.from({ length: participantCount }, (_, i) => ({
    id: `sim_player_${i}`,
    name: generateName(i),
  }));

  // 2. 팀 생성 (팀전 시)
  let teams: SimulationResult['teams'];
  if (isTeam) {
    const teamSize = tournament.teamRules?.teamSize || 3;
    const teamCount = Math.floor(participantCount / teamSize);
    teams = Array.from({ length: teamCount }, (_, i) => ({
      id: `sim_team_${i}`,
      name: `${i + 1}팀`,
      memberIds: players.slice(i * teamSize, (i + 1) * teamSize).map(p => p.id),
      memberNames: players.slice(i * teamSize, (i + 1) * teamSize).map(p => p.name),
    }));
  }

  // 3. 심판 생성 (3명)
  const referees = [
    { id: 'sim_ref_1', name: '심판 A', assignedMatchIds: [] as string[] },
    { id: 'sim_ref_2', name: '심판 B', assignedMatchIds: [] as string[] },
    { id: 'sim_ref_3', name: '심판 C', assignedMatchIds: [] as string[] },
  ];

  // 4. 코트 생성 (2개)
  const courts = [
    { id: 'sim_court_1', name: '1코트' },
    { id: 'sim_court_2', name: '2코트' },
  ];

  // 5. 조별 편성 (대회 설정의 groupCount 사용)
  const participants = isTeam ? teams! : players;
  const configGroupCount = tournament.qualifyingConfig?.groupCount
    || tournament.stages?.find(s => s.type === 'qualifying')?.groupCount
    || undefined;
  const hasGroupStage = configGroupCount ? configGroupCount > 1 : participants.length >= 4;
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

  // 6. 라운드로빈 대진 + 결과 (조별)
  const matches: Omit<Match, 'id'>[] = [];
  const schedule: Omit<ScheduleSlot, 'id'>[] = [];
  let matchCounter = 0;
  const scheduleBaseTime = new Date();
  scheduleBaseTime.setHours(9, 0, 0, 0); // 오전 9시 시작

  for (const group of groups) {
    for (let i = 0; i < group.members.length; i++) {
      for (let j = i + 1; j < group.members.length; j++) {
        const p1 = group.members[i];
        const p2 = group.members[j];
        const p1Id = p1.id;
        const p2Id = p2.id;

        const result = simulateMatch(setsToWin, winScore, minLead, p1Id, p2Id);
        const refIndex = matchCounter % referees.length;
        const courtIndex = matchCounter % courts.length;
        const matchId = `sim_match_${matchCounter}`;

        // 심판 배정
        referees[refIndex].assignedMatchIds.push(matchId);

        // 이름 결정
        const p1Name = isTeam
          ? (p1 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).name
          : (p1 as { id: string; name: string }).name;
        const p2Name = isTeam
          ? (p2 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).name
          : (p2 as { id: string; name: string }).name;

        // scoreHistory 생성
        const scoreHistory = simulateScoreHistory(
          p1Name, p2Name, p1Id, p2Id,
          result.sets, matchType,
        );

        // 스케줄 시간 계산 (20분 간격)
        const scheduledTime = new Date(scheduleBaseTime.getTime() + matchCounter * 20 * 60 * 1000);
        const timeStr = scheduledTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

        const match: Omit<Match, 'id'> = {
          tournamentId: tournament.id,
          type: matchType,
          status: 'completed',
          round: Math.floor(matchCounter / Math.max(1, Math.floor(group.members.length / 2))) + 1,
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
          groupId: hasGroupStage ? group.id : undefined,
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
          label,
          status: 'completed',
        });

        matchCounter++;
      }
    }
  }

  return { players, teams, matches, referees, schedule };
}
