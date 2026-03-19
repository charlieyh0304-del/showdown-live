export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function sendNotification(title: string, body: string, tag?: string): void {
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      tag: tag || `showdown-${Date.now()}`,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
    });
  } catch {
    // Service worker notification fallback
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        body,
        tag,
      });
    }
  }
}

export function getNotificationPermissionStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
