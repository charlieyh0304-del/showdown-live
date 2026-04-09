/**
 * Match CRUD 핸들러
 */
import { db } from "../db-helpers";

export async function addMatch(input: Record<string, unknown>): Promise<string> {
  if (!input.tournamentId || typeof input.tournamentId !== "string") {
    return JSON.stringify({ error: "tournamentId가 필요합니다." });
  }
  const tCheckSnap = await db.ref(`tournaments/${input.tournamentId}`).once("value");
  if (!tCheckSnap.exists()) {
    return JSON.stringify({ error: "해당 대회를 찾을 수 없습니다." });
  }
  const hasP1 = input.player1Id || input.team1Id;
  const hasP2 = input.player2Id || input.team2Id;
  if (!hasP1 || !hasP2) {
    return JSON.stringify({ error: "player1Id/player2Id (또는 team1Id/team2Id)가 모두 필요합니다." });
  }
  const now = Date.now();
  const newRef = db.ref(`matches/${input.tournamentId}`).push();
  await newRef.set({
    tournamentId: input.tournamentId,
    type: input.matchType || "individual",
    status: "pending",
    round: input.round || 1,
    player1Id: input.player1Id || input.team1Id || "",
    player2Id: input.player2Id || input.team2Id || "",
    player1Name: input.player1Name || input.team1Name || "",
    player2Name: input.player2Name || input.team2Name || "",
    ...((input.matchType === "team" || input.team1Id) ? {
      team1Id: input.team1Id || input.player1Id, team2Id: input.team2Id || input.player2Id,
      team1Name: input.team1Name || input.player1Name, team2Name: input.team2Name || input.player2Name,
    } : {}),
    sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
    currentSet: 0,
    player1Timeouts: 0,
    player2Timeouts: 0,
    winnerId: null,
    createdAt: now,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.stageId ? { stageId: input.stageId } : {}),
  });
  return JSON.stringify({ success: true, matchId: newRef.key, message: `${input.player1Name} vs ${input.player2Name} 경기 추가` });
}

export async function updateMatch(input: Record<string, unknown>): Promise<string> {
  const { tournamentId, matchId, ...fields } = input;
  if (!tournamentId || !matchId) {
    return JSON.stringify({ error: "tournamentId와 matchId가 필요합니다." });
  }
  const matchCheckSnap = await db.ref(`matches/${tournamentId}/${matchId}`).once("value");
  if (!matchCheckSnap.exists()) {
    return JSON.stringify({ error: "해당 경기를 찾을 수 없습니다." });
  }
  const updates: Record<string, unknown> = { ...fields, updatedAt: Date.now() };
  delete updates.tournamentId;
  delete updates.matchId;
  await db.ref(`matches/${tournamentId}/${matchId}`).update(updates);
  return JSON.stringify({ success: true, message: "경기 수정 완료" });
}

export async function deleteMatch(tid: string, mid: string): Promise<string> {
  await db.ref(`matches/${tid}/${mid}`).remove();
  return JSON.stringify({ success: true, message: "경기 삭제 완료" });
}
