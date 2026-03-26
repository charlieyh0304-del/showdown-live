/* eslint-disable no-undef */
// Firebase Messaging Service Worker
// Handles background push notifications (iOS PWA + Android + Desktop)

importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging-compat.js');

// Firebase config - hardcoded for SW context (env vars not available in SW)
const firebaseConfig = {
  apiKey: 'AIzaSyCG8Jk9OSLjUkF130UYn4chfsGzJxAdrek',
  authDomain: 'showdown-b5cc7.firebaseapp.com',
  projectId: 'showdown-b5cc7',
  messagingSenderId: '1038346272318',
  appId: '1:1038346272318:web:2650e73ef4810b310fdb6f',
};

// Initialize Firebase immediately so background messages work after SW restart
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Handle background messages via Firebase SDK
messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const title = notification.title || '쇼다운 알림';
  const options = {
    body: notification.body || '',
    icon: notification.icon || '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    tag: payload.data?.tag || `showdown-${Date.now()}`,
    data: payload.data || {},
  };
  return self.registration.showNotification(title, options);
});

// Fallback: Handle raw push events (for cases where Firebase SDK doesn't intercept)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  // Skip if Firebase SDK already handled it (check if notification is already shown)
  if (data.fcmMessageId) return;

  const notification = data.notification || {};
  const title = notification.title || '쇼다운 알림';
  const options = {
    body: notification.body || '',
    icon: notification.icon || '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
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
