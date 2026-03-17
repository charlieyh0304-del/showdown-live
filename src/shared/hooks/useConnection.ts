import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

export function useConnection() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const connectedRef = ref(database, '.info/connected');
    const unsub = onValue(connectedRef, (snap) => {
      setIsOnline(snap.val() === true);
    });
    return () => unsub();
  }, []);

  return isOnline;
}
