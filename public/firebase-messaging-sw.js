/* eslint-disable no-undef */
// Firebase Messaging Service Worker
// Handles background push notifications (iOS PWA + Android + Desktop)
// Uses data-only messages for reliable delivery on all platforms

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

// Show notification helper - used by both handlers
function showNotificationFromData(data) {
  const title = data.title || '쇼다운 알림';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-96.png',
    tag: data.tag || `showdown-${Date.now()}`,
    data: { link: data.link || '/spectator' },
    requireInteraction: true,
    // iOS Safari PWA needs renotify to vibrate/sound on same tag
    renotify: true,
  };
  return self.registration.showNotification(title, options);
}

// Handle background messages via Firebase SDK (data-only messages)
messaging.onBackgroundMessage((payload) => {
  // Data-only message: notification info is in payload.data
  const data = payload.data || {};
  // If there's also a notification field (shouldn't happen with our setup), skip SW handling
  if (payload.notification) return;
  return showNotificationFromData(data);
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

  // Skip if Firebase SDK already handled it
  if (data.fcmMessageId) return;

  // Handle data from raw push or nested data field
  const notifData = data.data || data.notification || data;
  event.waitUntil(showNotificationFromData(notifData));
});

// Handle notification click - open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const link = event.notification.data?.link || '/spectator';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes('/spectator') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(link);
    })
  );
});
