import type { Match } from './match'
import type { Player, Team } from './player'
import type { Group, PlayerStanding } from './group'
import type { Bracket, MatchSlot, NextRound } from './bracket'
import type { Referee, Court } from './referee'

export type CompetitionType = 'individual' | 'team'
export type TournamentType = 'group' | 'group-tournament' | 'tournament' | 'knockout-only' | 'group-only'
export type GroupAssignment = 'topSeed' | 'random'
export type SameGroupAvoid = 'quarterfinal' | 'semifinal'

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

export interface RandomTeamData {
  participants: Player[]
  teamAssignments: {
    name: string
    members: string[]
    topseed: string | null
  }[]
}

export interface Project {
  // Basic Information
  id: number
  name: string
  date: string
  location: string
  desc: string
  createdAt: string
  firebaseKey?: string

  // Competition Type & Tournament Settings
  competitionType: CompetitionType
  tournamentType: TournamentType

  // Data Collections
  matches: Match[]
  players: Player[] | string[]
  teams: Team[]
  groups: Group[]
  bracket: Bracket | null
  standings: PlayerStanding[]
  customBracket?: MatchSlot[]
  nextRounds?: NextRound[]

  // Settings
  groupSettings?: GroupSettings
  tournamentSettings?: TournamentSettings

  // Features
  referees?: Referee[]
  courts?: Court[]
  topSeeds?: string[]
  preliminarySets?: number
  finalsSets?: number
  advanceCount?: number
  wildcards?: number
  sameGroupAvoid?: SameGroupAvoid
  loserBracket?: boolean
  finalsSize?: number
  bracketPin?: string

  // Flags
  isPractice?: boolean
  isShared?: boolean
  isRandomTeamLeague?: boolean
  isQuickProject?: boolean
  randomTeamData?: RandomTeamData
}

export interface TournamentWizard {
  info: {
    name: string
    date: string
    location: string
  }
  participants: string[]
  preliminary?: {
    enabled: boolean
    groupCount: number
    perGroup: number
    sets: number
    advanceCount: number
    wildcards: number
    groupAssignment: GroupAssignment
    topSeeds: string[]
  }
  finals?: {
    enabled: boolean
    size: number
    sets: number
    customBracket: MatchSlot[]
    sameGroupAvoid: SameGroupAvoid
    loserBracket: boolean
    nextRounds: NextRound[]
  }
  referees?: Referee[]
  courts?: Court[]
  bracket?: Bracket
  step?: number
}
