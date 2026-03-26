export interface InAppNotification {
  title: string;
  body: string;
}

type NotificationListener = (notif: InAppNotification) => void;
const listeners: Set<NotificationListener> = new Set();

export function onInAppNotification(cb: NotificationListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emitInApp(title: string, body: string) {
  listeners.forEach((cb) => cb({ title, body }));
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function sendNotification(title: string, body: string, tag?: string): void {
  const canUseOSNotification = 'Notification' in window && Notification.permission === 'granted';

  if (!canUseOSNotification) {
    emitInApp(title, body);
    return;
  }

  const notifTag = tag || `showdown-${Date.now()}`;
  const options: NotificationOptions = {
    body,
    tag: notifTag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
  };

  // Try Service Worker notification first (works on mobile + background)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) {
        reg.showNotification(title, options).catch(() => {
          // SW notification failed (common on iOS) - use in-app fallback
          emitInApp(title, body);
        });
      } else {
        // No service worker - try direct Notification, fallback to in-app
        try { new Notification(title, options); } catch { emitInApp(title, body); }
      }
    }).catch(() => {
      try { new Notification(title, options); } catch { emitInApp(title, body); }
    });
  } else {
    try { new Notification(title, options); } catch { emitInApp(title, body); }
  }
}

export function getNotificationPermissionStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
