/**
 * Tournament CRUD 핸들러
 */
import { db, hashPinSHA256, hashPinPBKDF2 } from "../db-helpers";

// ===== PIN brute force 방어: RTDB 기반 rate limiter =====
const RL_WINDOW_MS = 10 * 60 * 1000;   // 10분 윈도우
const RL_MAX_FAILS = 5;                 // 윈도우 내 최대 실패
const RL_LOCKOUT_MS = 15 * 60 * 1000;   // 잠금 15분

interface RateLimitState {
  failures: number;
  firstFailAt: number;
  lockedUntil: number;
}

/** 잠겨있으면 남은 ms 반환, 아니면 0 */
async function checkRateLimit(tid: string): Promise<number> {
  const snap = await db.ref(`auth/rateLimits/${tid}`).once("value");
  if (!snap.exists()) return 0;
  const state = snap.val() as RateLimitState;
  const now = Date.now();
  if (state.lockedUntil && state.lockedUntil > now) {
    return state.lockedUntil - now;
  }
  // 잠금 만료 → lazy 정리
  if (state.lockedUntil && state.lockedUntil <= now) {
    await db.ref(`auth/rateLimits/${tid}`).remove();
  }
  return 0;
}

async function recordFailure(tid: string): Promise<void> {
  const ref = db.ref(`auth/rateLimits/${tid}`);
  const snap = await ref.once("value");
  const now = Date.now();
  const prev = snap.exists() ? (snap.val() as RateLimitState) : null;
  // 윈도우가 만료됐으면 카운터 리셋
  if (!prev || now - prev.firstFailAt > RL_WINDOW_MS) {
    await ref.set({ failures: 1, firstFailAt: now, lockedUntil: 0 });
    return;
  }
  const failures = prev.failures + 1;
  const lockedUntil = failures >= RL_MAX_FAILS ? now + RL_LOCKOUT_MS : 0;
  await ref.set({ failures, firstFailAt: prev.firstFailAt, lockedUntil });
}

async function clearRateLimit(tid: string): Promise<void> {
  await db.ref(`auth/rateLimits/${tid}`).remove();
}

export async function createTournament(input: Record<string, unknown>): Promise<string> {
  const now = Date.now();
  if (input.name) {
    const ctExisting = await db.ref("tournaments").once("value");
    if (ctExisting.exists()) {
      for (const [eid, ev] of Object.entries(ctExisting.val() as Record<string, { name?: string }>)) {
        if (ev.name === input.name) {
          return JSON.stringify({ error: `"${input.name}" 대회가 이미 존재합니다 (ID: ${eid}). 삭제 후 다시 생성하거나 다른 이름을 사용하세요.` });
        }
      }
    }
  }
  const newRef = db.ref("tournaments").push();
  const data = {
    name: input.name || "새 대회",
    date: input.date || new Date().toISOString().split("T")[0],
    ...(input.endDate ? { endDate: input.endDate } : {}),
    type: input.type || "individual",
    format: "full_league",
    formatType: input.formatType || "round_robin",
    status: "draft",
    gameConfig: {
      winScore: input.winScore || 11,
      setsToWin: input.setsToWin || 3,
    },
    createdAt: now,
    updatedAt: now,
  };
  await newRef.set(data);
  return JSON.stringify({ success: true, tournamentId: newRef.key, message: `대회 "${data.name}" 생성 완료` });
}

export async function updateTournament(input: Record<string, unknown>): Promise<string> {
  const { tournamentId, rankingUpTo, thirdPlace, fifthToEighth, classificationGroups, ...fields } = input;
  const updates: Record<string, unknown> = { ...fields, updatedAt: Date.now() };
  delete updates.tournamentId;

  // rankingMatchConfig 부분 업데이트
  if (rankingUpTo !== undefined || thirdPlace !== undefined || fifthToEighth !== undefined || classificationGroups !== undefined) {
    const curSnap = await db.ref(`tournaments/${tournamentId}`).once("value");
    const curData = curSnap.exists() ? curSnap.val() as Record<string, unknown> : {};
    const curCfg = (curData.rankingMatchConfig as Record<string, unknown>) || {
      enabled: false, thirdPlace: false, fifthToEighth: false,
      fifthToEighthFormat: "simple", classificationGroups: false, classificationGroupSize: 4,
    };
    const newCfg = { ...curCfg };
    if (thirdPlace !== undefined) newCfg.thirdPlace = thirdPlace as boolean;
    if (fifthToEighth !== undefined) newCfg.fifthToEighth = fifthToEighth as boolean;
    if (classificationGroups !== undefined) newCfg.classificationGroups = classificationGroups as boolean;
    if (rankingUpTo !== undefined) newCfg.rankingUpTo = rankingUpTo as number;
    newCfg.enabled = !!(newCfg.thirdPlace || newCfg.fifthToEighth || newCfg.classificationGroups || (newCfg.rankingUpTo as number) > 0);
    updates.rankingMatchConfig = newCfg;
  }

  await db.ref(`tournaments/${tournamentId}`).update(updates);
  return JSON.stringify({ success: true, message: "대회 정보 수정 완료" });
}

export async function deleteTournament(tid: string, pin: string): Promise<string> {
  const tourCheck = await db.ref(`tournaments/${tid}`).once("value");
  if (!tourCheck.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });

  // Brute force 방어: 잠금 상태 먼저 확인
  const lockedFor = await checkRateLimit(tid);
  if (lockedFor > 0) {
    const minutes = Math.ceil(lockedFor / 60000);
    return JSON.stringify({ error: `PIN 시도가 너무 많습니다. ${minutes}분 후 다시 시도하세요.` });
  }

  // PIN 검증
  const adminsSnap = await db.ref("admins").once("value");
  const configSnap = await db.ref("config/adminPin").once("value");
  let pinValid = false;

  if (adminsSnap.exists()) {
    for (const child of Object.values(adminsSnap.val() as Record<string, { pinHash: string }>)) {
      if (child.pinHash) {
        if (child.pinHash.includes(":")) {
          const parts = child.pinHash.split(":");
          if (parts.length !== 2) continue;
          const [salt, storedHash] = parts;
          const derived = await hashPinPBKDF2(pin, salt);
          if (derived === `${salt}:${storedHash}`) { pinValid = true; break; }
        } else {
          const hash = await hashPinSHA256(pin);
          if (hash === child.pinHash) { pinValid = true; break; }
        }
      }
    }
  }
  if (!pinValid && configSnap.exists()) {
    const storedHash = configSnap.val() as string;
    const hash = await hashPinSHA256(pin);
    if (hash === storedHash) pinValid = true;
  }

  if (!pinValid) {
    await recordFailure(tid);
    return JSON.stringify({ error: "관리자 PIN이 올바르지 않습니다." });
  }
  // 성공 → 카운터 정리
  await clearRateLimit(tid);

  const tourSnap = await db.ref(`tournaments/${tid}/name`).once("value");
  const tourName = tourSnap.exists() ? tourSnap.val() : tid;

  const deletePaths: Record<string, null> = {
    [`tournaments/${tid}`]: null,
    [`matches/${tid}`]: null,
    [`tournamentPlayers/${tid}`]: null,
    [`schedule/${tid}`]: null,
    [`teams/${tid}`]: null,
  };
  await db.ref().update(deletePaths);

  return JSON.stringify({ success: true, message: `대회 "${tourName}" 및 관련 데이터(경기, 선수, 스케줄, 팀) 삭제 완료` });
}
