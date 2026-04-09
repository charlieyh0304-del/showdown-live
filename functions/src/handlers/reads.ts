/**
 * 조회(read-only) 핸들러 모음
 * - list_tournaments, get_tournament
 * - list_players, list_matches, list_courts, list_referees
 * - get_schedule, list_teams
 */
import { db } from "../db-helpers";

export async function listTournaments(): Promise<string> {
  const snap = await db.ref("tournaments").once("value");
  if (!snap.exists()) return JSON.stringify([]);
  const list = Object.entries(snap.val()).map(([id, v]) => {
    const t = v as Record<string, unknown>;
    return { id, name: t.name, date: t.date, status: t.status, type: t.type, formatType: t.formatType };
  });
  return JSON.stringify(list);
}

export async function getTournament(tid: string): Promise<string> {
  const snap = await db.ref(`tournaments/${tid}`).once("value");
  if (!snap.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });
  return JSON.stringify({ id: tid, ...snap.val() });
}

export async function listPlayers(tid?: string): Promise<string> {
  const path = tid ? `tournamentPlayers/${tid}` : "players";
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) return JSON.stringify([]);
  const list = Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) }));
  return JSON.stringify(list.slice(0, 100));
}

export async function listMatches(tid: string, statusFilter?: string): Promise<string> {
  const snap = await db.ref(`matches/${tid}`).once("value");
  if (!snap.exists()) return JSON.stringify({ matches: [], summary: "경기 없음" });
  type ME = Record<string, unknown> & { id: string };
  const rawList: ME[] = Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as Record<string, unknown>) }));
  let filtered = rawList;
  if (statusFilter) filtered = filtered.filter(m => m.status === statusFilter);

  const total = rawList.length;
  const pending = rawList.filter(m => m.status === "pending").length;
  const completed = rawList.filter(m => m.status === "completed").length;
  const inProgress = rawList.filter(m => m.status === "in_progress").length;

  const compact = filtered.map(m => {
    const sets = (m.sets || []) as Array<{ player1Score: number; player2Score: number }>;
    const score = sets.map(s => `${s.player1Score}-${s.player2Score}`).join(", ");
    const winner = m.winnerId ? (m.winnerId === (m.player1Id || m.team1Id) ? (m.player1Name || m.team1Name) : (m.player2Name || m.team2Name)) : null;
    return {
      id: m.id, status: m.status,
      p1: m.player1Name || m.team1Name || "", p2: m.player2Name || m.team2Name || "",
      score, winner: winner || "",
      groupId: m.groupId, stageId: m.stageId,
      bracketRound: m.bracketRound, roundLabel: m.roundLabel,
    };
  });

  const groups: Record<string, typeof compact> = {};
  const finals: typeof compact = [];
  const classification: typeof compact = [];
  for (const m of compact) {
    const sid = (m.stageId as string) || "";
    if (sid.includes("finals") || sid.includes("3rd")) {
      finals.push(m);
    } else if (sid.includes("class") || sid.includes("ranking")) {
      classification.push(m);
    } else if (m.groupId) {
      if (!groups[m.groupId as string]) groups[m.groupId as string] = [];
      groups[m.groupId as string].push(m);
    } else {
      finals.push(m);
    }
  }

  return JSON.stringify({
    summary: `전체 ${total}경기 (완료 ${completed}, 진행 ${inProgress}, 대기 ${pending})`,
    groups, finals, classification,
  });
}

export async function listCourts(): Promise<string> {
  const snap = await db.ref("courts").once("value");
  if (!snap.exists()) return JSON.stringify([]);
  return JSON.stringify(Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) })));
}

export async function listReferees(): Promise<string> {
  const snap = await db.ref("referees").once("value");
  if (!snap.exists()) return JSON.stringify([]);
  return JSON.stringify(Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) })));
}

export async function getSchedule(tid: string): Promise<string> {
  const snap = await db.ref(`schedule/${tid}`).once("value");
  if (!snap.exists()) return JSON.stringify([]);
  return JSON.stringify(Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) })));
}

export async function listTeams(tid: string): Promise<string> {
  const snap = await db.ref(`teams/${tid}`).once("value");
  if (!snap.exists()) return JSON.stringify([]);
  return JSON.stringify(Object.entries(snap.val()).map(([id, v]) => ({ id, ...(v as object) })));
}
