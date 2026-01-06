import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeType = 'default' | 'dark' | 'high-contrast' | 'inverted'
export type FontSize = 'normal' | 'large' | 'extra-large'

interface AccessibilityState {
  voiceEnabled: boolean
  voiceVolume: number
  theme: ThemeType
  fontSize: FontSize
  reduceMotion: boolean
  announceScore: boolean
  announceSetScore: boolean
  announceServe: boolean

  setVoiceEnabled: (enabled: boolean) => void
  setVoiceVolume: (volume: number) => void
  setTheme: (theme: ThemeType) => void
  setFontSize: (size: FontSize) => void
  setReduceMotion: (reduce: boolean) => void
  setAnnounceScore: (enabled: boolean) => void
  setAnnounceSetScore: (enabled: boolean) => void
  setAnnounceServe: (enabled: boolean) => void
}

export const useAccessibilityStore = create<AccessibilityState>()(
  persist(
    (set) => ({
      voiceEnabled: false,
      voiceVolume: 1.0,
      theme: 'default',
      fontSize: 'normal',
      reduceMotion: false,
      announceScore: true,
      announceSetScore: true,
      announceServe: true,

      setVoiceEnabled: (enabled) => set({ voiceEnabled: enabled }),
      setVoiceVolume: (volume) => set({ voiceVolume: Math.max(0, Math.min(1, volume)) }),
      setTheme: (theme) => set({ theme }),
      setFontSize: (size) => set({ fontSize: size }),
      setReduceMotion: (reduce) => set({ reduceMotion: reduce }),
      setAnnounceScore: (enabled) => set({ announceScore: enabled }),
      setAnnounceSetScore: (enabled) => set({ announceSetScore: enabled }),
      setAnnounceServe: (enabled) => set({ announceServe: enabled }),
    }),
    { name: 'referee-accessibility' }
  )
)
