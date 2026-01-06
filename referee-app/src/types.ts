export interface SetScore {
  player1Score: number
  player2Score: number
  isComplete?: boolean
  winner?: 1 | 2
}

export interface Match {
  id: number
  player1Name: string
  player2Name: string
  player1Score?: number
  player2Score?: number
  player1Sets?: number
  player2Sets?: number
  sets: SetScore[]
  setsToWin: number
  currentSet: number
  currentServer: 1 | 2
  status: 'pending' | 'ready' | 'active' | 'completed' | 'waiting'
  winner?: 1 | 2
  groupName?: string
  groupIndex?: number
  bracketRound?: number
  bracketMatchNum?: number
  roundName?: string
  isThirdPlace?: boolean
  startTime?: string
  endTime?: string
}

export interface Group {
  name: string
  members?: string[]
  players?: string[]
  matches: Match[]
}

export interface GroupSettings {
  groupCount: number
  advanceCount: number
  setsPerMatch: number
}

export interface TournamentSettings {
  size: number
  thirdPlaceMatch: boolean
  setsPerMatch: number
}

export interface Project {
  id: number
  name: string
  date: string
  location: string
  desc: string
  competitionType: 'individual' | 'team'
  tournamentType: string
  matches: Match[]
  groups: Group[]
  groupSettings?: GroupSettings
  tournamentSettings?: TournamentSettings
  firebaseKey?: string
}

export interface ScoreHistoryEntry {
  player: 1 | 2
  player1Score: number
  player2Score: number
  player1Sets: number
  player2Sets: number
  currentSet: number
  currentServer: 1 | 2
  sets: SetScore[]
  timestamp: number
}
