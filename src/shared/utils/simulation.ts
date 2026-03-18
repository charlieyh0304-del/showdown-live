import type { Tournament, Match, SetScore, Team } from '../types';

// 가상 이름 생성용
const LAST_NAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황'];
const FIRST_NAMES = ['민준', '서연', '도윤', '지우', '서준', '하은', '예준', '지민', '시우', '수아', '주원', '유진', '지호', '채원', '현우', '소율'];

// 랜덤 이름 생성
function generateName(index: number): string {
  return LAST_NAMES[index % LAST_NAMES.length] + FIRST_NAMES[index % FIRST_NAMES.length];
}

// 랜덤 세트 점수 생성
function simulateSet(winScore: number, minLead: number): SetScore {
  // 승자를 랜덤으로 결정
  const winner = Math.random() < 0.5 ? 1 : 2;
  // 패자 점수: 0 ~ winScore-1 랜덤
  const loserScore = Math.floor(Math.random() * winScore);
  // 승자 점수: max(winScore, loserScore + minLead)
  const winnerScore = Math.max(winScore, loserScore + minLead);

  return {
    player1Score: winner === 1 ? winnerScore : loserScore,
    player2Score: winner === 2 ? winnerScore : loserScore,
    player1Faults: Math.floor(Math.random() * 3),
    player2Faults: Math.floor(Math.random() * 3),
    player1Violations: 0,
    player2Violations: 0,
    winnerId: null,
  };
}

// 경기 결과 시뮬레이션 (Best of N 세트)
function simulateMatch(setsToWin: number, winScore: number, minLead: number): {
  sets: SetScore[];
  winner: 1 | 2;
} {
  const sets: SetScore[] = [];
  let p1Wins = 0, p2Wins = 0;

  while (p1Wins < setsToWin && p2Wins < setsToWin) {
    const set = simulateSet(winScore, minLead);
    if (set.player1Score > set.player2Score) p1Wins++;
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
}

export function simulateTournament(tournament: Tournament, participantCount: number): SimulationResult {
  const isTeam = tournament.type === 'team' || tournament.type === 'randomTeamLeague';
  const winScore = tournament.scoringRules?.winScore || tournament.gameConfig?.winScore || (isTeam ? 31 : 11);
  const setsToWin = tournament.scoringRules?.setsToWin || tournament.gameConfig?.setsToWin || (isTeam ? 1 : 2);
  const minLead = tournament.scoringRules?.minLead || 2;

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

  // 4. 라운드로빈 대진 + 결과
  const matches: Omit<Match, 'id'>[] = [];
  const participants = isTeam ? teams! : players;

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const result = simulateMatch(setsToWin, winScore, minLead);
      const refIndex = matches.length % referees.length;

      const p1 = participants[i];
      const p2 = participants[j];

      const match: Omit<Match, 'id'> = {
        tournamentId: tournament.id,
        type: isTeam ? 'team' : 'individual',
        status: 'completed',
        round: Math.floor(matches.length / Math.floor(participants.length / 2)) + 1,
        sets: result.sets,
        currentSet: result.sets.length - 1,
        player1Timeouts: 0,
        player2Timeouts: 0,
        activeTimeout: null,
        currentServe: 'player1',
        serveCount: 0,
        serveSelected: true,
        sideChangeUsed: true,
        scoreHistory: [],
        winnerId: result.winner === 1 ? p1.id : p2.id,
        refereeId: referees[refIndex].id,
        refereeName: referees[refIndex].name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(isTeam ? {
          team1Id: (p1 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).id,
          team2Id: (p2 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).id,
          team1Name: (p1 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).name,
          team2Name: (p2 as { id: string; name: string; memberIds: string[]; memberNames: string[] }).name,
          team1: p1 as Team,
          team2: p2 as Team,
        } : {
          player1Id: p1.id,
          player2Id: p2.id,
          player1Name: (p1 as { id: string; name: string }).name,
          player2Name: (p2 as { id: string; name: string }).name,
        }),
      };

      matches.push(match);
    }
  }

  return { players, teams, matches, referees };
}
