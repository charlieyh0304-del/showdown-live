import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getDatabase, type Database } from 'firebase/database'
import { getAuth, type Auth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyAKv3QOpSg-hLnyXSnE299fHRV-akpPQCs",
  authDomain: "showdown1-838bf.firebaseapp.com",
  databaseURL: "https://showdown1-838bf-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "showdown1-838bf",
  storageBucket: "showdown1-838bf.firebasestorage.app",
  messagingSenderId: "379033064628",
  appId: "1:379033064628:web:252eef0e38b45859df73e1"
}

let app: FirebaseApp | null = null
let database: Database | null = null
let auth: Auth | null = null

export function initializeFirebase(): boolean {
  try {
    if (!app) {
      app = initializeApp(firebaseConfig)
      database = getDatabase(app)
      auth = getAuth(app)
      console.log('✅ Firebase 연결됨')
      return true
    }
    return true
  } catch (error) {
    console.error('❌ Firebase 연결 실패:', error)
    return false
  }
}

export function getFirebaseApp(): FirebaseApp | null {
  return app
}

export function getFirebaseDatabase(): Database | null {
  return database
}

export function getFirebaseAuth(): Auth | null {
  return auth
}

export function isFirebaseInitialized(): boolean {
  return app !== null && database !== null
}
