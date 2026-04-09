/**
 * 서버 사이드 PIN 인증 엔드포인트
 *
 * 목적: 클라이언트 PIN 검증 제거 → 서버에서만 검증 + Firebase Custom Token 발급.
 * 클라이언트는 받은 토큰으로 signInWithCustomToken() 호출 → auth.currentUser.claims 에
 * { role: 'admin' | 'referee', subjectId } 가 주입됨. DB/Storage 규칙에서 이 claim을 근거로
 * 쓰기 권한 판단 가능.
 */
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { db } from "../db-helpers";
import { verifyPinAgainstStored, findAdminByPin } from "../lib/pin-verify";

// CORS 허용 도메인 (chatbot.ts와 동일 — 와일드카드 금지)
const ALLOWED_ORIGINS = [
  "https://showdown-b5cc7.web.app",
  "https://showdown-b5cc7.firebaseapp.com",
  "https://charlieyh0304-del.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
];

// ===== Rate limit (brute force 방어) =====
const RL_WINDOW_MS = 10 * 60 * 1000; // 10분
const RL_MAX_FAILS = 5;
const RL_LOCKOUT_MS = 15 * 60 * 1000; // 15분

interface RateLimitState {
  failures: number;
  firstFailAt: number;
  lockedUntil: number;
}

/** 잠겨있으면 남은 ms, 아니면 0 */
async function checkRateLimit(key: string): Promise<number> {
  const ref = db.ref(`auth/loginRateLimits/${key}`);
  const snap = await ref.once("value");
  if (!snap.exists()) return 0;
  const state = snap.val() as RateLimitState;
  const now = Date.now();
  if (state.lockedUntil && state.lockedUntil > now) {
    return state.lockedUntil - now;
  }
  if (state.lockedUntil && state.lockedUntil <= now) {
    await ref.remove();
  }
  return 0;
}

async function recordFailure(key: string): Promise<void> {
  const ref = db.ref(`auth/loginRateLimits/${key}`);
  const snap = await ref.once("value");
  const now = Date.now();
  const prev = snap.exists() ? (snap.val() as RateLimitState) : null;
  if (!prev || now - prev.firstFailAt > RL_WINDOW_MS) {
    await ref.set({ failures: 1, firstFailAt: now, lockedUntil: 0 });
    return;
  }
  const failures = prev.failures + 1;
  const lockedUntil = failures >= RL_MAX_FAILS ? now + RL_LOCKOUT_MS : 0;
  await ref.set({ failures, firstFailAt: prev.firstFailAt, lockedUntil });
}

async function clearRateLimit(key: string): Promise<void> {
  await db.ref(`auth/loginRateLimits/${key}`).remove();
}

// ===== CORS 처리 헬퍼 =====
function applyCors(req: import("express").Request, res: import("express").Response): boolean {
  const reqOrigin = req.headers.origin;
  if (typeof reqOrigin === "string" && ALLOWED_ORIGINS.includes(reqOrigin)) {
    res.set("Access-Control-Allow-Origin", reqOrigin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return false; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return false; }
  return true;
}

// ===== verifyAdminPin =====
// 입력: { pin: string }
// 응답: { customToken, adminId } | { error }
export const verifyAdminPin = onRequest(
  { cors: ALLOWED_ORIGINS, timeoutSeconds: 30, memory: "256MiB" },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    const { pin } = (req.body ?? {}) as { pin?: unknown };
    if (typeof pin !== "string" || pin.length === 0 || pin.length > 64) {
      res.status(400).json({ error: "PIN이 필요합니다." });
      return;
    }

    const rlKey = "admin";
    const lockedFor = await checkRateLimit(rlKey);
    if (lockedFor > 0) {
      const minutes = Math.ceil(lockedFor / 60000);
      res.status(429).json({ error: `PIN 시도가 너무 많습니다. ${minutes}분 후 다시 시도하세요.` });
      return;
    }

    try {
      // 1) admins 컬렉션 확인 (신규 다중 관리자 구조)
      const adminsSnap = await db.ref("admins").once("value");
      const admins = adminsSnap.exists()
        ? (adminsSnap.val() as Record<string, { pinHash?: string }>)
        : null;
      let adminId = findAdminByPin(admins, pin);

      // 2) 레거시 config/adminPin 확인
      if (!adminId) {
        const configSnap = await db.ref("config/adminPin").once("value");
        if (configSnap.exists()) {
          const stored = configSnap.val() as string;
          if (verifyPinAgainstStored(pin, stored)) {
            adminId = "legacy";
          }
        }
      }

      if (!adminId) {
        await recordFailure(rlKey);
        res.status(401).json({ error: "관리자 PIN이 올바르지 않습니다." });
        return;
      }

      await clearRateLimit(rlKey);

      // Firebase Custom Token 발급. uid는 "admin:{adminId}" 규칙.
      const uid = `admin:${adminId}`;
      const customToken = await admin.auth().createCustomToken(uid, {
        role: "admin",
        adminId,
      });

      logger.info("Admin login success", { adminId });
      res.json({ customToken, adminId });
    } catch (err: unknown) {
      const e = err as { message?: string };
      logger.error("verifyAdminPin failed", { error: e.message });
      res.status(500).json({ error: "서버 오류" });
    }
  },
);

// ===== verifyRefereePin =====
// 입력: { refereeId: string, pin: string }
// 응답: { customToken, refereeId } | { error }
export const verifyRefereePin = onRequest(
  { cors: ALLOWED_ORIGINS, timeoutSeconds: 30, memory: "256MiB" },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    const { refereeId, pin } = (req.body ?? {}) as { refereeId?: unknown; pin?: unknown };
    if (typeof refereeId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(refereeId)) {
      res.status(400).json({ error: "refereeId가 올바르지 않습니다." });
      return;
    }
    if (typeof pin !== "string" || pin.length === 0 || pin.length > 64) {
      res.status(400).json({ error: "PIN이 필요합니다." });
      return;
    }

    const rlKey = `referee:${refereeId}`;
    const lockedFor = await checkRateLimit(rlKey);
    if (lockedFor > 0) {
      const minutes = Math.ceil(lockedFor / 60000);
      res.status(429).json({ error: `PIN 시도가 너무 많습니다. ${minutes}분 후 다시 시도하세요.` });
      return;
    }

    try {
      const refSnap = await db.ref(`referees/${refereeId}`).once("value");
      if (!refSnap.exists()) {
        await recordFailure(rlKey);
        res.status(401).json({ error: "심판을 찾을 수 없습니다." });
        return;
      }
      const referee = refSnap.val() as { pin?: string; name?: string };
      if (!referee.pin || !verifyPinAgainstStored(pin, referee.pin)) {
        await recordFailure(rlKey);
        res.status(401).json({ error: "심판 PIN이 올바르지 않습니다." });
        return;
      }

      await clearRateLimit(rlKey);

      const uid = `referee:${refereeId}`;
      const customToken = await admin.auth().createCustomToken(uid, {
        role: "referee",
        refereeId,
      });

      logger.info("Referee login success", { refereeId });
      res.json({ customToken, refereeId, refereeName: referee.name ?? null });
    } catch (err: unknown) {
      const e = err as { message?: string };
      logger.error("verifyRefereePin failed", { error: e.message });
      res.status(500).json({ error: "서버 오류" });
    }
  },
);
