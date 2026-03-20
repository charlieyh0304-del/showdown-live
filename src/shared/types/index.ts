// ===== 대회 유형 =====
export type TournamentType = 'individual' | 'team' | 'randomTeamLeague';
export type TournamentFormat = 'full_league' | 'tournament' | 'group_league';
export type TournamentStatus = 'draft' | 'registration' | 'in_progress' | 'paused' | 'completed';
export type MatchStatus = 'pending' | 'in_progress' | 'completed';
export type MatchType = 'individual' | 'team';

// ===== 확장 대회 포맷 =====
export type BracketFormatType =
  | 'round_robin'
  | 'single_elimination'
  | 'double_elimination'
  | 'swiss'
  | 'group_knockout';

// ===== 커스텀 스코어링 규칙 =====
export interface ScoringRules {
  winScore: number;
  setsToWin: number;
  maxSets: number;
  minLead: number;
  deuceEnabled: boolean;
  deuceCap?: number;
  maxScore?: number;
}

// ===== 경기 규칙 =====
export interface MatchRules {
  timeoutsPerPlayer: number;
  timeoutDurationSeconds: number;
  maxFaultsPerSet?: number;
  faultPenaltyType?: 'warning' | 'point';
}

// ===== 팀 규칙 =====
export interface TeamRules {
  teamSize: number;
  rotationEnabled: boolean;
  rotationInterval?: number;
  maxReserves?: number;
  genderRatio?: { male: number; female: number };
}

// ===== 브라켓 라운드 =====
export type BracketRound = '128강' | '64강' | '32강' | '16강' | '8강' | '4강' | '결승';
export type BracketSeedingMethod = 'group_cross' | 'seed_order' | 'random';

// ===== 스테이지 유형 =====
export type StageType = 'qualifying' | 'finals' | 'ranking_match';

// ===== 대회 스테이지 =====
export interface TournamentStage {
  id: string;
  name: string;
  order: number;
  type?: StageType;
  format: BracketFormatType;
  scoringRules?: ScoringRules;
  matchRules?: MatchRules;
  groupCount?: number;
  advanceCount?: number;
  groups?: StageGroup[];
  groupConfig?: GroupConfig;
  bracketConfig?: BracketConfig;
  advanceConfig?: StageAdvanceConfig;
  rankingMatchConfig?: RankingMatchConfig;
  seeds?: SeedEntry[];
  advancedParticipantIds?: string[];
  status: 'pending' | 'in_progress' | 'completed';
}

// ===== 예선 스테이지 설정 =====
export interface QualifyingStageConfig {
  format: 'round_robin' | 'group_round_robin';
  groupCount: number;
  scoringRules?: ScoringRules;
  matchRules?: MatchRules;
}

// ===== 본선 스테이지 설정 =====
export interface FinalsStageConfig {
  format: 'single_elimination' | 'double_elimination';
  advanceCount: number;
  startingRound: number;
  seedMethod: 'ranking' | 'manual' | 'random';
  scoringRules?: ScoringRules;
  matchRules?: MatchRules;
}

// ===== 순위결정전 설정 =====
export interface RankingMatchConfig {
  enabled: boolean;
  thirdPlace: boolean;                    // 3/4위 결정전
  fifthToEighth: boolean;                 // 5~8위 결정전
  fifthToEighthFormat: 'simple' | 'full' | 'round_robin';
  // simple: 2경기 (5vs8, 6vs7만)
  // full: 4경기 (교차전 → 순위전)
  // round_robin: 4명 풀리그 6경기
  classificationGroups: boolean;          // 하위 순위 그룹 결정전 (IBSA 방식)
  classificationGroupSize: number;        // 그룹 크기 (기본 4)
  scoringRules?: ScoringRules;
}

// ===== 조 =====
export interface StageGroup {
  id: string;
  stageId: string;
  name: string;
  playerIds: string[];
  teamIds: string[];
  seedOrder?: string[];
}

// ===== 시드 항목 =====
export interface SeedEntry {
  position: number;
  playerId?: string;
  teamId?: string;
  name: string;
}

// ===== 조 편성 설정 =====
export interface GroupConfig {
  groupCount: number;
  playersPerGroup?: number;
  advanceCount: number;
  seedingEnabled: boolean;
}

// ===== 브라켓 설정 =====
export interface BracketConfig {
  format: 'single_elimination' | 'double_elimination';
  startingRound?: BracketRound;
  seedingMethod: BracketSeedingMethod;
  hasThirdPlaceMatch?: boolean;
  hasFifthPlaceMatch?: boolean;
}

// ===== 스테이지 진출 설정 =====
export interface StageAdvanceConfig {
  advanceCount: number;
  advanceMethod: 'ranking' | 'manual';
  advancePerGroup?: number;
}

