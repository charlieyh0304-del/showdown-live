export type Gender = 'M' | 'F' | 'male' | 'female'

export interface Player {
  name: string
  id?: string | number
  gender?: Gender
}

export interface TeamMember {
  name: string
  gender?: Gender
}

export interface Team {
  id: number
  name: string
  members: TeamMember[]
  players?: Player[]
  topseed?: string | null
  group?: string | null
}
