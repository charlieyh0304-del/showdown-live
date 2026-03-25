import { useState, useEffect, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting' | 'reconnected';

export function useConnection() {
  const [isOnline, setIsOnline] = useState(true);
  const [status, setStatus] = useState<ConnectionStatus>('online');
  const wasOfflineRef = useRef(false);
  const reconnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const connectedRef = ref(database, '.info/connected');
    const unsub = onValue(connectedRef, (snap) => {
      const connected = snap.val() === true;
      setIsOnline(connected);

      if (!connected) {
        wasOfflineRef.current = true;
        setStatus('offline');
        // Clear any pending reconnected timer
        if (reconnectedTimerRef.current) {
          clearTimeout(reconnectedTimerRef.current);
          reconnectedTimerRef.current = null;
        }
      } else if (wasOfflineRef.current) {
        // Was offline, now back online
        wasOfflineRef.current = false;
        setStatus('reconnected');
        // Show "reconnected" briefly, then go back to online
        reconnectedTimerRef.current = setTimeout(() => {
          setStatus('online');
          reconnectedTimerRef.current = null;
        }, 3000);
      } else {
        setStatus('online');
      }
    });
    return () => {
      unsub();
      if (reconnectedTimerRef.current) {
        clearTimeout(reconnectedTimerRef.current);
      }
    };
  }, []);

  return { isOnline, status };
}

/** Backward-compatible hook that returns just the boolean */
export function useIsOnline(): boolean {
  const { isOnline } = useConnection();
  return isOnline;
}
