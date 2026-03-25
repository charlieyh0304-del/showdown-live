import { useState, useEffect, useCallback } from 'react';
import { ref, get } from 'firebase/database';
import { database } from '../config/firebase';
import { verifyPin } from '../utils/crypto';
import type { AuthSession, Referee, Admin } from '../types';

const AUTH_KEY = 'showdown_auth';
const LOGIN_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('NETWORK_TIMEOUT')), ms)
    ),
  ]);
}

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

  // 관리자 인증 (다중 관리자 지원 + 레거시 단일 PIN 호환)
  const loginAdmin = useCallback(async (pin: string): Promise<boolean> => {
    return withTimeout(async function doLogin() {
      // 1차: admins/ 컬렉션에서 확인
      const adminsSnap = await get(ref(database, 'admins'));
      if (adminsSnap.exists()) {
        const admins = adminsSnap.val() as Record<string, Admin>;
        for (const [id, admin] of Object.entries(admins)) {
          const valid = await verifyPin(pin, admin.pin);
          if (valid) {
            saveSession({
              mode: 'admin',
              adminId: id,
              adminName: admin.name,
              authenticatedAt: Date.now(),
            });
            return true;
          }
        }
      }

      // 2차: 레거시 config/adminPin에서 확인 (기존 호환)
      const configSnap = await get(ref(database, 'config/adminPin'));
      if (configSnap.exists()) {
        const hashedPin = configSnap.val() as string;
        const valid = await verifyPin(pin, hashedPin);
        if (valid) {
          saveSession({
            mode: 'admin',
            adminName: '관리자',
            authenticatedAt: Date.now(),
          });
          return true;
        }
      }

      return false;
    }(), LOGIN_TIMEOUT_MS);
  }, [saveSession]);

  // 심판 인증
  const loginReferee = useCallback(async (refereeId: string, pin: string, tournamentId?: string): Promise<boolean> => {
    return withTimeout(async function doLogin() {
      const refereeRef = ref(database, `referees/${refereeId}`);
      const snapshot = await get(refereeRef);
      const referee = snapshot.val() as Referee | null;
      if (!referee?.pin) {
        return false;
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
      return valid;
    }(), LOGIN_TIMEOUT_MS);
  }, [saveSession]);

  const logout = useCallback(() => {
    saveSession(null);
  }, [saveSession]);

  const isAdmin = session?.mode === 'admin';
  const isReferee = session?.mode === 'referee';

  return { session, isAdmin, isReferee, loginAdmin, loginReferee, logout };
}

// 관리자 PIN 설정 여부 확인 (admins/ 또는 config/adminPin 존재)
export function useAdminPinExists() {
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const adminsSnap = await get(ref(database, 'admins'));
      if (!cancelled && adminsSnap.exists()) {
        setExists(true);
        return;
      }
      const configSnap = await get(ref(database, 'config/adminPin'));
      if (!cancelled) setExists(!!configSnap.val());
    }
    check();
    return () => { cancelled = true; };
  }, []);

  return exists;
}
