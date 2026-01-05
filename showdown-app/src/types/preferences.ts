export type ThemeType = 'default' | 'enhanced-contrast' | 'high-contrast' | 'inverted' | 'dark'

export type UserRole = 'referee' | 'viewer' | 'admin' | null

export interface UserPreferences {
  userId: string
  favorites: string[]
  notifications: string[]
  theme: ThemeType
  voiceEnabled: boolean
  largeTextEnabled: boolean
}

export interface FirebaseConfig {
  apiKey: string
  authDomain: string
  databaseURL: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}
