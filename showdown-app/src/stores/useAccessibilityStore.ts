/**
 * 접근성 설정 스토어
 * 시각장애인을 위한 다양한 접근성 옵션 관리
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeType = 'default' | 'dark' | 'high-contrast' | 'inverted'
export type FontSize = 'normal' | 'large' | 'extra-large'

interface AccessibilityState {
  // 음성 설정
  voiceEnabled: boolean
  voiceVolume: number // 0.0 ~ 1.0

  // 시각 설정
  theme: ThemeType
  fontSize: FontSize
  reduceMotion: boolean

  // 경기 중 음성 안내 세부 설정
  announceScore: boolean      // 매 득점 안내
  announceSetScore: boolean   // 세트 점수 안내
  announceServe: boolean      // 서브 교대 안내

  // Actions
  setVoiceEnabled: (enabled: boolean) => void
  setVoiceVolume: (volume: number) => void
  setTheme: (theme: ThemeType) => void
  setFontSize: (size: FontSize) => void
  setReduceMotion: (reduce: boolean) => void
  setAnnounceScore: (enabled: boolean) => void
  setAnnounceSetScore: (enabled: boolean) => void
  setAnnounceServe: (enabled: boolean) => void
  resetToDefaults: () => void
}

const defaultState = {
  voiceEnabled: false,
  voiceVolume: 1.0,
  theme: 'default' as ThemeType,
  fontSize: 'normal' as FontSize,
  reduceMotion: false,
  announceScore: true,
  announceSetScore: true,
  announceServe: true,
}

export const useAccessibilityStore = create<AccessibilityState>()(
  persist(
    (set) => ({
      ...defaultState,

      setVoiceEnabled: (enabled) => set({ voiceEnabled: enabled }),
      setVoiceVolume: (volume) => set({ voiceVolume: Math.max(0, Math.min(1, volume)) }),
      setTheme: (theme) => set({ theme }),
      setFontSize: (size) => set({ fontSize: size }),
      setReduceMotion: (reduce) => set({ reduceMotion: reduce }),
      setAnnounceScore: (enabled) => set({ announceScore: enabled }),
      setAnnounceSetScore: (enabled) => set({ announceSetScore: enabled }),
      setAnnounceServe: (enabled) => set({ announceServe: enabled }),
      resetToDefaults: () => set(defaultState),
    }),
    {
      name: 'accessibility-settings',
    }
  )
)
