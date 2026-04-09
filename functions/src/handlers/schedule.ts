/**
 * 스케줄 관련 핸들러: generate_round_robin, shift_schedule, move_matches_to_court
 */
import { db, addDays, asString, asNumber, asBoolean } from "../db-helpers";

export async function generateRoundRobin(input: Record<string, unknown>): Promise<string> {
  const tid = asString(input.tournamentId);

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
  const tid = asString(input.tournamentId);
  const shift = asNumber(input.shiftMinutes);
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

    const result = shiftTime(asString(match.scheduledTime), match.scheduledDate as string | undefined, shift);
    shiftBulk[`matches/${tid}/${mid}/scheduledTime`] = result.time;
    if (result.date) shiftBulk[`matches/${tid}/${mid}/scheduledDate`] = result.date;
    count++;
  }

  const schedSnap = await db.ref(`schedule/${tid}`).once("value");
  if (schedSnap.exists()) {
    for (const [sid, slot] of Object.entries(schedSnap.val() as Record<string, Record<string, unknown>>)) {
      if (!slot.scheduledTime) continue;
      const matchId = asString(slot.matchId);
      if (matchIds && matchIds.length > 0 && !matchIds.includes(matchId)) continue;
      if (courtId && slot.courtId !== courtId) continue;

      const result = shiftTime(asString(slot.scheduledTime), slot.scheduledDate as string | undefined, shift);
      shiftBulk[`schedule/${tid}/${sid}/scheduledTime`] = result.time;
      if (result.date) shiftBulk[`schedule/${tid}/${sid}/scheduledDate`] = result.date;
    }
  }
  if (Object.keys(shiftBulk).length > 0) await db.ref().update(shiftBulk);

  return JSON.stringify({ success: true, count, message: `${count}경기 ${shift > 0 ? `${shift}분 뒤로` : `${-shift}분 앞으로`} 이동` });
}

