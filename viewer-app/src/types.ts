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
  player1Sets?: number
  player2Sets?: number
  sets: SetScore[]
  setsToWin: number
  currentSet: number
  currentServer: 1 | 2
  status: 'pending' | 'ready' | 'active' | 'completed' | 'waiting'
  winner?: 1 | 2
  groupName?: string
  bracketRound?: number
  roundName?: string
}

export interface Group {
  name: string
  members: string[]
}

export interface Project {
  id: number
  name: string
  date: string
  location: string
  players?: string[]
  matches: Match[]
  groups: Group[]
  groupSettings?: { advanceCount: number }
  firebaseKey?: string
}
