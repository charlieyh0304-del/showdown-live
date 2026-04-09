/**
 * 팀 리그 워크플로우 핸들러 (create_team_league)
 * - setup_full_tournament + 코트/심판/스케줄/심판배정을 한 번에 처리
 */
type ExecuteTool = (name: string, input: Record<string, unknown>) => Promise<string>;

export async function createTeamLeague(input: Record<string, unknown>, executeTool: ExecuteTool): Promise<string> {
  const steps: string[] = [];
  const tlIsFullLeague = (input.format as string) === "full_league" || (input.groupCount as number) === 1;
  const tlGroupCount = tlIsFullLeague ? 1 : ((input.groupCount as number) || 2);

  // 1. 대회 생성
  const tlResult = await executeTool("setup_full_tournament", {
    name: input.name, date: input.date, endDate: input.endDate,
    groupId: input.groupId, groupName: input.groupName,
    scheduleDates: input.scheduleDates,
    type: (input.randomTeam as boolean) ? "randomTeamLeague" : "team",
    teams: input.teams,
    groupCount: tlGroupCount,
    advancePerGroup: tlIsFullLeague ? 0 : ((input.advancePerGroup as number) || 2),
    qualifyingWinScore: (input.qualifyingWinScore as number) || 31,
    qualifyingSetsToWin: 1,
    finalsFormat: (input.finalsFormat as string) || "single_elimination",
    finalsStartRound: input.finalsStartRound,
    avoidSameGroup: input.avoidSameGroup,
    bracketArrangement: input.bracketArrangement,
    thirdPlace: input.thirdPlace !== false,
    fifthToEighth: input.fifthToEighth !== false,
    fifthToEighthFormat: input.fifthToEighthFormat,
    classificationGroups: input.classificationGroups,
    classificationGroupSize: input.classificationGroupSize,
    rankingUpTo: input.rankingUpTo,
    rankingSetsToWin: input.rankingSetsToWin, rankingWinScore: input.rankingWinScore,
    teamSize: input.teamSize, maxReserves: input.maxReserves,
    genderRatio: input.genderRatio,
    rotationEnabled: input.rotationEnabled, rotationInterval: input.rotationInterval,
    minLead: input.minLead, deuceEnabled: input.deuceEnabled,
    seeds: input.seeds, tiebreakerRules: input.tiebreakerRules,
    wildcardCount: input.wildcardCount,
  });
  const tlParsed = JSON.parse(tlResult);
  if (!tlParsed.success) return JSON.stringify({ error: `대회 생성 실패: ${tlParsed.error}` });
  const tlTid = tlParsed.tournamentId as string;
  steps.push(`대회 생성 완료: ${tlParsed.matchCount}경기 (${tlParsed.groupCount}개 조)`);

  // 2. 코트 등록
  for (const court of ((input.courts as string[]) || [])) {
    await executeTool("add_court", { name: court });
  }
  if ((input.courts as string[])?.length) steps.push(`경기장 ${(input.courts as string[]).length}개 등록`);

  // 3. 심판 등록
  for (const ref of ((input.referees as string[]) || [])) {
    await executeTool("add_referee", { name: ref, role: "main" });
  }
  if ((input.referees as string[])?.length) steps.push(`심판 ${(input.referees as string[]).length}명 등록`);

  // 4. 스케줄 생성
  const matchDur = (input.matchDurationMinutes as number) || 60;
  const teamRest = (input.teamRestMinutes as number) || 30;
  const schedResult = await executeTool("generate_schedule", {
    tournamentId: tlTid, scheduleDate: input.date as string,
    startTime: (input.startTime as string) || "09:00",
    endTime: (input.endTime as string) || "18:00",
    nextDayStartTime: (input.nextDayStartTime as string) || (input.startTime as string) || "09:00",
    intervalMinutes: matchDur, playerRestMinutes: matchDur + teamRest,
    ...(input.breakStart ? { breakStart: input.breakStart } : {}),
    ...(input.breakEnd ? { breakEnd: input.breakEnd } : {}),
    ...(input.scheduleDates ? { scheduleDates: input.scheduleDates } : {}),
  });
  const schedParsed = JSON.parse(schedResult);
  if (schedParsed.success) steps.push(`스케줄: ${schedParsed.summary}`);

  // 5. 심판 자동 배정
  if ((input.referees as string[])?.length) {
    await executeTool("bulk_assign_referees", { tournamentId: tlTid });
    steps.push("심판 자동 배정 완료");
  }

  return JSON.stringify({
    success: true, tournamentId: tlTid, steps,
    groupAssignment: tlParsed.groupAssignment,
    teamRoster: tlParsed.message,
    scheduleDetail: schedParsed.scheduleDetail || "",
    matchCount: tlParsed.matchCount, groupCount: tlParsed.groupCount,
  });
}
