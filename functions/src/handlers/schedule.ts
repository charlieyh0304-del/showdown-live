/**
 * 스케줄 관련 핸들러: generate_round_robin, shift_schedule, move_matches_to_court
 */
import { db, addDays } from "../db-helpers";

export async function generateRoundRobin(input: Record<string, unknown>): Promise<string> {
  const tid = input.tournamentId as string;

  // 중복 생성 방지
  const existingMatchSnap = await db.ref(`matches/${tid}`).once("value");
  if (existingMatchSnap.exists()) {
    const existingMatches = Object.values(existingMatchSnap.val() as Record<string, Record<string, unknown>>);
    const groupId = input.groupId as string | undefined;
    const groupMatches = groupId
      ? existingMatches.filter(m => m.groupId === groupId)
      : existingMatches;
    if (groupMatches.length > 0) {
      return JSON.stringify({ error: `이미 ${groupMatches.length}경기가 존재합니다. 중복 생성 방지. 기존 경기를 삭제 후 재생성하거나 다른 groupId를 지정하세요.` });
    }
  }

  // 대회 타입 자동 감지
  const rrTourSnap = await db.ref(`tournaments/${tid}/type`).once("value");
  const isTeamTour = rrTourSnap.val() === "team";

  const now = Date.now();
  const matches: Record<string, unknown>[] = [];

  if (isTeamTour) {
    let teamIds = input.teamIds as string[] | undefined;
    if (!teamIds || teamIds.length === 0) {
      const teamSnap = await db.ref(`teams/${tid}`).once("value");
      if (!teamSnap.exists()) return JSON.stringify({ error: "팀이 없습니다." });
      teamIds = Object.keys(teamSnap.val());
    }

    const teamSnap = await db.ref(`teams/${tid}`).once("value");
    const teamData = teamSnap.exists() ? teamSnap.val() as Record<string, { name: string; memberIds?: string[]; memberNames?: string[]; coachName?: string }> : {};

    for (let i = 0; i < teamIds.length; i++) {
      for (let j = i + 1; j < teamIds.length; j++) {
        const t1 = teamData[teamIds[i]] || { name: teamIds[i] };
        const t2 = teamData[teamIds[j]] || { name: teamIds[j] };
        matches.push({
          tournamentId: tid,
          type: "team",
          status: "pending",
          round: matches.length + 1,
          team1Id: teamIds[i],
          team2Id: teamIds[j],
          team1Name: t1.name,
          team2Name: t2.name,
          team1: { memberIds: t1.memberIds || [], memberNames: t1.memberNames || [], coachName: t1.coachName || "" },
          team2: { memberIds: t2.memberIds || [], memberNames: t2.memberNames || [], coachName: t2.coachName || "" },
          player1Coach: t1.coachName || "",
          player2Coach: t2.coachName || "",
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0,
          player1Timeouts: 0,
          player2Timeouts: 0,
          winnerId: null,
          createdAt: now + matches.length,
          ...(input.groupId ? { groupId: input.groupId } : {}),
        });
      }
    }
  } else {
    let playerIds = input.playerIds as string[] | undefined;
    if (!playerIds || playerIds.length === 0) {
      const snap = await db.ref(`tournamentPlayers/${tid}`).once("value");
      if (!snap.exists()) return JSON.stringify({ error: "선수가 없습니다." });
      playerIds = Object.keys(snap.val());
    }

    const playerSnap = await db.ref(`tournamentPlayers/${tid}`).once("value");
    const playerData = playerSnap.exists() ? playerSnap.val() : {};
    const nameMap = new Map<string, string>();
    for (const [id, v] of Object.entries(playerData)) {
      nameMap.set(id, (v as { name: string }).name);
    }

    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        matches.push({
          tournamentId: tid,
          type: "individual",
          status: "pending",
          round: matches.length + 1,
          player1Id: playerIds[i],
          player2Id: playerIds[j],
          player1Name: nameMap.get(playerIds[i]) || playerIds[i],
          player2Name: nameMap.get(playerIds[j]) || playerIds[j],
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0,
          player1Timeouts: 0,
          player2Timeouts: 0,
          winnerId: null,
          createdAt: now + matches.length,
          ...(input.groupId ? { groupId: input.groupId } : {}),
        });
      }
    }
  }

  const bulk: Record<string, unknown> = {};
  for (const m of matches) {
    const key = db.ref(`matches/${tid}`).push().key!;
    bulk[`matches/${tid}/${key}`] = m;
  }
  await db.ref().update(bulk);

  return JSON.stringify({ success: true, count: matches.length, type: isTeamTour ? "team" : "individual", message: `${matches.length}경기 ${isTeamTour ? "팀" : "개인"}전 라운드로빈 생성 완료` });
}

