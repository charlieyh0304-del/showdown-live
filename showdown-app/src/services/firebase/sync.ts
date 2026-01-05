import { useEffect, useCallback } from 'react'
import { useProjectStore, useUIStore } from '@/stores'
import {
  initializeFirebase,
  isFirebaseInitialized
} from './config'
import {
  saveProject,
  subscribeToProjects
} from './database'
import type { Project } from '@/types'

// Merge local and Firebase data
export function mergeProjects(
  localProjects: Project[],
  firebaseProjects: Project[]
): Project[] {
  const merged = new Map<number, Project>()

  // Add local projects
  localProjects.forEach((p) => {
    merged.set(p.id, p)
  })

  // Merge or add Firebase projects (prefer newer)
  firebaseProjects.forEach((fp) => {
    const existing = merged.get(fp.id)
    if (!existing) {
      merged.set(fp.id, fp)
    } else {
      // Compare timestamps, prefer newer
      const existingTime = new Date(existing.createdAt || 0).getTime()
      const firebaseTime = new Date(fp.createdAt || 0).getTime()
      if (firebaseTime > existingTime) {
        merged.set(fp.id, fp)
      }
    }
  })

  return Array.from(merged.values())
}

// Sync manager class
class SyncManager {
  private unsubscribeProjects: (() => void) | null = null
  private initialized = false
  private offlineQueue: QueueItem[] = []

  async initialize(): Promise<boolean> {
    if (this.initialized) return true

    // Load offline queue from localStorage
    this.loadOfflineQueue()

    // Initialize Firebase
    const connected = initializeFirebase()
    if (!connected) {
      console.warn('Firebase not available, using offline mode')
      return false
    }

    this.initialized = true

    // Process offline queue if online
    if (navigator.onLine) {
      await this.processOfflineQueue()
    }

    return true
  }

  // Start real-time sync
  startSync(
    onProjectsUpdate: (projects: Project[]) => void
  ): void {
    if (!isFirebaseInitialized()) return

    // Subscribe to projects
    this.unsubscribeProjects = subscribeToProjects((firebaseProjects) => {
      const localProjects = useProjectStore.getState().projects
      const merged = mergeProjects(localProjects, firebaseProjects)
      onProjectsUpdate(merged)
    }) as (() => void) | null
  }

  // Stop sync
  stopSync(): void {
    if (this.unsubscribeProjects) {
      this.unsubscribeProjects()
      this.unsubscribeProjects = null
    }
  }

  // Sync project to Firebase
  async syncProject(project: Project): Promise<void> {
    if (!navigator.onLine || !isFirebaseInitialized()) {
      this.addToOfflineQueue({ type: 'project', data: project })
      return
    }

    try {
      const key = await saveProject(project)
      if (key && !project.firebaseKey) {
        // Update local project with Firebase key
        useProjectStore.getState().updateProject(project.id, { firebaseKey: key })
      }
    } catch (error) {
      console.error('Error syncing project:', error)
      this.addToOfflineQueue({ type: 'project', data: project })
    }
  }

  // Offline queue management
  private loadOfflineQueue(): void {
    try {
      const stored = localStorage.getItem('offlineQueue')
      if (stored) {
        this.offlineQueue = JSON.parse(stored)
      }
    } catch {
      this.offlineQueue = []
    }
  }

  private saveOfflineQueue(): void {
    localStorage.setItem('offlineQueue', JSON.stringify(this.offlineQueue))
  }

  private addToOfflineQueue(item: QueueItem): void {
    this.offlineQueue.push({
      ...item,
      timestamp: Date.now()
    })
    this.saveOfflineQueue()
  }

  async processOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) return
    if (!navigator.onLine || !isFirebaseInitialized()) return

    console.log(`Processing ${this.offlineQueue.length} offline items...`)

    const queue = [...this.offlineQueue]
    this.offlineQueue = []

    for (const item of queue) {
      try {
        if (item.type === 'project') {
          await saveProject(item.data as Project)
        }
      } catch (error) {
        console.error('Error processing queue item:', error)
        // Re-add to queue on failure
        this.offlineQueue.push(item)
      }
    }

    this.saveOfflineQueue()
  }
}

interface QueueItem {
  type: 'project' | 'match' | 'operator'
  data: unknown
  timestamp?: number
}

// Singleton instance
export const syncManager = new SyncManager()

// React hook for Firebase sync
export function useFirebaseSync() {
  const setProjects = useProjectStore((state) => state.setProjects)
  const isOffline = useUIStore((state) => state.isOffline)

  // Initialize sync
  useEffect(() => {
    syncManager.initialize()
  }, [])

  // Start/stop sync based on online status
  useEffect(() => {
    if (!isOffline) {
      syncManager.startSync(setProjects)

      // Process offline queue when coming back online
      syncManager.processOfflineQueue()
    }

    return () => {
      syncManager.stopSync()
    }
  }, [isOffline, setProjects])

  // Sync project helper
  const syncProject = useCallback(async (project: Project) => {
    await syncManager.syncProject(project)
  }, [])

  return {
    syncProject,
    isOnline: !isOffline
  }
}
