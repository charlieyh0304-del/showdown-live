import type { Match } from './match'

export interface BracketRound {
  round: number
  matches: Match[]
}

export interface Bracket {
  [key: string]: BracketRound
}

export interface MatchSlot {
  round: number
  match: number
  player1: string | null
  player2: string | null
  player1Slot?: string
  player2Slot?: string
}

export interface NextRoundMatch {
  matchNum: number
  player1Slot?: string
  player2Slot?: string
}

export interface NextRound {
  roundName: string
  roundSize: number
  matches: NextRoundMatch[]
}
