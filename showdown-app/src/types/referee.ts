export type OperatorRole = 'super' | 'admin'

export interface Referee {
  name: string
  role?: string
  pin?: string
  createdAt?: string
  firebaseAuth?: boolean
}

export interface Court {
  name: string
  location?: string
  createdAt?: string
}

export interface Operator {
  name: string
  email: string
  password: string
  role: OperatorRole
  firebaseAuth?: boolean
  createdAt: string
}

export interface CourtStat {
  name: string
  matchCount: number
  averageDuration?: number
}
