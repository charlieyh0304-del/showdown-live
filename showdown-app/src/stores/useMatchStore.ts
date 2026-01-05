import { create } from 'zustand'
import type { Match, ScoreHistory } from '@/types'

interface MatchState {
  // Current match
  currentMatch: Match | null
  setCurrentMatch: (match: Match | null) => void

  // Score history for undo
  scoreHistory: ScoreHistory[]
  addToHistory: (entry: ScoreHistory) => void
  undoLastAction: () => ScoreHistory | null
  clearHistory: () => void

  // Match state
  isPaused: boolean
  setIsPaused: (paused: boolean) => void

  // Warmup
  warmupActive: boolean
  warmupSeconds: number
  setWarmupActive: (active: boolean) => void
  setWarmupSeconds: (seconds: number) => void

  // Timeout
  timeoutActive: boolean
  timeoutSeconds: number
  setTimeoutActive: (active: boolean) => void
  setTimeoutSeconds: (seconds: number) => void

  // Side change
  sideChangeActive: boolean
  sideChangeSeconds: number
  setSideChangeActive: (active: boolean) => void
  setSideChangeSeconds: (seconds: number) => void

  // Match actions
  useTimeout: (player: 'player1' | 'player2') => void
  startWarmup: () => void
  startSideChange: () => void
  resetMatch: () => void
}

export const useMatchStore = create<MatchState>()((set, get) => ({
  // Current match
  currentMatch: null,
  setCurrentMatch: (match) => set({ currentMatch: match }),

  // Score history
  scoreHistory: [],
  addToHistory: (entry) => set((state) => ({
    scoreHistory: [...state.scoreHistory, entry]
  })),
  undoLastAction: () => {
    const { scoreHistory } = get()
    if (scoreHistory.length === 0) return null

    const lastAction = scoreHistory[scoreHistory.length - 1]
    set((state) => ({
      scoreHistory: state.scoreHistory.slice(0, -1)
    }))
    return lastAction
  },
  clearHistory: () => set({ scoreHistory: [] }),

  // Match state
  isPaused: false,
  setIsPaused: (paused) => set({ isPaused: paused }),

  // Warmup
  warmupActive: false,
  warmupSeconds: 120,
  setWarmupActive: (active) => set({ warmupActive: active }),
  setWarmupSeconds: (seconds) => set({ warmupSeconds: seconds }),

  // Timeout
  timeoutActive: false,
  timeoutSeconds: 60,
  setTimeoutActive: (active) => set({ timeoutActive: active }),
  setTimeoutSeconds: (seconds) => set({ timeoutSeconds: seconds }),

  // Side change
  sideChangeActive: false,
  sideChangeSeconds: 60,
  setSideChangeActive: (active) => set({ sideChangeActive: active }),
  setSideChangeSeconds: (seconds) => set({ sideChangeSeconds: seconds }),

  // Match actions
  useTimeout: (player) => {
    const { currentMatch } = get()
    if (!currentMatch) return

    const timeouts = { ...currentMatch.timeouts }
    if (timeouts[player] <= 0) return

    timeouts[player] -= 1

    set({
      currentMatch: {
        ...currentMatch,
        timeouts,
        updatedAt: new Date().toISOString(),
      },
      timeoutActive: true,
      timeoutSeconds: 60,
    })
  },

  startWarmup: () => {
    const { currentMatch } = get()
    if (!currentMatch || currentMatch.warmupUsed) return

    set({
      currentMatch: {
        ...currentMatch,
        warmupUsed: true,
        updatedAt: new Date().toISOString(),
      },
      warmupActive: true,
      warmupSeconds: 120,
    })
  },

  startSideChange: () => {
    const { currentMatch } = get()
    if (!currentMatch || currentMatch.sideChangeUsed) return

    set({
      currentMatch: {
        ...currentMatch,
        sideChangeUsed: true,
        updatedAt: new Date().toISOString(),
      },
      sideChangeActive: true,
      sideChangeSeconds: 60,
    })
  },

  resetMatch: () => {
    set({
      currentMatch: null,
      scoreHistory: [],
      isPaused: false,
      warmupActive: false,
      warmupSeconds: 120,
      timeoutActive: false,
      timeoutSeconds: 60,
      sideChangeActive: false,
      sideChangeSeconds: 60,
    })
  },
}))
