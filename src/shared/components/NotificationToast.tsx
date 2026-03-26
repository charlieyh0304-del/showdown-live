import { useEffect, useState, useCallback } from 'react';
import { onInAppNotification, type InAppNotification } from '@shared/utils/notifications';

export default function NotificationToast() {
  const [notifications, setNotifications] = useState<(InAppNotification & { id: number })[]>([]);

  useEffect(() => {
    return onInAppNotification((notif) => {
      const id = Date.now();
      setNotifications((prev) => [...prev, { ...notif, id }]);
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 5000);
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div style={{ position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, width: '90%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {notifications.map((n) => (
        <div
          key={n.id}
          role="alert"
          aria-live="assertive"
          onClick={() => dismiss(n.id)}
          style={{
            backgroundColor: '#1e3a5f',
            border: '1px solid #3b82f6',
            color: '#e0e7ff',
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            cursor: 'pointer',
            animation: 'slideDown 0.3s ease-out',
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{n.title}</div>
          {n.body && <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', opacity: 0.85 }}>{n.body}</div>}
        </div>
      ))}
    </div>
  );
}
