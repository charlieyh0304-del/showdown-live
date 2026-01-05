import {
  ref,
  set,
  get,
  push,
  remove,
  onValue,
  off,
  type DatabaseReference
} from 'firebase/database'
import { getFirebaseDatabase } from './config'
import type { Project, Match, Operator } from '@/types'

// Get database reference
function getRef(path: string): DatabaseReference | null {
  const db = getFirebaseDatabase()
  if (!db) return null
  return ref(db, path)
}

// Projects CRUD
export async function saveProject(project: Project): Promise<string | null> {
  const db = getFirebaseDatabase()
  if (!db) return null

  try {
    if (project.firebaseKey) {
      // Update existing
      const projectRef = ref(db, `projects/${project.firebaseKey}`)
      await set(projectRef, project)
      return project.firebaseKey
    } else {
      // Create new
      const projectsRef = ref(db, 'projects')
      const newRef = push(projectsRef)
      const key = newRef.key
      if (key) {
        await set(newRef, { ...project, firebaseKey: key })
        return key
      }
    }
  } catch (error) {
    console.error('Error saving project:', error)
  }
  return null
}

export async function loadProjects(): Promise<Project[]> {
  const projectRef = getRef('projects')
  if (!projectRef) return []

  try {
    const snapshot = await get(projectRef)
    if (snapshot.exists()) {
      const data = snapshot.val()
      return Object.values(data) as Project[]
    }
  } catch (error) {
    console.error('Error loading projects:', error)
  }
  return []
}

export async function deleteProject(firebaseKey: string): Promise<boolean> {
  const projectRef = getRef(`projects/${firebaseKey}`)
  if (!projectRef) return false

  try {
    await remove(projectRef)
    return true
  } catch (error) {
    console.error('Error deleting project:', error)
    return false
  }
}

// Operators CRUD
export async function saveOperators(operators: Operator[]): Promise<boolean> {
  const operatorsRef = getRef('operators')
  if (!operatorsRef) return false

  try {
    await set(operatorsRef, operators)
    return true
  } catch (error) {
    console.error('Error saving operators:', error)
    return false
  }
}

export async function loadOperators(): Promise<Operator[]> {
  const operatorsRef = getRef('operators')
  if (!operatorsRef) return []

  try {
    const snapshot = await get(operatorsRef)
    if (snapshot.exists()) {
      return snapshot.val() as Operator[]
    }
  } catch (error) {
    console.error('Error loading operators:', error)
  }
  return []
}

// Live Match Updates
export async function updateLiveMatch(
  projectId: number,
  match: Match
): Promise<boolean> {
  const matchRef = getRef(`liveMatches/${projectId}/${match.id}`)
  if (!matchRef) return false

  try {
    await set(matchRef, {
      id: match.id,
      player1Name: match.player1Name,
      player2Name: match.player2Name,
      sets: match.sets,
      currentSet: match.currentSet,
      currentServer: match.currentServer,
      serveCount: match.serveCount,
      serveSelected: match.serveSelected,
      status: match.status,
      type: match.type,
      setsToWin: match.setsToWin,
      winScore: match.winScore,
      isShared: match.isShared,
      updatedAt: new Date().toISOString()
    })
    return true
  } catch (error) {
    console.error('Error updating live match:', error)
    return false
  }
}

export async function removeLiveMatch(
  projectId: number,
  matchId: number
): Promise<boolean> {
  const matchRef = getRef(`liveMatches/${projectId}/${matchId}`)
  if (!matchRef) return false

  try {
    await remove(matchRef)
    return true
  } catch (error) {
    console.error('Error removing live match:', error)
    return false
  }
}

// Real-time Subscriptions
export function subscribeToProjects(
  callback: (projects: Project[]) => void
): (() => void) | null {
  const projectsRef = getRef('projects')
  if (!projectsRef) return null

  onValue(projectsRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val()
      callback(Object.values(data) as Project[])
    } else {
      callback([])
    }
  })

  return () => off(projectsRef)
}

export function subscribeToLiveMatches(
  projectId: number,
  callback: (matches: Match[]) => void
): (() => void) | null {
  const matchesRef = getRef(`liveMatches/${projectId}`)
  if (!matchesRef) return null

  onValue(matchesRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val()
      callback(Object.values(data) as Match[])
    } else {
      callback([])
    }
  })

  return () => off(matchesRef)
}

export function subscribeToOperators(
  callback: (operators: Operator[]) => void
): (() => void) | null {
  const operatorsRef = getRef('operators')
  if (!operatorsRef) return null

  onValue(operatorsRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val() as Operator[])
    } else {
      callback([])
    }
  })

  return () => off(operatorsRef)
}
