import { useEffect, useState, useCallback } from 'react'
import { useProjectStore, useUIStore } from '@/stores'
import {
  initializeFirebase,
  isFirebaseInitialized,
  loadProjects,
  saveProject,
  subscribeToProjects
} from '@/services/firebase'
import { loadProjectsFromStorage, saveProjectsToStorage } from '@/services/storage'
import type { Project } from '@/types'

export function useFirebase() {
  const [isInitialized, setIsInitialized] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const setProjects = useProjectStore((state) => state.setProjects)
  const projects = useProjectStore((state) => state.projects)
  const isOffline = useUIStore((state) => state.isOffline)

  // Initialize Firebase and load initial data
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true)

      // Load from localStorage first (instant)
      const localProjects = loadProjectsFromStorage()
      if (localProjects.length > 0) {
        setProjects(localProjects)
      }

      // Initialize Firebase
      const connected = initializeFirebase()
      setIsInitialized(connected)

      if (connected && navigator.onLine) {
        try {
          // Load from Firebase and merge
          const firebaseProjects = await loadProjects()
          const merged = mergeProjects(localProjects, firebaseProjects)
          setProjects(merged)
          saveProjectsToStorage(merged)
        } catch (error) {
          console.error('Error loading from Firebase:', error)
        }
      }

      setIsLoading(false)
    }

    initialize()
  }, [setProjects])

  // Subscribe to real-time updates
  useEffect(() => {
    if (!isInitialized || isOffline) return

    const unsubscribe = subscribeToProjects((firebaseProjects) => {
      const localProjects = useProjectStore.getState().projects
      const merged = mergeProjects(localProjects, firebaseProjects)
      setProjects(merged)
      saveProjectsToStorage(merged)
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [isInitialized, isOffline, setProjects])

  // Save projects to localStorage whenever they change
  useEffect(() => {
    if (projects.length > 0) {
      saveProjectsToStorage(projects)
    }
  }, [projects])

  // Sync single project
  const syncProject = useCallback(async (project: Project) => {
    // Always save to localStorage
    const updatedProjects = projects.map((p) =>
      p.id === project.id ? project : p
    )
    if (!updatedProjects.find((p) => p.id === project.id)) {
      updatedProjects.push(project)
    }
    setProjects(updatedProjects)
    saveProjectsToStorage(updatedProjects)

    // Sync to Firebase if online
    if (!isOffline && isInitialized) {
      try {
        const key = await saveProject(project)
        if (key && !project.firebaseKey) {
          // Update with Firebase key
          const withKey = { ...project, firebaseKey: key }
          const finalProjects = updatedProjects.map((p) =>
            p.id === project.id ? withKey : p
          )
          setProjects(finalProjects)
          saveProjectsToStorage(finalProjects)
        }
      } catch (error) {
        console.error('Error syncing project:', error)
        // Add to offline queue
        addToOfflineQueue({ type: 'project', data: project })
      }
    } else {
      // Add to offline queue
      addToOfflineQueue({ type: 'project', data: project })
    }
  }, [projects, isOffline, isInitialized, setProjects])

  return {
    isInitialized,
    isLoading,
    syncProject,
    isOnline: !isOffline
  }
}

// Merge helper
function mergeProjects(local: Project[], firebase: Project[]): Project[] {
  const merged = new Map<number, Project>()

  local.forEach((p) => merged.set(p.id, p))

  firebase.forEach((fp) => {
    const existing = merged.get(fp.id)
    if (!existing) {
      merged.set(fp.id, fp)
    } else {
      // Prefer newer data
      const existingTime = new Date(existing.createdAt || 0).getTime()
      const firebaseTime = new Date(fp.createdAt || 0).getTime()
      if (firebaseTime > existingTime) {
        merged.set(fp.id, fp)
      }
    }
  })

  return Array.from(merged.values())
}

// Offline queue
interface QueueItem {
  type: string
  data: unknown
  timestamp: number
}

function addToOfflineQueue(item: Omit<QueueItem, 'timestamp'>): void {
  try {
    const stored = localStorage.getItem('offlineQueue')
    const queue: QueueItem[] = stored ? JSON.parse(stored) : []
    queue.push({ ...item, timestamp: Date.now() })
    localStorage.setItem('offlineQueue', JSON.stringify(queue))
  } catch {
    // Ignore
  }
}

export async function processOfflineQueue(): Promise<void> {
  if (!navigator.onLine || !isFirebaseInitialized()) return

  try {
    const stored = localStorage.getItem('offlineQueue')
    if (!stored) return

    const queue: QueueItem[] = JSON.parse(stored)
    if (queue.length === 0) return

    console.log(`Processing ${queue.length} offline items...`)

    const remaining: QueueItem[] = []

    for (const item of queue) {
      try {
        if (item.type === 'project') {
          await saveProject(item.data as Project)
        }
      } catch {
        remaining.push(item)
      }
    }

    localStorage.setItem('offlineQueue', JSON.stringify(remaining))
  } catch {
    // Ignore
  }
}