// ===== 대회 템플릿 =====
export interface TournamentTemplate {
  id: string;
  name: string;
  description?: string;
  type: TournamentType;
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules?: TeamRules;
  formatType: BracketFormatType;
  stages?: Omit<TournamentStage, 'id' | 'status'>[];
  createdAt: number;
  updatedAt: number;
}

// ===== 대회 =====
export interface Tournament {
  id: string;
  name: string;
  date: string;
  endDate?: string;
  type: TournamentType;
  format: TournamentFormat;
  status: TournamentStatus;
  gameConfig: GameConfig;
  teamMatchSettings?: TeamMatchSettings;
  // 확장 필드 (커스텀 대회 설정)
  formatType?: BracketFormatType;
  scoringRules?: ScoringRules;
  matchRules?: MatchRules;
  teamRules?: TeamRules;
  stages?: TournamentStage[];
  currentStageId?: string;
  templateId?: string;
  qualifyingConfig?: QualifyingStageConfig;
  finalsConfig?: FinalsStageConfig;
  rankingMatchConfig?: RankingMatchConfig;
  seeds?: SeedEntry[];
  createdAt: number;
  updatedAt: number;
}

// ===== 게임 설정 =====
export interface GameConfig {
  winScore: number;
  setsToWin: number;
}

export interface TeamMatchSettings {
  setsToWin: number;
  winScore: number;
  minLead: number;
}

// ===== 선수 =====
export interface Player {
  id: string;
  name: string;
  club?: string;
  class?: string; // B1, B2, B3
  gender?: 'male' | 'female' | '';
  createdAt: number;
}

// ===== 심판 =====
export interface Referee {
  id: string;
  name: string;
  role: 'main' | 'assistant';
  pin?: string; // SHA-256 해시
  assignedMatchIds?: string[];
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

// ===== IBSA 득점 액션 타입 =====
export type ScoreActionType =
  | 'goal'              // 골 (+2점, 득점한 선수에게)
  | 'irregular_serve'   // 부정 서브 (+1점, 상대에게)
  | 'centerboard'       // 센터보드 (+1점, 상대에게)
  | 'body_touch'        // 바디터치 (+1점, 상대에게)
  | 'illegal_defense'   // 일리걸 디펜스 (+1점, 상대에게)
  | 'out'               // 아웃 (+1점, 상대에게)
  | 'ball_holding'      // 볼홀딩/2초룰 (+1점, 상대에게)
  | 'mask_touch'        // 마스크/고글 터치 (+2점, 상대에게)
  | 'penalty'           // 기타 벌점 (+2점, 상대에게)
  | 'manual'            // 수동 득점/감점
  | 'timeout'           // 타임아웃
  | 'pause'             // 일시정지
  | 'resume'            // 재개
  | 'substitution'      // 선수 교체
  | 'correction'        // 점수 수정 (관리자)
  | 'walkover';         // 부전승

export interface ScoreAction {
  type: ScoreActionType;
  points: number;         // 부여되는 점수
  toOpponent: boolean;    // true면 상대에게 점수 부여 (파울/아웃)
  label: string;          // UI 표시 라벨
}

export const IBSA_SCORE_ACTIONS: ScoreAction[] = [
  { type: 'goal', points: 2, toOpponent: false, label: '골 +2' },
  { type: 'irregular_serve', points: 1, toOpponent: true, label: '부정서브' },
  { type: 'centerboard', points: 1, toOpponent: true, label: '센터보드' },
  { type: 'body_touch', points: 1, toOpponent: true, label: '바디터치' },
  { type: 'illegal_defense', points: 1, toOpponent: true, label: '일리걸디펜스' },
  { type: 'out', points: 1, toOpponent: true, label: '아웃' },
  { type: 'ball_holding', points: 1, toOpponent: true, label: '볼홀딩(2초)' },
  { type: 'mask_touch', points: 2, toOpponent: true, label: '마스크터치 +2' },
  { type: 'penalty', points: 2, toOpponent: true, label: '벌점(기타) +2' },
];

// ===== 득점 히스토리 항목 =====
export interface ScoreHistoryEntry {
  time: string;
  scoringPlayer: string;     // 점수를 받는 선수/팀 이름
  actionPlayer: string;      // 액션한 선수 이름 (파울한 선수 등)
  actionType: ScoreActionType;
  actionLabel: string;
  points: number;
  set: number;
  server: string;            // 서브권 가진 선수 이름
  serveNumber: number;       // 몇 번째 서브
  scoreBefore: { player1: number; player2: number };
  scoreAfter: { player1: number; player2: number };
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
  scheduledDate?: string;
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
  // 서브 추적 (IBSA 규칙)
  currentServe?: 'player1' | 'player2';  // 현재 서브권
  serveCount?: number;                     // 현재 서브 카운트 (0부터)
  serveSelected?: boolean;                 // 서브 선택 완료 여부
  // 사이드 체인지
  sideChangeUsed?: boolean;                // 현재 세트 사이드체인지 사용 여부
  // 득점 히스토리
  scoreHistory?: ScoreHistoryEntry[];
  // 일시정지
  isPaused?: boolean;
  pauseReason?: string;
  pauseStartTime?: number;
  // 일시정지 이력
  pauseHistory?: { time: string; reason: string; set: number; duration?: number }[];
  // 워밍업
  warmupUsed?: boolean;
  // 선수 교체 사용 여부
  team1SubUsed?: boolean;
  team2SubUsed?: boolean;
  // 현재 출전 선수 (교체 반영)
  team1ActivePlayerIds?: string[];
  team1ActivePlayerNames?: string[];
  team2ActivePlayerIds?: string[];
  team2ActivePlayerNames?: string[];
  // 팀전 필드
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
  team1?: Team;
  team2?: Team;
  // @deprecated - 이전 NxN 방식 호환용. 새 팀전은 sets[] 사용
  individualMatches?: IndividualMatch[];
  // 확장 필드 (커스텀 대회)
  stageId?: string;
  groupId?: string;
  bracketPosition?: number;
  bracketRound?: BracketRound;
  roundLabel?: string;
  player1Seed?: number;
  player2Seed?: number;
  bye?: boolean;
  walkover?: boolean;
  walkoverReason?: string;
  sourceMatch1Id?: string;
  sourceMatch2Id?: string;
  appliedScoringRules?: ScoringRules;
  createdAt: number;
  updatedAt?: number;
}

// ===== 팀 =====
export interface Team {
  id: string;
  name: string;
  memberIds: string[];
  memberNames?: string[];
  maxReserves?: number;
  genderRatio?: { male: number; female: number };
}

// ===== 팀전 내 개별 경기 (레거시 호환용) =====
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
  scheduledDate?: string;
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
  pointsFor: number;
  pointsAgainst: number;
  rank: number;
}