export async function shiftSchedule(input: Record<string, unknown>): Promise<string> {
  const tid = input.tournamentId as string;
  const shift = input.shiftMinutes as number;
  const matchIds = input.matchIds as string[] | undefined;
  const courtId = input.courtId as string | undefined;

  const matchesSnap = await db.ref(`matches/${tid}`).once("value");
  if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });

  function shiftTime(time: string, date: string | undefined, shiftMin: number): { time: string; date: string | undefined; dateShift: number } {
    const [h2, m2] = time.split(":").map(Number);
    let totalMin = h2 * 60 + m2 + shiftMin;
    let ds = 0;
    while (totalMin < 0) { totalMin += 24 * 60; ds--; }
    while (totalMin >= 24 * 60) { totalMin -= 24 * 60; ds++; }
    const newTime2 = `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
    const newDate2 = ds !== 0 && date ? addDays(date, ds) : date;
    return { time: newTime2, date: newDate2, dateShift: ds };
  }

  const shiftBulk: Record<string, unknown> = {};
  let count = 0;
  const allMatches = matchesSnap.val() as Record<string, Record<string, unknown>>;
  for (const [mid, match] of Object.entries(allMatches)) {
    if (!match.scheduledTime) continue;
    if (matchIds && matchIds.length > 0 && !matchIds.includes(mid)) continue;
    if (courtId && match.courtId !== courtId) continue;

    const result = shiftTime(match.scheduledTime as string, match.scheduledDate as string | undefined, shift);
    shiftBulk[`matches/${tid}/${mid}/scheduledTime`] = result.time;
    if (result.date) shiftBulk[`matches/${tid}/${mid}/scheduledDate`] = result.date;
    count++;
  }

  const schedSnap = await db.ref(`schedule/${tid}`).once("value");
  if (schedSnap.exists()) {
    for (const [sid, slot] of Object.entries(schedSnap.val() as Record<string, Record<string, unknown>>)) {
      if (!slot.scheduledTime) continue;
      const matchId = slot.matchId as string;
      if (matchIds && matchIds.length > 0 && !matchIds.includes(matchId)) continue;
      if (courtId && slot.courtId !== courtId) continue;

      const result = shiftTime(slot.scheduledTime as string, slot.scheduledDate as string | undefined, shift);
      shiftBulk[`schedule/${tid}/${sid}/scheduledTime`] = result.time;
      if (result.date) shiftBulk[`schedule/${tid}/${sid}/scheduledDate`] = result.date;
    }
  }
  if (Object.keys(shiftBulk).length > 0) await db.ref().update(shiftBulk);

  return JSON.stringify({ success: true, count, message: `${count}경기 ${shift > 0 ? `${shift}분 뒤로` : `${-shift}분 앞으로`} 이동` });
}

export async function moveMatchesToCourt(input: Record<string, unknown>): Promise<string> {
  const tid = input.tournamentId as string;
  const fromCourtId = input.fromCourtId as string;
  const toCourtId = input.toCourtId as string;
  const toCourtName = input.toCourtName as string;

  const matchesSnap = await db.ref(`matches/${tid}`).once("value");
  if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });

  let count = 0;
  for (const [mid, match] of Object.entries(matchesSnap.val() as Record<string, Record<string, unknown>>)) {
    if (match.courtId === fromCourtId) {
      await db.ref(`matches/${tid}/${mid}`).update({ courtId: toCourtId, courtName: toCourtName });
      count++;
    }
  }

  return JSON.stringify({ success: true, count, message: `${count}경기 코트 이동 완료` });
}
