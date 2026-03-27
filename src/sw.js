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
  apiKey: 'AIzaSyCG8Jk9OSLjUkF130UYn4chfsGzJxAdrek',
  authDomain: 'showdown-b5cc7.firebaseapp.com',
  projectId: 'showdown-b5cc7',
  messagingSenderId: '1038346272318',
  appId: '1:1038346272318:web:2650e73ef4810b310fdb6f',
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
  };
  return self.registration.showNotification(title, options);
}

// Firebase SDK 백그라운드 메시지 핸들러 (data-only 메시지 → SW가 직접 표시)
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || payload.notification || {};
  return showPushNotification(data);
});

// Raw push 이벤트 폴백 (Firebase SDK가 처리하지 못한 경우)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  // Firebase SDK가 이미 처리한 경우 스킵
  if (data.fcmMessageId) return;

  const notifData = data.data || data.notification || data;
  event.waitUntil(showPushNotification(notifData));
});

// 알림 클릭 → 해당 경기 관람 화면으로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const link = event.notification.data?.link || '/spectator';

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
