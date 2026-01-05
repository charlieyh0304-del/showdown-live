import type { Match } from './match'
import type { Player } from './player'

export interface PlayerStanding {
  name: string
  wins: number
  losses: number
  setWins: number
  setLosses: number
  setDiff: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  winRate?: number
}

export interface Group {
  name: string
  members?: string[] | Player[]
  players?: string[] | Player[]
  matches: Match[]
  standings: PlayerStanding[]
  isTeam?: boolean
}
