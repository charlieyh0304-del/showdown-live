import { useEffect, useCallback, useState } from 'react';
import { getMessaging, getToken, deleteToken, onMessage } from 'firebase/messaging';
import { ref, set, remove } from 'firebase/database';
import app, { database, auth, authReady } from '@shared/config/firebase';
import { sendNotification } from '@shared/utils/notifications';
import { pushSubscriptionRecord, tokenToKey, type FavEntry } from '@shared/utils/pushSubscription';

/**
 * 즐겨찾기 선수 경기 알림(FCM 푸시, 앱을 닫아도 온다): 경기 10분 전·시작·결과.
 * - 기본 꺼짐. 사용자가 설정에서 켤 때만 브라우저 권한을 묻고 구독한다(opt-in).
 * - 서버(pushSubscriptions/{tokenKey})에는 토큰과 즐겨찾기 선수 ID·이름만 저장한다(공개 읽기 없음). 이름은 대회마다 다른 선수 ID를 넘어 맞추는 데 쓴다.
 * - 끄면 토큰을 지우고 구독 기록도 지운다.
 * 상태는 모듈 하나가 갖고, 여러 화면(알림 감시, 설정, 즐겨찾기 화면)이 같은 값을 본다.
 */
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
const TOKEN_KEY = 'showdown_fcm_token';
const PREV_TOKEN_KEY = 'showdown_fcm_prev_token';
const OPT_IN_KEY = 'showdown_push_optin';

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function lsDel(k: string): void { try { localStorage.removeItem(k); } catch { /* ignore */ } }

function getPlatform(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** 사용자가 알림을 켰는가 (예전에 이미 토큰을 받은 기기는 켠 것으로 본다) */
export function isPushOptedIn(): boolean {
  const v = lsGet(OPT_IN_KEY);
  if (v === '1') return true;
  if (v === '0') return false;
  return !!lsGet(TOKEN_KEY);
}

type PushState = { enabled: boolean };
const listeners = new Set<(s: PushState) => void>();
let state: PushState = { enabled: false };
function setState(next: PushState) { state = next; listeners.forEach(l => l(next)); }

async function syncSubscription(token: string, favorites: FavEntry[]) {
  await authReady;
  const key = tokenToKey(token);
  const prevToken = lsGet(PREV_TOKEN_KEY);
  if (prevToken && prevToken !== token && tokenToKey(prevToken) !== key) {
    try { await remove(ref(database, `pushSubscriptions/${tokenToKey(prevToken)}`)); } catch (e) { console.warn('[Push] Failed to remove old subscription:', e); }
  }
  lsSet(PREV_TOKEN_KEY, token);
  await set(ref(database, `pushSubscriptions/${key}`), pushSubscriptionRecord(token, auth.currentUser?.uid || '', favorites, getPlatform(), Date.now()));
}

async function cleanupOldServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const reg of registrations) {
    if (reg.active?.scriptURL?.includes('firebase-messaging-sw.js')) await reg.unregister();
  }
}

async function registerAndGetToken(): Promise<string | null> {
  if (!VAPID_KEY) { console.error('[Push] VAPID key not configured!'); return null; }
  await cleanupOldServiceWorkers();
  const swReg = await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);
  const migrationKey = 'showdown_sw_migrated_v3';
  if (!lsGet(migrationKey)) {
    try { await deleteToken(messaging); lsDel(TOKEN_KEY); } catch (e) { console.warn('[Push] Token migration cleanup:', e); }
    lsSet(migrationKey, '1');
  }
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
  return token || null;
}

let lastSyncedFavs = '';
let initStarted = false;

/** 알림 켜기 (사용자 동작에서만 부른다: 권한 요청) */
export async function enablePushNotifications(favorites: FavEntry[]): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;
    const token = await registerAndGetToken();
    if (!token) return false;
    lsSet(TOKEN_KEY, token);
    lsSet(OPT_IN_KEY, '1');
    await syncSubscription(token, favorites);
    lastSyncedFavs = JSON.stringify(favorites.map(f => [f.id, f.name]));
    setState({ enabled: true });
    return true;
  } catch (err) {
    console.error('[Push] enable failed:', err);
    return false;
  }
}

/** 알림 끄기: 서버 구독 기록과 토큰을 지운다 */
export async function disablePushNotifications(): Promise<void> {
  lsSet(OPT_IN_KEY, '0');
  const token = lsGet(TOKEN_KEY);
  setState({ enabled: false });
  if (!token) return;
  try { await authReady; await remove(ref(database, `pushSubscriptions/${tokenToKey(token)}`)); } catch (e) { console.warn('[Push] remove subscription failed:', e); }
  try { if (isPushSupported()) await deleteToken(getMessaging(app)); } catch { /* ignore */ }
  lsDel(TOKEN_KEY);
  lsDel(PREV_TOKEN_KEY);
}

export function usePushNotifications(favorites: FavEntry[]) {
  const [pushEnabled, setPushEnabled] = useState(state.enabled);
  const pushSupported = isPushSupported();

  useEffect(() => {
    const l = (s: PushState) => setPushEnabled(s.enabled);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  // 켠 기기만: 권한이 있으면 토큰을 갱신하고 즐겨찾기를 동기화한다 (권한을 새로 묻지 않는다)
  useEffect(() => {
    if (initStarted || !pushSupported || !isPushOptedIn()) return;
    if (Notification.permission !== 'granted') return;
    initStarted = true;
    (async () => {
      try {
        const token = await registerAndGetToken();
        if (!token) return;
        lsSet(TOKEN_KEY, token);
        setState({ enabled: true });
        await syncSubscription(token, favorites);
        lastSyncedFavs = JSON.stringify(favorites.map(f => [f.id, f.name]));
      } catch (err) {
        console.warn('[Push] init failed:', err);
        if (lsGet(TOKEN_KEY)) setState({ enabled: true });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 즐겨찾기가 바뀌면 다시 동기화 (켠 상태에서만)
  useEffect(() => {
    if (!state.enabled) return;
    const token = lsGet(TOKEN_KEY);
    if (!token) return;
    const key = JSON.stringify(favorites.map(f => [f.id, f.name]));
    if (key === lastSyncedFavs) return;
    lastSyncedFavs = key;
    syncSubscription(token, favorites).catch(err => console.error('[Push] Sync failed on favorites change:', err));
  }, [favorites, pushEnabled]);

  const enablePush = useCallback(() => enablePushNotifications(favorites), [favorites]);
  const disablePush = useCallback(() => disablePushNotifications(), []);

  // 앱이 열려 있을 때 온 푸시는 앱 안 알림으로 보여 준다
  useEffect(() => {
    if (!pushEnabled) return;
    try {
      const messaging = getMessaging(app);
      return onMessage(messaging, (payload) => {
        const title = payload.notification?.title || payload.data?.title;
        const body = payload.notification?.body || payload.data?.body;
        if (title) sendNotification(title, body || '');
      });
    } catch {
      return undefined;
    }
  }, [pushEnabled]);

  return { pushEnabled, pushSupported, enablePush, disablePush };
}