export async function generateSchedule(input: Record<string, unknown>): Promise<string> {
  const tid = asString(input.tournamentId);
  const startTime = asString(input.startTime, "09:00");
  const endTime = asString(input.endTime, "19:00");
  const interval = asNumber(input.intervalMinutes, 30);
  const playerRest = asNumber(input.playerRestMinutes, 60);
  const scheduleDate = asString(input.scheduleDate, new Date().toISOString().split("T")[0]);
  const inputScheduleDates = (input.scheduleDates as string[]) || [];
  const nextDayStart = asString(input.nextDayStartTime, startTime);

  const breakStartStr = input.breakStart as string | undefined;
  const breakEndStr = input.breakEnd as string | undefined;
  const stageFilter = input.stageFilter as string | undefined;
  const onlyUnassigned = asBoolean(input.onlyUnassigned);

  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  const dayStart = toMin(startTime);
  const dayEnd = toMin(endTime);
  const nextDayStartMin = toMin(nextDayStart);
  const breakStart = breakStartStr ? toMin(breakStartStr) : -1;
  const breakEnd = breakEndStr ? toMin(breakEndStr) : -1;
  if (breakStart >= 0 && breakEnd >= 0 && breakStart >= breakEnd) {
    return JSON.stringify({ error: `휴식 시작(${breakStartStr})이 종료(${breakEndStr})보다 같거나 늦습니다.` });
  }
  if (dayStart >= dayEnd) {
    return JSON.stringify({ error: `시작 시간(${startTime})이 종료 시간(${endTime})보다 같거나 늦습니다.` });
  }

  const schedTourSnap = await db.ref(`tournaments/${tid}`).once("value");
  const schedTourData = schedTourSnap.exists() ? schedTourSnap.val() as Record<string, unknown> : {};
  const scheduleDates: string[] = Array.isArray(schedTourData.scheduleDates)
    ? schedTourData.scheduleDates as string[]
    : inputScheduleDates;

  const getNextScheduleDate = (currentDate: string): string => {
    if (scheduleDates.length > 0) {
      const next = scheduleDates.find(d => d > currentDate);
      return next || addDays(currentDate, 1);
    }
    return addDays(currentDate, 1);
  };

  let effectiveStartDate = scheduleDate;
  if (scheduleDates.length > 0) {
    const validDate = scheduleDates.find(d => d >= scheduleDate);
    if (validDate) effectiveStartDate = validDate;
  }

  const matchesSnap = await db.ref(`matches/${tid}`).once("value");
  if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다." });
  const courtsSnap = await db.ref("courts").once("value");
  if (!courtsSnap.exists()) return JSON.stringify({ error: "코트가 없습니다." });

  type MatchEntry = Record<string, unknown> & { id: string };
  let matchList: MatchEntry[] = Object.entries(matchesSnap.val())
    .map(([id, v]) => ({ id, ...(v as Record<string, unknown>) }));

  if (onlyUnassigned) {
    matchList = matchList.filter((m) =>
      (m.status === "pending" || m.status === "in_progress") && !m.scheduledDate);
  } else {
    matchList = matchList.filter((m) => m.status === "pending" || m.status === "in_progress");
  }

  if (stageFilter) {
    matchList = matchList.filter((m) => m.stageId === stageFilter);
  }

  if (matchList.length === 0) return JSON.stringify({ error: "배정할 경기가 없습니다." });

  const courtList = Object.entries(courtsSnap.val()).map(([id, v]) => ({ id, ...(v as { name: string }) }));
  const courtSlots = courtList.map((c) => ({ courtId: c.id, courtName: c.name, date: effectiveStartDate, time: dayStart }));

  const playerLastEnd = new Map<string, { date: string; time: number }>();

  const getPlayerIds = (m: Record<string, unknown>): string[] => {
    const ids: string[] = [];
    if (m.player1Id) ids.push(asString(m.player1Id));
    if (m.player2Id) ids.push(asString(m.player2Id));
    if (m.team1Id) ids.push(asString(m.team1Id));
    if (m.team2Id) ids.push(asString(m.team2Id));
    return ids;
  };

  const skipBreak = (time: number): number => {
    if (breakStart >= 0 && breakEnd >= 0 && time >= breakStart && time < breakEnd) {
      return breakEnd;
    }
    return time;
  };

  const slots: Record<string, unknown>[] = [];
  let skippedCount = 0;

  for (const match of matchList) {
    const playerIds = getPlayerIds(match);
    let bestCourtIdx = -1;
    let bestDate = scheduleDate;
    let bestTime = Infinity;

    for (let ci = 0; ci < courtSlots.length; ci++) {
      const court = courtSlots[ci];
      let candidateDate = court.date;
      let candidateTime = skipBreak(court.time);

      for (const pid of playerIds) {
        const last = playerLastEnd.get(pid);
        if (last) {
          if (last.date === candidateDate && last.time > candidateTime) {
            candidateTime = skipBreak(last.time);
          } else if (last.date > candidateDate) {
            candidateDate = last.date;
            candidateTime = skipBreak(Math.max(nextDayStartMin, last.time));
          }
        }
      }

      candidateTime = skipBreak(candidateTime);

      if (candidateTime >= dayEnd) {
        candidateDate = getNextScheduleDate(candidateDate);
        candidateTime = nextDayStartMin;
        candidateTime = skipBreak(candidateTime);
      }

      const candidateTotal = new Date(candidateDate).getTime() + candidateTime;
      const bestTotal = new Date(bestDate).getTime() + bestTime;
      if (bestCourtIdx === -1 || candidateTotal < bestTotal) {
        bestCourtIdx = ci;
        bestDate = candidateDate;
        bestTime = candidateTime;
      }
    }

    if (bestCourtIdx === -1) { skippedCount++; continue; }

    if (bestTime >= dayEnd) {
      bestDate = getNextScheduleDate(bestDate);
      bestTime = skipBreak(nextDayStartMin);
    }

    const court = courtSlots[bestCourtIdx];
    const timeStr = fmtMin(bestTime);
    const label = `${match.player1Name || match.team1Name || ""} vs ${match.player2Name || match.team2Name || ""}`;

    slots.push({
      matchId: match.id,
      courtId: court.courtId,
      courtName: court.courtName,
      scheduledTime: timeStr,
      scheduledDate: bestDate,
      label,
      status: match.status || "pending",
    });

    const courtEndTime = bestTime + interval;
    if (courtEndTime >= dayEnd) {
      court.date = getNextScheduleDate(bestDate);
      court.time = nextDayStartMin;
    } else {
      court.date = bestDate;
      court.time = courtEndTime;
    }

    const playerEndTime = bestTime + playerRest;
    const playerEnd = playerEndTime >= dayEnd
      ? { date: getNextScheduleDate(bestDate), time: nextDayStartMin }
      : { date: bestDate, time: playerEndTime };
    for (const pid of playerIds) {
      playerLastEnd.set(pid, playerEnd);
    }
  }

  const scheduleBulk: Record<string, unknown> = {};
  for (const slot of slots) {
    const mid = asString(slot.matchId);
    scheduleBulk[`matches/${tid}/${mid}/scheduledTime`] = slot.scheduledTime;
    scheduleBulk[`matches/${tid}/${mid}/scheduledDate`] = slot.scheduledDate;
    scheduleBulk[`matches/${tid}/${mid}/courtId`] = slot.courtId;
    scheduleBulk[`matches/${tid}/${mid}/courtName`] = slot.courtName;
  }

  if (!onlyUnassigned) {
    scheduleBulk[`schedule/${tid}`] = null;
  }
  await db.ref().update(scheduleBulk);

  const slotBulk: Record<string, unknown> = {};
  if (onlyUnassigned) {
    const existingSnap = await db.ref(`schedule/${tid}`).once("value");
    if (existingSnap.exists()) {
      existingSnap.forEach((child) => { slotBulk[`schedule/${tid}/${child.key}`] = child.val(); });
    }
  }
  for (const slot of slots) {
    const key = db.ref(`schedule/${tid}`).push().key!;
    slotBulk[`schedule/${tid}/${key}`] = slot;
  }
  await db.ref().update(slotBulk);

  const dates = [...new Set(slots.map((s) => asString(s.scheduledDate)))].sort();
  const summary = dates.map((d) => {
    const daySlots = slots.filter((s) => s.scheduledDate === d);
    const times = daySlots.map((s) => asString(s.scheduledTime)).sort();
    return `${d}: ${daySlots.length}경기 (${times[0]}~${times[times.length - 1]})`;
  }).join(", ");

  const scheduleDetail = slots.map(s => `${s.scheduledDate} ${s.scheduledTime} [${s.courtName}] ${s.label}`).join("\n");

  return JSON.stringify({
    success: true,
    count: slots.length,
    skipped: skippedCount,
    dates: dates.length,
    summary,
    scheduleDetail,
    settings: { interval, playerRest, breakTime: breakStartStr ? `${breakStartStr}-${breakEndStr}` : "없음", endTime },
    message: `${slots.length}경기 스케줄 생성 완료 (${dates.length}일, 팀 휴식 ${playerRest}분, 경기 간격 ${interval}분${breakStartStr ? `, 점심 ${breakStartStr}-${breakEndStr}` : ""})`,
  });
}

export async function moveMatchesToCourt(input: Record<string, unknown>): Promise<string> {
  const tid = asString(input.tournamentId);
  const fromCourtId = asString(input.fromCourtId);
  const toCourtId = asString(input.toCourtId);
  const toCourtName = asString(input.toCourtName);

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
