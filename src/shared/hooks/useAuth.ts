import { useState, useEffect, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';
import { verifyPin } from '../utils/crypto';
import type { AuthSession, Referee } from '../types';

const AUTH_KEY = 'showdown_auth';

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const stored = sessionStorage.getItem(AUTH_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const saveSession = useCallback((s: AuthSession | null) => {
    setSession(s);
    if (s) {
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(s));
    } else {
      sessionStorage.removeItem(AUTH_KEY);
    }
  }, []);

  // 관리자 인증
  const loginAdmin = useCallback(async (pin: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const configRef = ref(database, 'config/adminPin');
      onValue(configRef, async (snapshot) => {
        const hashedPin = snapshot.val();
        if (!hashedPin) {
          resolve(false);
          return;
        }
        const valid = await verifyPin(pin, hashedPin);
        if (valid) {
          saveSession({ mode: 'admin', authenticatedAt: Date.now() });
        }
        resolve(valid);
      }, { onlyOnce: true });
    });
  }, [saveSession]);

  // 심판 인증
  const loginReferee = useCallback(async (refereeId: string, pin: string, tournamentId?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const refereeRef = ref(database, `referees/${refereeId}`);
      onValue(refereeRef, async (snapshot) => {
        const referee = snapshot.val() as Referee | null;
        if (!referee?.pin) {
          resolve(false);
          return;
        }
        const valid = await verifyPin(pin, referee.pin);
        if (valid) {
          saveSession({
            mode: 'referee',
            refereeId,
            refereeName: referee.name,
            tournamentId,
            authenticatedAt: Date.now(),
          });
        }
        resolve(valid);
      }, { onlyOnce: true });
    });
  }, [saveSession]);

  const logout = useCallback(() => {
    saveSession(null);
  }, [saveSession]);

  const isAdmin = session?.mode === 'admin';
  const isReferee = session?.mode === 'referee';

  return { session, isAdmin, isReferee, loginAdmin, loginReferee, logout };
}

// 관리자 PIN 설정 여부 확인
export function useAdminPinExists() {
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    const configRef = ref(database, 'config/adminPin');
    const unsub = onValue(configRef, (snapshot) => {
      setExists(!!snapshot.val());
    });
    return () => unsub();
  }, []);

  return exists;
}
