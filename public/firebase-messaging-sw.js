/* eslint-disable no-undef */
// Firebase Messaging Service Worker
// Handles background push notifications (iOS PWA + Android + Desktop)

importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging-compat.js');

// Firebase config is injected at runtime via the client
// The SW receives it from the initial postMessage call
let firebaseConfig = null;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    firebaseConfig = event.data.config;
    firebase.initializeApp(firebaseConfig);
    firebase.messaging();
  }
});

// Handle background messages (when app is not in foreground)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  const notification = data.notification || {};
  const title = notification.title || '쇼다운 알림';
  const options = {
    body: notification.body || '',
    icon: notification.icon || '/icons/icon-192.png',
    badge: notification.badge || '/icons/icon-96.png',
    tag: data.data?.tag || `showdown-${Date.now()}`,
    data: data.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click - open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes('/spectator') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow('/spectator');
    })
  );
});
