/* eslint-disable no-undef */
// Firebase Push Handler - imported by VitePWA's service worker
// Do NOT register this file separately as a service worker

const firebaseConfig = {
  apiKey: 'AIzaSyCG8Jk9OSLjUkF130UYn4chfsGzJxAdrek',
  authDomain: 'showdown-b5cc7.firebaseapp.com',
  projectId: 'showdown-b5cc7',
  messagingSenderId: '1038346272318',
  appId: '1:1038346272318:web:2650e73ef4810b310fdb6f',
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Show notification helper
function showNotificationFromData(data) {
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

// Handle background messages via Firebase SDK
messaging.onBackgroundMessage((payload) => {
  // If browser already showed notification from webpush.notification, skip
  if (payload.notification) return;
  // Data-only fallback: build notification from data field
  const data = payload.data || {};
  return showNotificationFromData(data);
});

// Fallback: Handle raw push events
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

  const notifData = data.data || data.notification || data;
  event.waitUntil(showNotificationFromData(notifData));
});

// Handle notification click - open the specific match
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
