/* eslint-disable no-undef */
/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

// ===== 1. Workbox: 캐싱 =====
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

// HTML (navigation): 항상 네트워크 우선 (최신 JS 해시 참조 보장)
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'html-cache',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 5, maxAgeSeconds: 86400 })],
  })
);

// JS/CSS: 캐시 우선 (Vite가 해시 파일명 사용하므로 안전)
registerRoute(
  /\.(?:js|css)$/,
  new CacheFirst({
    cacheName: 'app-code-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 86400 })],
  })
);

// Firebase API: 네트워크 우선
registerRoute(
  /^https:\/\/.*firebaseio\.com/,
  new NetworkFirst({
    cacheName: 'firebase-cache',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 300 })],
  })
);

// Google APIs: 캐시 우선
registerRoute(
  /^https:\/\/.*googleapis\.com/,
  new CacheFirst({
    cacheName: 'google-api-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 604800 })],
  })
);

// 정적 에셋: 캐시 우선
registerRoute(
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/,
  new CacheFirst({
    cacheName: 'static-assets-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 604800 })],
  })
);

// ===== 2. Firebase Messaging: 푸시 알림 =====
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: __FIREBASE_API_KEY__,
  authDomain: __FIREBASE_AUTH_DOMAIN__,
  projectId: __FIREBASE_PROJECT_ID__,
  messagingSenderId: __FIREBASE_MESSAGING_SENDER_ID__,
  appId: __FIREBASE_APP_ID__,
});

const messaging = firebase.messaging();

// 알림 표시 헬퍼
function showPushNotification(data) {
  const title = data.title || '쇼다운 알림';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-96.png',
    tag: data.tag || `showdown-${Date.now()}`,
    data: { link: data.link || '/spectator' },
    requireInteraction: true,
    renotify: true,
    vibrate: [200, 100, 200],
    silent: false,
  };
  return self.registration.showNotification(title, options);
}

// 중복 표시 방지: 최근 표시한 tag 추적
const recentTags = new Set();

function showOnce(data) {
  const tag = data.tag || `showdown-${Date.now()}`;
  if (recentTags.has(tag)) return Promise.resolve();
  recentTags.add(tag);
  setTimeout(() => recentTags.delete(tag), 30000);
  return showPushNotification({ ...data, tag });
}

// Firebase SDK 백그라운드 메시지 핸들러 (data-only 메시지)
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] onBackgroundMessage:', JSON.stringify(payload));
  const data = payload.data || {};
  return showOnce(data);
});

// Raw push 이벤트 폴백 (onBackgroundMessage 미처리 시 안전장치)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  const notifData = data.data || data;
  if (!notifData.title) return;

  event.waitUntil(showOnce(notifData));
});

// 알림 클릭 → 해당 경기 관람 화면으로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // data.link (SW 생성 알림) → fcmOptions.link (브라우저 자동 알림) → 기본값
  const link = event.notification.data?.link
    || event.notification?.fcmOptions?.link
    || event.action
    || '/spectator';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    })
  );
});
