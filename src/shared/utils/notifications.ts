export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function sendNotification(title: string, body: string, tag?: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
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
          // Fallback to direct Notification constructor (desktop)
          try { new Notification(title, options); } catch { /* ignore */ }
        });
      } else {
        try { new Notification(title, options); } catch { /* ignore */ }
      }
    }).catch(() => {
      try { new Notification(title, options); } catch { /* ignore */ }
    });
  } else {
    try { new Notification(title, options); } catch { /* ignore */ }
  }
}

export function getNotificationPermissionStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
