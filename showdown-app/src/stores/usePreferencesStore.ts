import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PreferencesState {
  // Favorites
  favoritePlayers: string[]
  addFavoritePlayer: (name: string) => void
  removeFavoritePlayer: (name: string) => void
  toggleFavoritePlayer: (name: string) => void
  isFavoritePlayer: (name: string) => boolean

  // Match notifications
  notifiedMatches: string[]
  addNotifiedMatch: (matchId: string) => void
  removeNotifiedMatch: (matchId: string) => void

  // Show favorites only filter
  showFavoritesOnly: boolean
  setShowFavoritesOnly: (show: boolean) => void

  // Practice history
  practiceHistory: PracticeMatch[]
  addPracticeMatch: (match: PracticeMatch) => void
  deletePracticeMatch: (index: number) => void
  clearPracticeHistory: () => void
}

interface PracticeMatch {
  id: number
  player1Name: string
  player2Name: string
  type: 'individual' | 'team'
  sets: number
  setScores: { player1: number; player2: number }[]
  winner: string
  createdAt: string
  duration?: number
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      // Favorites
      favoritePlayers: [],
      addFavoritePlayer: (name) => set((state) => ({
        favoritePlayers: [...state.favoritePlayers, name]
      })),
      removeFavoritePlayer: (name) => set((state) => ({
        favoritePlayers: state.favoritePlayers.filter((p) => p !== name)
      })),
      toggleFavoritePlayer: (name) => {
        const { favoritePlayers } = get()
        if (favoritePlayers.includes(name)) {
          set({ favoritePlayers: favoritePlayers.filter((p) => p !== name) })
        } else {
          set({ favoritePlayers: [...favoritePlayers, name] })
        }
      },
      isFavoritePlayer: (name) => get().favoritePlayers.includes(name),

      // Match notifications
      notifiedMatches: [],
      addNotifiedMatch: (matchId) => set((state) => ({
        notifiedMatches: [...state.notifiedMatches, matchId]
      })),
      removeNotifiedMatch: (matchId) => set((state) => ({
        notifiedMatches: state.notifiedMatches.filter((id) => id !== matchId)
      })),

      // Show favorites only filter
      showFavoritesOnly: false,
      setShowFavoritesOnly: (show) => set({ showFavoritesOnly: show }),

      // Practice history
      practiceHistory: [],
      addPracticeMatch: (match) => set((state) => ({
        practiceHistory: [match, ...state.practiceHistory]
      })),
      deletePracticeMatch: (index) => set((state) => ({
        practiceHistory: state.practiceHistory.filter((_, i) => i !== index)
      })),
      clearPracticeHistory: () => set({ practiceHistory: [] }),
    }),
    {
      name: 'preferences-storage',
    }
  )
)
