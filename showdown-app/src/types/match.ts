import type { TeamMember } from './player'

export type MatchStatus = 'pending' | 'ready' | 'active' | 'completed' | 'waiting'
export type MatchType = 'individual' | 'team'
export type ServePlayer = 'player1' | 'player2' | null

export interface SetScore {
  player1Score: number
  player2Score: number
  isComplete?: boolean
  winner?: 1 | 2
}

export interface ScoreHistory {
  action: 'score' | 'undo' | 'timeout' | 'end_set'
  player: 1 | 2
  set: number
  player1Score: number
  player2Score: number
  server: 1 | 2
  timestamp: number
}

export interface Match {
  // Identity
  id: number
  refereePin: string

  // Participants
  player1Name: string
  player2Name: string
  type: MatchType
  team1Lineup?: TeamMember[]
  team2Lineup?: TeamMember[]

  // Scoring
  sets: SetScore[]
  setsToWin: number
  winScore: number
  currentSet: number
  player1Score?: number
  player2Score?: number
  player1Sets?: number
  player2Sets?: number

  // Serving
  currentServer: 1 | 2
  serveCount: number
  serveSelected: boolean

  // Match State
  status: MatchStatus
  hasTBD?: boolean
  winner?: 1 | 2
  startTime?: string
  endTime?: string
  notes?: string

  // Timeouts & Breaks
  timeouts: { player1: number; player2: number }
  sideChangeUsed: boolean
  warmupUsed: boolean

  // Tournament/Bracket Info
  bracketRound?: number
  bracketMatchNum?: number
  bracketSize?: number
  roundName?: string
  isLoserBracket?: boolean
  loserRoundName?: string
  loserMatchNum?: number
  loserRoundSize?: number
  isThirdPlace?: boolean
  groupIndex?: number
  groupName?: string
  player1Slot?: string
  player2Slot?: string
  nextMatchId?: number
  nextSlot?: number

  // Scheduling
  scheduledDate?: string
  scheduledTime?: string
  estimatedDuration?: number
  courtName?: string
  mainRefereeName?: string
  round?: string
  matchOrder?: number

  // Referee & Coach
  mainReferee?: string
  assistantReferee?: string
  coach1?: string
  coach2?: string

  // History & Tracking
  history: ScoreHistory[]
  createdAt: string
  updatedAt?: string

  // Live Share
  isShared?: boolean

  // Memo
  memo?: string
}

export interface LiveMatch {
  id: number
  player1Name: string
  player2Name: string
  setScores: SetScore[]
  currentSet: number
  currentServe: ServePlayer
  serveCount: number
  serveSelected: boolean
  history: ScoreHistory[]
  status: MatchStatus
  type: MatchType
  sets: number
  winScore: number
  isShared: boolean
  updatedAt: string
}
