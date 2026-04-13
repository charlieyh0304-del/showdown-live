import { useState, useEffect, useCallback } from 'react';
import { ref, get } from 'firebase/database';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { database, auth } from '../config/firebase';
import type { AuthSession } from '../types';

const AUTH_KEY = 'showdown_auth';
const LOGIN_TIMEOUT_MS = 15000;

// 서버 사이드 PIN 검증 엔드포인트 (functions/src/handlers/auth.ts)
// 프로젝트 ID 기반으로 자동 결정 — staging/production 자동 전환
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'showdown-b5cc7';
const FUNCTIONS_BASE = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
const VERIFY_ADMIN_URL = `${FUNCTIONS_BASE}/verifyAdminPin`;
const VERIFY_REFEREE_URL = `${FUNCTIONS_BASE}/verifyRefereePin`;

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
      // 서버가 adminName을 함께 반환 → 추가 DB 조회 불필요
      const adminName = (data.adminName as string | null) ?? '관리자';
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

  const logout = useCallback(async () => {
    saveSession(null);
    try {
      await signOut(auth);
    } catch { /* 오프라인 등 실패 시 무시 — 세션은 이미 정리됨 */ }
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
