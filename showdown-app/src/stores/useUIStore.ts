import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeType } from '@/types'

interface UIState {
  // Theme
  theme: ThemeType
  setTheme: (theme: ThemeType) => void
  cycleTheme: () => void

  // Accessibility
  voiceEnabled: boolean
  setVoiceEnabled: (enabled: boolean) => void
  largeTextEnabled: boolean
  setLargeTextEnabled: (enabled: boolean) => void

  // Offline status
  isOffline: boolean
  setIsOffline: (offline: boolean) => void

  // Loading state
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
}

const THEME_ORDER: ThemeType[] = ['default', 'enhanced-contrast', 'high-contrast', 'inverted', 'dark']

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Theme
      theme: 'default',
      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },
      cycleTheme: () => {
        const currentIndex = THEME_ORDER.indexOf(get().theme)
        const nextIndex = (currentIndex + 1) % THEME_ORDER.length
        const nextTheme = THEME_ORDER[nextIndex]
        set({ theme: nextTheme })
        applyTheme(nextTheme)
      },

      // Accessibility
      voiceEnabled: false,
      setVoiceEnabled: (enabled) => set({ voiceEnabled: enabled }),
      largeTextEnabled: false,
      setLargeTextEnabled: (enabled) => {
        set({ largeTextEnabled: enabled })
        if (enabled) {
          document.body.classList.add('large-text')
        } else {
          document.body.classList.remove('large-text')
        }
      },

      // Offline status
      isOffline: false,
      setIsOffline: (offline) => set({ isOffline: offline }),

      // Loading state
      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        voiceEnabled: state.voiceEnabled,
        largeTextEnabled: state.largeTextEnabled,
      }),
    }
  )
)

function applyTheme(theme: ThemeType) {
  document.body.classList.remove('enhanced-contrast', 'high-contrast', 'inverted', 'dark')
  if (theme !== 'default') {
    document.body.classList.add(theme)
  }
}

// Initialize theme on load
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('ui-storage')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      if (state?.theme) {
        applyTheme(state.theme)
      }
      if (state?.largeTextEnabled) {
        document.body.classList.add('large-text')
      }
    } catch {
      // Ignore parse errors
    }
  }
}
