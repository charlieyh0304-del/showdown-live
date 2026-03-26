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

// Simple hash for token-based key (avoid special chars in Firebase path)
function tokenToKey(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return 'tk_' + Math.abs(hash).toString(36);
}

export function usePushNotifications(favoriteIds: string[]) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(true);
  const tokenRef = useRef<string | null>(null);
  const prevFavIdsRef = useRef<string>('');

  // Check if push is supported
  useEffect(() => {
    const supported = 'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setPushSupported(supported);

    // Check if already enabled
    if (supported && Notification.permission === 'granted') {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken) {
        tokenRef.current = savedToken;
        setPushEnabled(true);
      }
    }
  }, []);

  // Register the FCM service worker and get token
  const enablePush = useCallback(async (): Promise<boolean> => {
    try {
      if (!VAPID_KEY) {
        console.warn('VAPID key not configured');
        return false;
      }

      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      // Register FCM service worker
      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

      // Send Firebase config to SW
      if (swReg.active) {
        swReg.active.postMessage({
          type: 'FIREBASE_CONFIG',
          config: {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
            appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
          },
        });
      }

      // Get FCM token
      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swReg,
      });

      if (!token) return false;

      tokenRef.current = token;
      localStorage.setItem(TOKEN_KEY, token);
      setPushEnabled(true);

      // Save subscription to Firebase
      await syncSubscription(token, favoriteIds);

      return true;
    } catch (err) {
      console.error('Push notification setup failed:', err);
      return false;
    }
  }, [favoriteIds]);

  // Sync subscription to Firebase when favorites change
  useEffect(() => {
    const token = tokenRef.current;
    if (!token || !pushEnabled) return;

    const favKey = JSON.stringify(favoriteIds);
    if (favKey === prevFavIdsRef.current) return;
    prevFavIdsRef.current = favKey;

    syncSubscription(token, favoriteIds);
  }, [favoriteIds, pushEnabled]);

  // Handle foreground messages - show in-app toast
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

async function syncSubscription(token: string, favoriteIds: string[]) {
  const key = tokenToKey(token);
  const subRef = ref(database, `pushSubscriptions/${key}`);
  await set(subRef, {
    token,
    favoriteIds,
    platform: getPlatform(),
    updatedAt: Date.now(),
  });
}