// ===== 앱 설정 =====
export interface AppConfig {
  adminPin: string; // SHA-256 해시 (레거시, 단일 관리자용)
}

// ===== 관리자 =====
export interface Admin {
  id: string;
  name: string;
  pin: string; // SHA-256 해시
  createdAt: number;
}

// ===== 인증 세션 =====
export interface AuthSession {
  mode: 'admin' | 'referee';
  adminId?: string;
  adminName?: string;
  refereeId?: string;
  refereeName?: string;
  tournamentId?: string;
  authenticatedAt: number;
}

// ===== 심판 연습 모드 =====
export interface PracticeMatch {
  id: string;
  type: MatchType;
  player1Name: string;
  player2Name: string;
  sets: SetScore[];
  currentSet: number;
  status: MatchStatus;
  winnerId: string | null;
  player1Timeouts: number;
  player2Timeouts: number;
  activeTimeout: { playerId: string; startTime: number } | null;
  gameConfig: {
    SETS_TO_WIN: number;
    MAX_SETS: number;
    POINTS_TO_WIN: number;
    MIN_POINT_DIFF: number;
  };
  // 서브 추적
  currentServe: 'player1' | 'player2';
  serveCount: number;
  serveSelected: boolean;
  // 사이드 체인지
  sideChangeUsed: boolean;
  // 득점 히스토리
  scoreHistory: ScoreHistoryEntry[];
  // 일시정지
  isPaused: boolean;
  // 워밍업
  warmupUsed: boolean;
  pauseHistory: { time: string; reason: string; set: number; duration?: number }[];
  actionLog: PracticeAction[];
  startedAt: number;
  completedAt?: number;
}

export interface PracticeAction {
  timestamp: number;
  type: 'score' | 'fault' | 'violation' | 'timeout' | 'timeout_end' | 'start';
  player: 1 | 2;
  detail?: string;
}

// ===== 연습 세션 =====
export type PracticeSessionType = 'free' | 'scenario' | 'tutorial';

export interface PracticeSession {
  id: string;
  date: number;
  matchType: MatchType;
  sessionType: PracticeSessionType;
  scenarioId?: string;
  scenarioName?: string;
  duration: number;
  accuracy?: number;
  totalActions: number;
  correctActions?: number;
  finalScore: string;
}

// ===== 위자드용 프리셋 (확장) =====
export interface WizardPreset {
  id: string;
  name: string;
  description: string;
  type: TournamentType;
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules?: TeamRules;
  formatType: BracketFormatType;
  hasQualifying?: boolean;
  qualifyingConfig?: Partial<QualifyingStageConfig>;
  hasFinalsStage?: boolean;
  finalsConfig?: Partial<FinalsStageConfig>;
  rankingMatch?: Partial<RankingMatchConfig>;
}

// ===== 타이브레이커 =====
export type TiebreakerRule =
  | 'head_to_head'
  | 'set_difference'
  | 'point_difference'
  | 'points_for';
