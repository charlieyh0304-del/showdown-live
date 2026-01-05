export type Gender = 'M' | 'F' | 'male' | 'female'

export interface Player {
  id: number
  name: string
  gender?: Gender
  club?: string
  seed?: number
  groupIndex?: number
  createdAt?: string
}

export interface TeamMember {
  id: number
  name: string
  gender?: Gender
  position?: string
}

export interface Team {
  id: number
  name: string
  members?: TeamMember[]
  players?: Player[]
  club?: string
  seed?: number
  topseed?: string | null
  group?: string | null
  groupIndex?: number
  createdAt?: string
}
