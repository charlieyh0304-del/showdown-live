/**
 * 단순 CRUD 핸들러 — courts, referees, players, teams
 */
import { db } from "../db-helpers";

// ===== Courts =====
export async function addCourt(name: string, location?: string): Promise<string> {
  const existing = await db.ref("courts").once("value");
  if (existing.exists()) {
    for (const [cid, cv] of Object.entries(existing.val() as Record<string, { name: string }>)) {
      if (cv.name === name) {
        return JSON.stringify({ success: true, courtId: cid, message: `코트 "${name}"은(는) 이미 등록되어 있습니다. (기존 ID: ${cid})`, existing: true });
      }
    }
  }
  const newRef = db.ref("courts").push();
  await newRef.set({ name, location: location || "", assignedReferees: [], createdAt: Date.now() });
  return JSON.stringify({ success: true, courtId: newRef.key, message: `코트 "${name}" 추가 완료` });
}

export async function deleteCourt(cid: string): Promise<string> {
  await db.ref(`courts/${cid}`).remove();
  return JSON.stringify({ success: true, message: "코트 삭제 완료" });
}

export async function updateCourt(cid: string, fields: Record<string, unknown>): Promise<string> {
  await db.ref(`courts/${cid}`).update(fields);
  return JSON.stringify({ success: true, message: "코트 정보 수정 완료" });
}

// ===== Referees =====
export async function addReferee(name: string, role?: string): Promise<string> {
  const existing = await db.ref("referees").once("value");
  if (existing.exists()) {
    for (const [rid, rv] of Object.entries(existing.val() as Record<string, { name: string }>)) {
      if (rv.name === name) {
        return JSON.stringify({ success: true, refereeId: rid, message: `심판 "${name}"은(는) 이미 등록되어 있습니다. (기존 ID: ${rid})`, existing: true });
      }
    }
  }
  const newRef = db.ref("referees").push();
  await newRef.set({ name, role: role || "main", createdAt: Date.now() });
  return JSON.stringify({ success: true, refereeId: newRef.key, message: `심판 "${name}" 추가 완료` });
}

export async function deleteReferee(rid: string): Promise<string> {
  await db.ref(`referees/${rid}`).remove();
  return JSON.stringify({ success: true, message: "심판 삭제 완료" });
}

export async function updateReferee(rid: string, fields: Record<string, unknown>): Promise<string> {
  await db.ref(`referees/${rid}`).update(fields);
  return JSON.stringify({ success: true, message: "심판 정보 수정 완료" });
}

export async function bulkAssignReferees(btid: string): Promise<string> {
  const mSnap = await db.ref(`matches/${btid}`).once("value");
  const rSnap = await db.ref("referees").once("value");
  if (!mSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });
  if (!rSnap.exists()) return JSON.stringify({ error: "심판이 없습니다." });

  const refList = Object.entries(rSnap.val() as Record<string, { name: string }>);
  const bulkR: Record<string, unknown> = {};
  let rIdx = 0;
  let cnt = 0;
  for (const [mid, mv] of Object.entries(mSnap.val() as Record<string, Record<string, unknown>>)) {
    if (mv.refereeId || mv.status === "completed") continue;
    const [refId, refData] = refList[rIdx % refList.length];
    bulkR[`matches/${btid}/${mid}/refereeId`] = refId;
    bulkR[`matches/${btid}/${mid}/refereeName`] = refData.name;
    rIdx++;
    cnt++;
  }
  if (cnt > 0) await db.ref().update(bulkR);
  return JSON.stringify({ success: true, count: cnt, message: `${cnt}경기에 심판 자동 배정 완료` });
}

// ===== Players =====
export async function updatePlayer(pid: string, ptid: string | undefined, fields: Record<string, unknown>): Promise<string> {
  const pPath = ptid ? `tournamentPlayers/${ptid}/${pid}` : `players/${pid}`;
  await db.ref(pPath).update(fields);
  return JSON.stringify({ success: true, message: "선수 정보 수정 완료" });
}

// ===== Teams =====
export async function addTeam(ttid: string, name: string, memberIds: string[], memberNames: string[], coachName?: string): Promise<string> {
  const tRef = db.ref(`teams/${ttid}`).push();
  const teamPayload: Record<string, unknown> = {
    name,
    memberIds: memberIds || [],
    memberNames: memberNames || [],
    createdAt: Date.now(),
  };
  if (coachName) teamPayload.coachName = coachName;
  await tRef.set(teamPayload);
  return JSON.stringify({ success: true, teamId: tRef.key, message: `팀 "${name}" 추가 완료${coachName ? ` (코치: ${coachName})` : ""}` });
}

export async function deleteTeam(tid: string, teamId: string): Promise<string> {
  await db.ref(`teams/${tid}/${teamId}`).remove();
  return JSON.stringify({ success: true, message: "팀 삭제 완료" });
}

// ===== Schedule =====
export async function resetSchedule(rstid: string): Promise<string> {
  const rstSnap = await db.ref(`matches/${rstid}`).once("value");
  if (rstSnap.exists()) {
    const rstBulk: Record<string, unknown> = {};
    for (const mid of Object.keys(rstSnap.val() as Record<string, unknown>)) {
      rstBulk[`matches/${rstid}/${mid}/scheduledTime`] = null;
      rstBulk[`matches/${rstid}/${mid}/scheduledDate`] = null;
      rstBulk[`matches/${rstid}/${mid}/courtId`] = null;
      rstBulk[`matches/${rstid}/${mid}/courtName`] = null;
    }
    await db.ref().update(rstBulk);
  }
  await db.ref(`schedule/${rstid}`).remove();
  return JSON.stringify({ success: true, message: "스케줄 초기화 완료" });
}
