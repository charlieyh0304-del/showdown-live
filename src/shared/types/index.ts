// ===== 대회 유형 =====
export type TournamentType = 'individual' | 'team' | 'randomTeamLeague';
export type TournamentFormat = 'full_league' | 'tournament' | 'group_league';
export type TournamentStatus = 'draft' | 'registration' | 'in_progress' | 'paused' | 'completed';
export type MatchStatus = 'pending' | 'in_progress' | 'completed';
export type MatchType = 'individual' | 'team';

// ===== 대회 =====
export interface Tournament {
  id: string;
  name: string;
  date: string;
  type: TournamentType;
  format: TournamentFormat;
  status: TournamentStatus;
  gameConfig: GameConfig;
  teamMatchSettings?: TeamMatchSettings;
  createdAt: number;
  updatedAt: number;
}

// ===== 게임 설정 =====
export interface GameConfig {
  winScore: 11 | 21 | 31;
  setsToWin: number;
}

export interface TeamMatchSettings {
  setsToWin: 1 | 2 | 3;
  winScore: 11 | 21 | 31;
  minLead: 2;
}

// ===== 선수 =====
export interface Player {
  id: string;
  name: string;
  club?: string;
  class?: string; // B1, B2, B3
  createdAt: number;
}

// ===== 심판 =====
export interface Referee {
  id: string;
  name: string;
  role: 'main' | 'assistant';
  pin?: string; // SHA-256 해시
  createdAt: number;
}

// ===== 경기장 =====
export interface Court {
  id: string;
  name: string;
  location?: string;
  assignedReferees: string[];
  createdAt: number;
}

// ===== 세트 점수 =====
export interface SetScore {
  player1Score: number;
  player2Score: number;
  player1Faults: number;
  player2Faults: number;
  player1Violations: number;
  player2Violations: number;
  winnerId?: string | null;
}

// ===== 경기 (개인전/팀전 통합) =====
export interface Match {
  id: string;
  tournamentId: string;
  type: MatchType;
  status: MatchStatus;
  round: number;
  courtId?: string;
  refereeId?: string;
  scheduledTime?: string;
  // 비정규화 필드 (관람 모드 경량 구독용)
  courtName?: string;
  refereeName?: string;
  // 개인전 필드
  player1Id?: string;
  player2Id?: string;
  player1Name?: string;
  player2Name?: string;
  winnerId?: string | null;
  sets?: SetScore[];
  currentSet?: number;
  player1Timeouts?: number;
  player2Timeouts?: number;
  activeTimeout?: { playerId: string; startTime: number } | null;
  // 팀전 필드
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
  team1?: Team;
  team2?: Team;
  individualMatches?: IndividualMatch[];
  createdAt: number;
  updatedAt?: number;
}

// ===== 팀 =====
export interface Team {
  id: string;
  name: string;
  memberIds: string[];
  memberNames?: string[];
}

// ===== 팀전 내 개별 경기 =====
export interface IndividualMatch {
  id: string;
  player1Id: string;
  player2Id: string;
  player1Name?: string;
  player2Name?: string;
  player1Score: number;
  player2Score: number;
  winnerId?: string;
  status: MatchStatus;
}

// ===== 스케줄 =====
export interface ScheduleSlot {
  id: string;
  matchId: string;
  courtId: string;
  courtName?: string;
  scheduledTime: string;
  label: string; // "홍길동 vs 김철수" 또는 "1팀 vs 2팀"
  status: MatchStatus;
}

// ===== 심판 권한 =====
export interface RefereeAssignment {
  refereeId: string;
  refereeName: string;
  matchIds: string[];
}

// ===== 즐겨찾기 =====
export interface FavoritePlayer {
  playerId: string;
  playerName: string;
}

// ===== 알림 =====
export interface Notification {
  id: string;
  type: 'match_start' | 'match_end' | 'score_update';
  tournamentId: string;
  matchId: string;
  playerIds: string[];
  message: string;
  courtName?: string;
  timestamp: number;
}

// ===== 순위 =====
export interface PlayerRanking {
  playerId: string;
  playerName: string;
  played: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
  rank: number;
}

export interface TeamRanking {
  teamId: string;
  teamName: string;
  played: number;
  wins: number;
  losses: number;
  individualWins: number;
  individualLosses: number;
  rank: number;
}

// ===== 앱 설정 =====
export interface AppConfig {
  adminPin: string; // SHA-256 해시
}

// ===== 인증 세션 =====
export interface AuthSession {
  mode: 'admin' | 'referee';
  refereeId?: string;
  refereeName?: string;
  tournamentId?: string;
  authenticatedAt: number;
}
