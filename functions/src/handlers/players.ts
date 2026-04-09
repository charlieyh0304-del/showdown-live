/**
 * Player CRUD 핸들러
 */
import { db } from "../db-helpers";

export async function addPlayersBulk(
  players: Array<{ name: string; club?: string; class?: string; gender?: string }>,
  tid?: string,
): Promise<string> {
  const basePath = tid ? `tournamentPlayers/${tid}` : "players";
  const now = Date.now();
  const bulk: Record<string, unknown> = {};
  const ids: string[] = [];
  for (const p of players) {
    const key = db.ref(basePath).push().key!;
    bulk[`${basePath}/${key}`] = { name: p.name, club: p.club || "", class: p.class || "", gender: p.gender || "", createdAt: now };
    ids.push(key);
  }
  await db.ref().update(bulk);
  return JSON.stringify({ success: true, count: players.length, ids, message: `${players.length}명 추가 완료` });
}

export async function deletePlayer(playerId: string, tid?: string): Promise<string> {
  const path = tid ? `tournamentPlayers/${tid}/${playerId}` : `players/${playerId}`;
  await db.ref(path).remove();
  return JSON.stringify({ success: true, message: "선수 삭제 완료" });
}
