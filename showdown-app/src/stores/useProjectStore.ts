import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project } from '@/types'

interface ProjectState {
  // Projects list
  projects: Project[]
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  updateProject: (id: number, updates: Partial<Project>) => void
  deleteProject: (id: number) => void

  // Current project
  currentProject: Project | null
  setCurrentProject: (project: Project | null) => void

  // Helpers
  getProjectById: (id: number) => Project | undefined
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      // Projects list
      projects: [],
      setProjects: (projects) => set({ projects }),
      addProject: (project) => set((state) => ({
        projects: [...state.projects, project]
      })),
      updateProject: (id, updates) => set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? { ...p, ...updates } : p
        )
      })),
      deleteProject: (id) => set((state) => ({
        projects: state.projects.filter((p) => p.id !== id)
      })),

      // Current project
      currentProject: null,
      setCurrentProject: (project) => set({ currentProject: project }),

      // Helpers
      getProjectById: (id) => get().projects.find((p) => p.id === id),
    }),
    {
      name: 'projects-storage',
      partialize: (state) => ({
        projects: state.projects,
      }),
    }
  )
)
