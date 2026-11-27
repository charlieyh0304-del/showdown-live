/**
 * Tournament CRUD 핸들러
 */
import { db, hashPinSHA256, hashPinPBKDF2 } from "../db-helpers";
import { DEFAULT_INDIVIDUAL_SCORING, DEFAULT_TEAM_SCORING, isTeamType } from "../shared/rules/competitionRules";
import { rankingConfigUpdate, timeLimitRuleUpdate } from "../lib/tournament-update";

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
  const type = typeof input.type === "string" && input.type ? input.type : "individual";
  const isTeam = isTeamType(type);
  // 기본값은 대회 규칙 단일 설정원의 기본값 (개인 11점 3세트제 = 2선승, 단체 31점 단판)
  const defaults = isTeam ? DEFAULT_TEAM_SCORING : DEFAULT_INDIVIDUAL_SCORING;
  const winScore = typeof input.winScore === "number" && input.winScore > 0 ? input.winScore : defaults.winScore;
  const setsToWin = typeof input.setsToWin === "number" && input.setsToWin > 0 ? input.setsToWin : defaults.setsToWin;
  const data = {
    name: input.name || "새 대회",
    date: input.date || new Date().toISOString().split("T")[0],
    ...(input.endDate ? { endDate: input.endDate } : {}),
    type,
    format: "full_league",
    formatType: input.formatType || "round_robin",
    status: "draft",
    // resolver가 읽는 규칙 층 (단체전 점수도 rules.scoring.team에)
    rules: { scoring: { [isTeam ? "team" : "individual"]: { winScore, setsToWin, maxSets: setsToWin * 2 - 1 } } },
    // 옛 화면 호환 (개인전 gameConfig, 단체전 teamMatchSettings)
    ...(isTeam ? { teamMatchSettings: { winScore, setsToWin, minLead: 2 } } : { gameConfig: { winScore, setsToWin } }),
    createdAt: now,
    updatedAt: now,
  };
  await newRef.set(data);
  return JSON.stringify({ success: true, tournamentId: newRef.key, message: `대회 "${data.name}" 생성 완료` });
}

export async function updateTournament(input: Record<string, unknown>): Promise<string> {
  const { tournamentId, rankingUpTo, thirdPlace, fifthToEighth, classificationGroups, timeLimitMinutes, timeLimitUnit, goldenGoalMode, ibsaSanctioned, stageId, ...fields } = input;
  const updates: Record<string, unknown> = { ...fields, updatedAt: Date.now() };
  delete updates.tournamentId;

  // 시간 제한·골든골·IBSA 승인 (M0f): 규칙 층(rules/scoring, 스테이지면 stages/{키}/rules/scoring)에 쓴다
  if (timeLimitMinutes !== undefined || timeLimitUnit !== undefined || goldenGoalMode !== undefined || ibsaSanctioned !== undefined) {
    const curSnap = await db.ref(`tournaments/${tournamentId}`).once("value");
    const curData = curSnap.exists() ? curSnap.val() as Record<string, unknown> : {};
    const tl = timeLimitRuleUpdate(curData, { timeLimitMinutes, timeLimitUnit, goldenGoalMode, ibsaSanctioned, stageId }, "rules" in fields);
    if ("error" in tl) return JSON.stringify({ error: tl.error });
    Object.assign(updates, tl.updates);
  }

  // 순위결정전 설정: 레거시 rankingMatchConfig와 규칙 층 rules.finalRanking을 함께 쓴다
  // (rules.finalRanking이 레거시 값보다 우선하므로, 레거시만 쓰면 바뀌지 않는다)
  if (rankingUpTo !== undefined || thirdPlace !== undefined || fifthToEighth !== undefined || classificationGroups !== undefined) {
    const curSnap = await db.ref(`tournaments/${tournamentId}`).once("value");
    const curData = curSnap.exists() ? curSnap.val() as Record<string, unknown> : {};
    Object.assign(updates, rankingConfigUpdate(curData, { rankingUpTo, thirdPlace, fifthToEighth, classificationGroups }, "rules" in fields));
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
