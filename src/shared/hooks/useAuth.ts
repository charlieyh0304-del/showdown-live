import { useState, useEffect, useCallback } from 'react';
import { ref, get } from 'firebase/database';
import { signInWithCustomToken } from 'firebase/auth';
import { database, auth } from '../config/firebase';
import type { AuthSession } from '../types';

const AUTH_KEY = 'showdown_auth';
const LOGIN_TIMEOUT_MS = 15000;

// 서버 사이드 PIN 검증 엔드포인트 (functions/src/handlers/auth.ts)
const VERIFY_ADMIN_URL = 'https://us-central1-showdown-b5cc7.cloudfunctions.net/verifyAdminPin';
const VERIFY_REFEREE_URL = 'https://us-central1-showdown-b5cc7.cloudfunctions.net/verifyRefereePin';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('NETWORK_TIMEOUT')), ms)
    ),
  ]);
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, data };
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

  // 관리자 인증 — 서버 엔드포인트로 PIN 검증 + Custom Token으로 Firebase Auth 로그인
  const loginAdmin = useCallback(async (pin: string): Promise<boolean> => {
    return withTimeout(async function doLogin() {
      const { ok, data } = await postJson(VERIFY_ADMIN_URL, { pin });
      if (!ok) return false;
      const customToken = data.customToken as string | undefined;
      const adminId = data.adminId as string | undefined;
      if (!customToken || !adminId) return false;
      try {
        await signInWithCustomToken(auth, customToken);
      } catch {
        return false;
      }
      // 관리자 이름은 admins/{id}/name 에서 읽기 (서버는 id만 반환)
      let adminName = '관리자';
      if (adminId !== 'legacy') {
        try {
          const nameSnap = await get(ref(database, `admins/${adminId}/name`));
          if (nameSnap.exists()) adminName = String(nameSnap.val());
        } catch { /* ignore */ }
      }
      saveSession({
        mode: 'admin',
        adminId: adminId === 'legacy' ? undefined : adminId,
        adminName,
        authenticatedAt: Date.now(),
      });
      return true;
    }(), LOGIN_TIMEOUT_MS);
  }, [saveSession]);

  // 심판 인증 — 서버 엔드포인트로 PIN 검증 + Custom Token 로그인
  const loginReferee = useCallback(async (refereeId: string, pin: string, tournamentId?: string): Promise<boolean> => {
    return withTimeout(async function doLogin() {
      const { ok, data } = await postJson(VERIFY_REFEREE_URL, { refereeId, pin });
      if (!ok) return false;
      const customToken = data.customToken as string | undefined;
      if (!customToken) return false;
      try {
        await signInWithCustomToken(auth, customToken);
      } catch {
        return false;
      }
      const refereeName = (data.refereeName as string | null | undefined) ?? refereeId;
      saveSession({
        mode: 'referee',
        refereeId,
        refereeName,
        tournamentId,
        authenticatedAt: Date.now(),
      });
      return true;
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
