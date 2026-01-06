import { create } from 'zustand'
import type { Match, ScoreHistoryEntry } from '../types'

interface MatchState {
  currentMatch: Match | null
  scoreHistory: ScoreHistoryEntry[]

  setCurrentMatch: (match: Match | null) => void
  updateMatch: (updates: Partial<Match>) => void
  addToHistory: (entry: ScoreHistoryEntry) => void
  popHistory: () => ScoreHistoryEntry | undefined
  clearHistory: () => void
}

export const useMatchStore = create<MatchState>((set, get) => ({
  currentMatch: null,
  scoreHistory: [],

  setCurrentMatch: (match) => set({ currentMatch: match }),

  updateMatch: (updates) => set((state) => ({
    currentMatch: state.currentMatch ? { ...state.currentMatch, ...updates } : null
  })),

  addToHistory: (entry) => set((state) => ({
    scoreHistory: [...state.scoreHistory, entry]
  })),

  popHistory: () => {
    const state = get()
    if (state.scoreHistory.length === 0) return undefined
    const last = state.scoreHistory[state.scoreHistory.length - 1]
    set({ scoreHistory: state.scoreHistory.slice(0, -1) })
    return last
  },

  clearHistory: () => set({ scoreHistory: [] }),
}))
