// 대회 유형
export type TournamentType = 'group' | 'group-tournament' | 'tournament' | 'knockout-only' | 'group-only' | 'full-league' | 'random-team-league';

// 팀전 점수 설정
export interface TeamMatchSettings {
  setsToWin: 1;
  winScore: 11 | 21 | 31;
  minLead: 2;
}

// 심판
export interface Referee {
  id: string;
  name: string;
  role: 'main' | 'assistant';
  createdAt: number;
}

// 경기장
export interface Court {
  id: string;
  name: string;
  location?: string;
  assignedReferees: string[]; // 1-2명 심판 ID
  createdAt: number;
}

// 선수
export interface Player {
  id: string;
  name: string;
  club?: string;
  class?: string; // B1, B2, B3
  createdAt: number;
}

// 대회
export interface Tournament {
  id: string;
  name: string;
  date: string;
  status: 'draft' | 'in_progress' | 'completed';
  playerIds: string[];
  createdAt: number;
  // 확장 필드
  type?: TournamentType;
  teamMatchSettings?: TeamMatchSettings;
}

// 랜덤 팀 리그전
export interface RandomTeamLeague {
  id: string;
  name: string;
  date: string;
  status: 'draft' | 'team_assignment' | 'in_progress' | 'completed';
  playerIds: string[];
  teams?: Team[];
  fixtures?: TeamMatch[];
  teamMatchSettings: TeamMatchSettings;
  createdAt: number;
}

// 팀
export interface Team {
  id: string;
  name: string;
  memberIds: string[]; // 3명
}

// 팀 경기
export interface TeamMatch {
  id: string;
  leagueId: string;
  team1Id: string;
  team2Id: string;
  round: number;
  status: 'pending' | 'in_progress' | 'completed';
  winnerId?: string;
  courtId?: string;
  scheduledTime?: string;
  matches: IndividualMatch[]; // 9경기 (3x3)
  scoreHistory?: ScoreEvent[];
}

// 개인 경기 (팀전 내)
export interface IndividualMatch {
  id: string;
  player1Id: string;
  player2Id: string;
  player1Score: number;
  player2Score: number;
  winnerId?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// 점수 이벤트 (히스토리)
export interface ScoreEvent {
  id: string;
  timestamp: number;
  matchIndex: number; // 몇 번째 개인경기
  playerId: string;
  player1Score: number;
  player2Score: number;
  description?: string;
}

// 세트 점수
export interface SetScore {
  player1Score: number;
  player2Score: number;
  player1Faults: number;
  player2Faults: number;
  player1Violations: number;
  player2Violations: number;
  winnerId?: string | null;
}

// 경기 이벤트 (실시간 연동용)
export interface MatchEvent {
  id: string;
  type: 'score' | 'fault' | 'violation' | 'timeout_start' | 'timeout_end' | 'set_end' | 'match_end';
  playerId: string | null;
  timestamp: number;
  description?: string;
  data?: {
    player1Score?: number;
    player2Score?: number;
    setNumber?: number;
  };
}

// 경기
export interface Match {
  id: string;
  tournamentId: string;
  round: number;
  position: number;
  player1Id: string | null;
  player2Id: string | null;
  winnerId: string | null;
  sets: SetScore[];
  currentSet: number;
  status: 'pending' | 'in_progress' | 'completed';
  tableNumber?: number;
  startTime?: number;
  endTime?: number;
  // 실시간 이벤트
  lastEvent?: MatchEvent;
  // 타임아웃
  player1Timeouts: number;
  player2Timeouts: number;
  activeTimeout?: {
    playerId: string;
    startTime: number;
  } | null;
}

// 토너먼트 브라켓
export interface Bracket {
  tournamentId: string;
  rounds: number;
  matches: Match[];
}

// 게임 설정
export const GAME_CONFIG = {
  SETS_TO_WIN: 2,
  MAX_SETS: 3,
  POINTS_TO_WIN: 11,
  MIN_POINT_DIFF: 2,
} as const;

// 점수 계산 유틸리티
export function checkSetWinner(
  player1Score: number,
  player2Score: number
): 1 | 2 | null {
  const { POINTS_TO_WIN, MIN_POINT_DIFF } = GAME_CONFIG;

  if (player1Score >= POINTS_TO_WIN && player1Score - player2Score >= MIN_POINT_DIFF) {
    return 1;
  }
  if (player2Score >= POINTS_TO_WIN && player2Score - player1Score >= MIN_POINT_DIFF) {
    return 2;
  }
  return null;
}

export function checkMatchWinner(sets: SetScore[]): 1 | 2 | null {
  let player1Wins = 0;
  let player2Wins = 0;

  for (const set of sets) {
    const winner = checkSetWinner(set.player1Score, set.player2Score);
    if (winner === 1) player1Wins++;
    if (winner === 2) player2Wins++;
  }

  if (player1Wins >= GAME_CONFIG.SETS_TO_WIN) return 1;
  if (player2Wins >= GAME_CONFIG.SETS_TO_WIN) return 2;
  return null;
}

export function createEmptySet(): SetScore {
  return {
    player1Score: 0,
    player2Score: 0,
    player1Faults: 0,
    player2Faults: 0,
    player1Violations: 0,
    player2Violations: 0,
    winnerId: null,
  };
}
