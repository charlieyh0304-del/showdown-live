import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserRole, Operator } from '@/types'

interface AuthState {
  // User role
  userRole: UserRole
  setUserRole: (role: UserRole) => void

  // Authentication
  isAuthenticated: boolean
  setIsAuthenticated: (auth: boolean) => void

  // Current operator
  currentOperator: Operator | null
  setCurrentOperator: (operator: Operator | null) => void

  // Admin mode
  adminModeAuth: boolean
  setAdminModeAuth: (auth: boolean) => void

  // Referee name
  myRefereeName: string
  setMyRefereeName: (name: string) => void

  // Reset auth
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      // User role
      userRole: null,
      setUserRole: (role) => set({ userRole: role }),

      // Authentication
      isAuthenticated: false,
      setIsAuthenticated: (auth) => set({ isAuthenticated: auth }),

      // Current operator
      currentOperator: null,
      setCurrentOperator: (operator) => set({ currentOperator: operator }),

      // Admin mode
      adminModeAuth: false,
      setAdminModeAuth: (auth) => set({ adminModeAuth: auth }),

      // Referee name
      myRefereeName: '',
      setMyRefereeName: (name) => set({ myRefereeName: name }),

      // Logout
      logout: () => set({
        userRole: null,
        isAuthenticated: false,
        currentOperator: null,
        adminModeAuth: false,
      }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        myRefereeName: state.myRefereeName,
      }),
    }
  )
)
