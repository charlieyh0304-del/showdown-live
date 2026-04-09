/**
 * 공유 타입 정의 — chatbot-tools.ts 및 모든 모듈에서 사용
 * Firebase 데이터 구조와 일치하는 typed interfaces
 */

// ===== Match =====
export interface MatchSet {
  player1Score: number;
  player2Score: number;
  winnerId?: string | null;
}

export interface ScoreHistoryEntry {
  time: string;
  set: number;
  scoringPlayer?: string;
  actionPlayer?: string;
  actionType: string;
  actionLabel?: string;
  points: number;
  server?: string;
  serveNumber?: number;
  scoreBefore?: { player1: number; player2: number };
  scoreAfter?: { player1: number; player2: number };
  serverSide?: string;
  serverName?: string;
  receiverName?: string;
}

export interface MatchData {
  id?: string;
  tournamentId: string;
  type: "individual" | "team";
  status: "pending" | "in_progress" | "completed" | "cancelled";

  // 개인전 필드
  player1Id?: string;
  player2Id?: string;
  player1Name?: string;
  player2Name?: string;
  player1Coach?: string;
  player2Coach?: string;

  // 팀전 필드
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
  team1?: { memberIds?: string[]; memberNames?: string[]; coachName?: string };
  team2?: { memberIds?: string[]; memberNames?: string[]; coachName?: string };

  // 경기 데이터
  winnerId?: string | null;
  sets?: MatchSet[];
  currentSet?: number;
  scoreHistory?: ScoreHistoryEntry[];

  // 코인토스
  coinTossWinner?: string;
  coinTossChoice?: string;

  // 브라켓/스테이지
  stageId?: string;
  roundLabel?: string;
  bracketRound?: string;
  bracketPosition?: number;
  groupId?: string;
  round?: number;
  isBye?: boolean;

  // 진출 추적 (sourceMatch)
  sourceMatch1?: string;
  sourceMatch2?: string;
  sourceType?: "winner" | "loser";

  // 스케줄링
  scheduledDate?: string;
  scheduledTime?: string;
  courtId?: string;
  courtName?: string;
  refereeId?: string;
  refereeName?: string;

  // 타임아웃
  player1Timeouts?: number;
  player2Timeouts?: number;
  activeTimeout?: string | null;

  // 서브
  currentServe?: string;
  serveCount?: number;
  serveSelected?: boolean;
  sideChangeUsed?: boolean;

  createdAt?: number;
  updatedAt?: number;
}

// ===== Tournament =====
export interface ScoringRules {
  winScore: number;
  setsToWin: number;
  maxSets?: number;
  minLead?: number;
  deuceEnabled?: boolean;
}

export interface FinalsConfig {
  format?: string;
  advanceCount?: number;
  startingRound?: number;
  seedMethod?: string;
  advancePerGroup?: number;
  wildcardCount?: number;
  avoidSameGroup?: boolean;
  bracketArrangement?: string;
  scoringRules?: ScoringRules;
  roundScoringOverride?: {
    fromRound?: number;
    scoringRules?: ScoringRules;
  };
  customBracketPairings?: Array<{ position: number; slot1: string; slot2: string }>;
}

export interface RankingMatchConfig {
  enabled?: boolean;
  thirdPlace?: boolean;
  fifthToEighth?: boolean;
  fifthToEighthFormat?: "simple" | "full" | "round_robin";
  classificationGroups?: boolean;
  classificationGroupSize?: number;
  rankingUpTo?: number;
  rankingSetsToWin?: number;
  rankingWinScore?: number;
}

export interface QualifyingConfig {
  format?: "round_robin" | "group_round_robin";
  groupCount?: number;
  scoringRules?: ScoringRules;
}

export interface TournamentStage {
  id: string;
  type: "qualifying" | "finals" | "ranking_match";
  format?: string;
  status?: string;
  groupCount?: number;
  groups?: Array<{ id: string; stageId: string; name: string; playerIds: string[]; teamIds: string[] }>;
  advanceCount?: number;
  rankingMatchConfig?: RankingMatchConfig;
}

export interface TournamentData {
  id?: string;
  name: string;
  date: string;
  endDate?: string;
  scheduleDates?: string[];
  status: "draft" | "registration" | "in_progress" | "paused" | "completed";
  type: "individual" | "team" | "randomTeamLeague";
  format?: string;
  formatType?: string;

  gameConfig?: { winScore: number; setsToWin: number };
  scoringRules?: ScoringRules;
  matchRules?: { timeoutsPerPlayer?: number; timeoutDurationSeconds?: number };

  qualifyingConfig?: QualifyingConfig;
  finalsConfig?: FinalsConfig;
  rankingMatchConfig?: RankingMatchConfig;

  stages?: TournamentStage[];
  seeds?: Array<{ position: number; playerId: string; name: string }>;
  tiebreakerRules?: string[];

  // 팀 전용
  teamMatchSettings?: { winScore?: number; setsToWin?: number; minLead?: number };
  teamRules?: {
    teamSize?: number;
    maxReserves?: number;
    rotationEnabled?: boolean;
    rotationInterval?: number;
    genderRatio?: { male?: number; female?: number };
  };

  // 그룹화
  groupId?: string;
  groupName?: string;

  createdAt?: number;
  updatedAt?: number;
}

// ===== Team / Player =====
export interface TeamData {
  id?: string;
  name: string;
  memberIds?: string[];
  memberNames?: string[];
  coachName?: string;
  gender?: string;
  createdAt?: number;
}

export interface PlayerData {
  id?: string;
  name: string;
  club?: string;
  class?: string;
  gender?: string;
  seedRank?: number;
  createdAt?: number;
}

// ===== Result type for typed errors =====
export type ErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DUPLICATE_ENTRY"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: string;
  statusCode: number;
}

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: AppError };

// ===== Helpers =====
export function makeError(code: ErrorCode, message: string, details?: string): AppError {
  const statusMap: Record<ErrorCode, number> = {
    NOT_FOUND: 404,
    VALIDATION_ERROR: 400,
    DUPLICATE_ENTRY: 409,
    UNAUTHORIZED: 401,
    CONFLICT: 409,
    INTERNAL_ERROR: 500,
  };
  return { code, message, details, statusCode: statusMap[code] };
}

/**
 * 안전한 문자열 추출 — 타입 가드
 */
export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * 안전한 숫자 추출 — 타입 가드
 */
export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && !isNaN(value) ? value : fallback;
}

/**
 * 안전한 boolean 추출
 */
export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * MatchData로 안전하게 변환 — 필수 필드 검증
 */
export function toMatchData(obj: unknown): MatchData | null {
  if (!obj || typeof obj !== "object") return null;
  const m = obj as Record<string, unknown>;
  if (typeof m.tournamentId !== "string") return null;
  if (typeof m.type !== "string") return null;
  if (typeof m.status !== "string") return null;
  return m as unknown as MatchData;
}
