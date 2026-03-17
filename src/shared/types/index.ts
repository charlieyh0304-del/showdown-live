// 선수
export interface Player {
  id: string;
  name: string;
  club?: string;
  class?: string; // B1, B2, B3
  createdAt: number;
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
  assignedReferees: string[];
  createdAt: number;
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

// 게임 설정
export interface GameConfig {
  winScore: 11 | 21 | 31;
  setsToWin: number;
}

// 개인전 경기
export interface IndividualGame {
  id: string;
  player1Id: string;
  player2Id: string;
  sets: SetScore[];
  currentSet: number;
  winnerId: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  refereeId?: string;
  courtId?: string;
  gameConfig: GameConfig;
  player1Timeouts: number;
  player2Timeouts: number;
  activeTimeout?: { playerId: string; startTime: number } | null;
  createdAt: number;
}

// 팀
export interface Team {
  id: string;
  name: string;
  memberIds: string[];
}

// 팀전 내 개별 경기
export interface IndividualMatch {
  id: string;
  player1Id: string;
  player2Id: string;
  player1Score: number;
  player2Score: number;
  winnerId?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// 팀전 점수 설정
export interface TeamMatchSettings {
  setsToWin: 1 | 2 | 3;
  winScore: 11 | 21 | 31;
  minLead: 2;
}

// 팀전 경기
export interface TeamMatchGame {
  id: string;
  team1: Team;
  team2: Team;
  matches: IndividualMatch[];
  winnerId?: string;
  status: 'pending' | 'in_progress' | 'completed';
  refereeId?: string;
  courtId?: string;
  teamMatchSettings: TeamMatchSettings;
  createdAt: number;
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

// 팀 경기 (리그전 내)
export interface TeamMatch {
  id: string;
  leagueId: string;
  team1Id: string;
  team2Id: string;
  round: number;
  status: 'pending' | 'in_progress' | 'completed';
  winnerId?: string;
  courtId?: string;
  refereeId?: string;
  scheduledTime?: string;
  matches: IndividualMatch[];
  scoreHistory?: ScoreEvent[];
}

// 점수 이벤트 (히스토리)
export interface ScoreEvent {
  id: string;
  timestamp: number;
  matchIndex: number;
  playerId: string;
  player1Score: number;
  player2Score: number;
  description?: string;
}

// 게임 기본 설정
export const GAME_CONFIG = {
  SETS_TO_WIN: 2,
  MAX_SETS: 3,
  POINTS_TO_WIN: 11,
  MIN_POINT_DIFF: 2,
} as const;

export function getEffectiveGameConfig(gameConfig?: GameConfig) {
  if (!gameConfig) return GAME_CONFIG;
  return {
    SETS_TO_WIN: gameConfig.setsToWin,
    MAX_SETS: gameConfig.setsToWin * 2 - 1,
    POINTS_TO_WIN: gameConfig.winScore,
    MIN_POINT_DIFF: 2,
  };
}

// 세트 승자 판정
export function checkSetWinner(
  player1Score: number,
  player2Score: number,
  config?: ReturnType<typeof getEffectiveGameConfig>
): 1 | 2 | null {
  const { POINTS_TO_WIN, MIN_POINT_DIFF } = config || GAME_CONFIG;
  if (player1Score >= POINTS_TO_WIN && player1Score - player2Score >= MIN_POINT_DIFF) return 1;
  if (player2Score >= POINTS_TO_WIN && player2Score - player1Score >= MIN_POINT_DIFF) return 2;
  return null;
}

// 경기 승자 판정
export function checkMatchWinner(
  sets: SetScore[],
  config?: ReturnType<typeof getEffectiveGameConfig>
): 1 | 2 | null {
  const effectiveConfig = config || GAME_CONFIG;
  let player1Wins = 0;
  let player2Wins = 0;
  for (const set of sets) {
    const winner = checkSetWinner(set.player1Score, set.player2Score, effectiveConfig);
    if (winner === 1) player1Wins++;
    if (winner === 2) player2Wins++;
  }
  if (player1Wins >= effectiveConfig.SETS_TO_WIN) return 1;
  if (player2Wins >= effectiveConfig.SETS_TO_WIN) return 2;
  return null;
}

// 빈 세트 생성
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

// 팀전 승자 판정 (개별 경기 과반수)
export function checkTeamMatchWinner(
  matches: IndividualMatch[],
  team1Id: string,
  team2Id: string,
): string | null {
  const totalMatches = matches.length;
  const winsNeeded = Math.floor(totalMatches / 2) + 1;
  let team1Wins = 0;
  let team2Wins = 0;
  for (const m of matches) {
    if (m.status !== 'completed' || !m.winnerId) continue;
    if (m.winnerId === m.player1Id) team1Wins++;
    else if (m.winnerId === m.player2Id) team2Wins++;
  }
  if (team1Wins >= winsNeeded) return team1Id;
  if (team2Wins >= winsNeeded) return team2Id;
  return null;
}
