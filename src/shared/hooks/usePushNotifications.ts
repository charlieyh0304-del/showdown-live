import { useEffect, useRef, useCallback, useState } from 'react';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { ref, set } from 'firebase/database';
import app, { database } from '@shared/config/firebase';
import { sendNotification } from '@shared/utils/notifications';

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

async function syncSubscription(token: string, favoriteIds: string[]) {
  const key = tokenToKey(token);
  const subRef = ref(database, `pushSubscriptions/${key}`);
  await set(subRef, {
    token,
    favoriteIds,
    platform: getPlatform(),
    updatedAt: Date.now(),
  });
  console.log('[Push] Synced subscription to Firebase:', key, 'favorites:', favoriteIds.length);
}

async function registerAndGetToken(): Promise<string | null> {
  if (!VAPID_KEY) {
    console.error('[Push] VAPID key not configured!');
    return null;
  }

  // Register FCM service worker
  const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

  // Wait for SW to be ready (handles installing/waiting/active states)
  if (!swReg.active) {
    await navigator.serviceWorker.ready;
  }

  // Get FCM token
  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: swReg,
  });

  return token || null;
}

export function usePushNotifications(favoriteIds: string[]) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(true);
  const tokenRef = useRef<string | null>(null);
  const prevFavIdsRef = useRef<string>('');
  const initDone = useRef(false);

  // Auto-initialize: if permission already granted, get/refresh token and sync
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    const supported = 'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setPushSupported(supported);

    if (!supported || Notification.permission !== 'granted') return;

    // Auto-register FCM token (not just read from localStorage)
    (async () => {
      try {
        const token = await registerAndGetToken();
        if (token) {
          tokenRef.current = token;
          localStorage.setItem(TOKEN_KEY, token);
          setPushEnabled(true);
          // Sync with current favoriteIds (may be empty initially, will re-sync when favorites load)
          await syncSubscription(token, favoriteIds);
        }
      } catch (err) {
        console.error('[Push] Auto-init failed:', err);
        // Fallback: use saved token if available
        const savedToken = localStorage.getItem(TOKEN_KEY);
        if (savedToken) {
          tokenRef.current = savedToken;
          setPushEnabled(true);
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync when favoriteIds change (handles the "initially empty" problem)
  useEffect(() => {
    const token = tokenRef.current;
    if (!token || !pushEnabled) return;

    const favKey = JSON.stringify(favoriteIds);
    if (favKey === prevFavIdsRef.current) return;
    prevFavIdsRef.current = favKey;

    syncSubscription(token, favoriteIds).catch(err => {
      console.error('[Push] Sync failed on favorites change:', err);
    });
  }, [favoriteIds, pushEnabled]);

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

      await syncSubscription(token, favoriteIds);
      return true;
    } catch (err) {
      console.error('[Push] enablePush failed:', err);
      return false;
    }
  }, [favoriteIds]);

  // Foreground message handler
  useEffect(() => {
    if (!pushEnabled) return;
    try {
      const messaging = getMessaging(app);
      const unsubscribe = onMessage(messaging, (payload) => {
        const { title, body } = payload.notification || {};
        if (title) {
          sendNotification(title, body || '');
        }
      });
      return unsubscribe;
    } catch {
      // Messaging not available
    }
  }, [pushEnabled]);

  return { pushEnabled, pushSupported, enablePush };
}
