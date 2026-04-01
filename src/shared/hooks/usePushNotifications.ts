import { useEffect, useRef, useCallback, useState } from 'react';
import { getMessaging, getToken, deleteToken, onMessage } from 'firebase/messaging';
import { ref, set } from 'firebase/database';
import app, { database } from '@shared/config/firebase';
import { sendNotification } from '@shared/utils/notifications';

// VAPID key - 환경변수에서만 로드 (하드코딩 제거)
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
const TOKEN_KEY = 'showdown_fcm_token';

function getPlatform(): string {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function tokenToKey(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return 'tk_' + Math.abs(hash).toString(36);
}

interface FavEntry { id: string; name: string }

const PREV_TOKEN_KEY = 'showdown_fcm_prev_token';

async function syncSubscription(token: string, favorites: FavEntry[]) {
  const key = tokenToKey(token);
  const subRef = ref(database, `pushSubscriptions/${key}`);
  const favoriteIds = favorites.map(f => f.id);
  const favoriteNames = favorites.map(f => f.name).filter(n => n && n !== '');

  // 이전 토큰이 다르면 이전 구독 삭제 (토큰 갱신 시 stale 방지)
  const prevToken = localStorage.getItem(PREV_TOKEN_KEY);
  if (prevToken && prevToken !== token) {
    const prevKey = tokenToKey(prevToken);
    if (prevKey !== key) {
      try {
        const { remove: fbRemove } = await import('firebase/database');
        await fbRemove(ref(database, `pushSubscriptions/${prevKey}`));
        console.log('[Push] Removed old subscription:', prevKey);
      } catch (e) {
        console.warn('[Push] Failed to remove old subscription:', e);
      }
    }
  }
  localStorage.setItem(PREV_TOKEN_KEY, token);

  await set(subRef, {
    token,
    favoriteIds,
    favoriteNames,
    platform: getPlatform(),
    updatedAt: Date.now(),
  });
  console.log('[Push] Synced subscription to Firebase:', key, 'favorites:', favoriteIds.length, 'names:', favoriteNames);
}

// 기존 firebase-messaging-sw.js 등록 정리
async function cleanupOldServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const reg of registrations) {
    if (reg.active?.scriptURL?.includes('firebase-messaging-sw.js')) {
      console.log('[Push] Unregistering old firebase-messaging-sw.js');
      await reg.unregister();
    }
  }
}

async function registerAndGetToken(): Promise<string | null> {
  if (!VAPID_KEY) {
    console.error('[Push] VAPID key not configured!');
    return null;
  }

  // 기존 firebase-messaging-sw.js 정리
  await cleanupOldServiceWorkers();

  // VitePWA의 sw.js 사용 (workbox + Firebase Messaging 통합)
  const swReg = await navigator.serviceWorker.ready;

  const messaging = getMessaging(app);

  // 기존 토큰이 잘못된 SW에 바인딩되어 있을 수 있으므로 1회 갱신
  const migrationKey = 'showdown_sw_migrated_v3';
  if (!localStorage.getItem(migrationKey)) {
    try {
      await deleteToken(messaging);
      localStorage.removeItem(TOKEN_KEY);
      console.log('[Push] Deleted old token for SW migration');
    } catch (e) {
      console.warn('[Push] Token migration cleanup:', e);
    }
    localStorage.setItem(migrationKey, '1');
  }

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: swReg,
  });

  return token || null;
}

export function usePushNotifications(favorites: FavEntry[]) {
  const [pushEnabled, setPushEnabled] = useState(() => {
    // 토큰이 localStorage에 있으면 푸시 활성 상태로 시작 (비동기 갱신 전 클라이언트 알림 차단)
    return !!localStorage.getItem(TOKEN_KEY) && Notification.permission === 'granted';
  });
  const [pushSupported, setPushSupported] = useState(true);
  const [debugInfo, setDebugInfo] = useState<string>('초기화 중...');
  const tokenRef = useRef<string | null>(null);
  const prevFavRef = useRef<string>('');
  const initDone = useRef(false);

  // Auto-initialize: if permission already granted, get/refresh token and sync
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    const supported = 'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setPushSupported(supported);

    if (!supported) { setDebugInfo('❌ 푸시 미지원 브라우저'); return; }
    if (Notification.permission !== 'granted') { setDebugInfo(`⚠️ 알림 권한: ${Notification.permission}`); return; }

    setDebugInfo('🔄 토큰 발급 중...');
    (async () => {
      try {
        if (!VAPID_KEY) { setDebugInfo('❌ VAPID key 없음'); return; }
        setDebugInfo(`🔑 VAPID: ${VAPID_KEY.slice(0, 10)}...`);
        const token = await registerAndGetToken();
        if (token) {
          tokenRef.current = token;
          localStorage.setItem(TOKEN_KEY, token);
          setPushEnabled(true);
          setDebugInfo(`✅ 토큰: ${token.slice(0, 15)}... 동기화 중...`);
          await syncSubscription(token, favorites);
          setDebugInfo(`✅ 동기화 완료 (즐겨찾기 ${favorites.length}명)`);
        } else {
          setDebugInfo('❌ 토큰 발급 실패 (null)');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setDebugInfo(`❌ 오류: ${msg.slice(0, 80)}`);
        const savedToken = localStorage.getItem(TOKEN_KEY);
        if (savedToken) {
          tokenRef.current = savedToken;
          setPushEnabled(true);
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync when favorites change (pushEnabled 상태와 무관하게 토큰이 있으면 동기화)
  useEffect(() => {
    const token = tokenRef.current || localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    const favKey = JSON.stringify(favorites);
    if (favKey === prevFavRef.current) return;
    prevFavRef.current = favKey;

    syncSubscription(token, favorites).catch(err => {
      console.error('[Push] Sync failed on favorites change:', err);
    });
  }, [favorites]);

  // Manual enable (button click from UI)
  const enablePush = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const token = await registerAndGetToken();
      if (!token) return false;

      tokenRef.current = token;
      localStorage.setItem(TOKEN_KEY, token);
      setPushEnabled(true);

      await syncSubscription(token, favorites);
      return true;
    } catch (err) {
      console.error('[Push] enablePush failed:', err);
      return false;
    }
  }, [favorites]);

  // Foreground message handler
  useEffect(() => {
    if (!pushEnabled) return;
    try {
      const messaging = getMessaging(app);
      const unsubscribe = onMessage(messaging, (payload) => {
        // Support both notification field and data-only messages
        const title = payload.notification?.title || payload.data?.title;
        const body = payload.notification?.body || payload.data?.body;
        if (title) {
          sendNotification(title, body || '');
        }
      });
      return unsubscribe;
    } catch {
      // Messaging not available
    }
  }, [pushEnabled]);

  return { pushEnabled, pushSupported, enablePush, debugInfo };
}
