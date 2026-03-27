import { initializeApp } from 'firebase/app';
import { getDatabase, enableLogging } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// Firebase 설정 - 실제 프로젝트에서는 환경변수 사용 권장
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const auth = getAuth(app);

// 익명 인증 - 앱 시작 시 자동 로그인 (DB 쓰기 권한 확보)
// authReady: 인증 완료를 기다리는 Promise (DB 쓰기 전에 await)
export const authReady = new Promise<void>((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (user) {
      unsubscribe();
      resolve();
    } else {
      signInAnonymously(auth).catch(() => {
        // 오프라인 등 실패 시 무시 - 재연결 시 자동 재시도
      });
    }
  });
});

// Firebase Realtime Database has built-in offline caching.
// Data is automatically cached locally and synced when reconnected.
// Enable logging in development for debugging offline behavior.
if (import.meta.env.DEV) {
  try {
    enableLogging(false);
  } catch {
    // Logging may already be enabled
  }
}

export default app;
