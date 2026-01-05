import type { Project, Operator, Referee, Court } from '@/types'

const KEYS = {
  PROJECTS: 'projects',
  OPERATORS: 'operators',
  GLOBAL_REFEREES: 'globalReferees',
  GLOBAL_COURTS: 'globalCourts',
  PRACTICE_HISTORY: 'practiceHistory',
  MY_REFEREE_NAME: 'myRefereeName',
  USER_ID: 'userId'
} as const

// Projects
export function loadProjectsFromStorage(): Project[] {
  try {
    const stored = localStorage.getItem(KEYS.PROJECTS)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('Error loading projects from storage:', error)
  }
  return []
}

export function saveProjectsToStorage(projects: Project[]): void {
  try {
    localStorage.setItem(KEYS.PROJECTS, JSON.stringify(projects))
  } catch (error) {
    console.error('Error saving projects to storage:', error)
  }
}

// Operators
export function loadOperatorsFromStorage(): Operator[] {
  try {
    const stored = localStorage.getItem(KEYS.OPERATORS)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('Error loading operators from storage:', error)
  }
  return []
}

export function saveOperatorsToStorage(operators: Operator[]): void {
  try {
    localStorage.setItem(KEYS.OPERATORS, JSON.stringify(operators))
  } catch (error) {
    console.error('Error saving operators to storage:', error)
  }
}

// Global Referees
export function loadGlobalRefereesFromStorage(): Referee[] {
  try {
    const stored = localStorage.getItem(KEYS.GLOBAL_REFEREES)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('Error loading global referees:', error)
  }
  return []
}

export function saveGlobalRefereesToStorage(referees: Referee[]): void {
  try {
    localStorage.setItem(KEYS.GLOBAL_REFEREES, JSON.stringify(referees))
  } catch (error) {
    console.error('Error saving global referees:', error)
  }
}

// Global Courts
export function loadGlobalCourtsFromStorage(): Court[] {
  try {
    const stored = localStorage.getItem(KEYS.GLOBAL_COURTS)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('Error loading global courts:', error)
  }
  return []
}

export function saveGlobalCourtsToStorage(courts: Court[]): void {
  try {
    localStorage.setItem(KEYS.GLOBAL_COURTS, JSON.stringify(courts))
  } catch (error) {
    console.error('Error saving global courts:', error)
  }
}

// User ID
export function getUserId(): string {
  let userId = localStorage.getItem(KEYS.USER_ID)
  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    localStorage.setItem(KEYS.USER_ID, userId)
  }
  return userId
}

// My Referee Name
export function getMyRefereeName(): string {
  return localStorage.getItem(KEYS.MY_REFEREE_NAME) || ''
}

export function setMyRefereeName(name: string): void {
  localStorage.setItem(KEYS.MY_REFEREE_NAME, name)
}

// Generic storage helper
export function getFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      return JSON.parse(stored) as T
    }
  } catch {
    // Ignore
  }
  return defaultValue
}

export function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error(`Error saving ${key} to storage:`, error)
  }
}
