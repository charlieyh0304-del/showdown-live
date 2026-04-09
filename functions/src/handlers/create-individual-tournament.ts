/**
 * 개인전 워크플로우 핸들러 (create_individual_tournament)
 * - setup_full_tournament + 코트/심판/스케줄/심판배정을 한 번에 처리
 */
type ExecuteTool = (name: string, input: Record<string, unknown>) => Promise<string>;

export async function createIndividualTournament(input: Record<string, unknown>, executeTool: ExecuteTool): Promise<string> {
  const steps: string[] = [];
  const setsToWin = (input.setsToWin as number) || 2;
  const matchDur = (input.matchDurationMinutes as number) || 30;
  const pRest = (input.playerRestMinutes as number) || 30;
  const isFullLeagueReq = (input.format as string) === "full_league" || (input.groupCount as number) === 1;
  const itGroupCount = isFullLeagueReq ? 1 : ((input.groupCount as number) || 4);

  const itResult = await executeTool("setup_full_tournament", {
    name: input.name, date: input.date, endDate: input.endDate,
    groupId: input.groupId, groupName: input.groupName,
    scheduleDates: input.scheduleDates,
    type: "individual", players: input.players,
    groupCount: itGroupCount,
    advancePerGroup: isFullLeagueReq ? 0 : ((input.advancePerGroup as number) || 2),
    qualifyingWinScore: (input.winScore as number) || 11,
    qualifyingSetsToWin: setsToWin,
    finalsFormat: (input.finalsFormat as string) || "single_elimination",
    finalsSetsToWin: input.finalsSetsToWin,
    finalsStartRound: input.finalsStartRound,
    avoidSameGroup: input.avoidSameGroup,
    bracketArrangement: input.bracketArrangement,
    thirdPlace: isFullLeagueReq ? false : (input.thirdPlace !== false),
    fifthToEighth: input.fifthToEighth,
    fifthToEighthFormat: input.fifthToEighthFormat,
    classificationGroups: input.classificationGroups,
    classificationGroupSize: input.classificationGroupSize,
    rankingUpTo: input.rankingUpTo,
    rankingSetsToWin: input.rankingSetsToWin, rankingWinScore: input.rankingWinScore,
    minLead: input.minLead, deuceEnabled: input.deuceEnabled,
    seeds: input.seeds, tiebreakerRules: input.tiebreakerRules,
    wildcardCount: input.wildcardCount,
    roundOverrideFromRound: input.roundOverrideFromRound,
    roundOverrideSetsToWin: input.roundOverrideSetsToWin,
  });
  const itParsed = JSON.parse(itResult);
  if (!itParsed.success) return JSON.stringify({ error: `대회 생성 실패: ${itParsed.error}` });
  const itTid = itParsed.tournamentId as string;
  steps.push(isFullLeagueReq
    ? `대회 생성: 풀리그 ${itParsed.matchCount}경기`
    : `대회 생성: ${itParsed.matchCount}경기 (${itParsed.groupCount}개 조)`);

  for (const c of ((input.courts as string[]) || [])) await executeTool("add_court", { name: c });
  for (const r of ((input.referees as string[]) || [])) await executeTool("add_referee", { name: r, role: "main" });

  const itSched = await executeTool("generate_schedule", {
    tournamentId: itTid, scheduleDate: input.date as string,
    startTime: (input.startTime as string) || "09:00",
    endTime: (input.endTime as string) || "18:00",
    nextDayStartTime: (input.nextDayStartTime as string) || (input.startTime as string) || "09:00",
    intervalMinutes: matchDur, playerRestMinutes: matchDur + pRest,
    ...(input.breakStart ? { breakStart: input.breakStart } : {}),
    ...(input.breakEnd ? { breakEnd: input.breakEnd } : {}),
    ...(input.scheduleDates ? { scheduleDates: input.scheduleDates } : {}),
  });
  const itSchedP = JSON.parse(itSched);
  if (itSchedP.success) steps.push(`스케줄: ${itSchedP.summary}`);
  if ((input.referees as string[])?.length) {
    await executeTool("bulk_assign_referees", { tournamentId: itTid });
    steps.push("심판 자동 배정");
  }

  return JSON.stringify({
    success: true, tournamentId: itTid, steps,
    groupAssignment: itParsed.groupAssignment,
    scheduleDetail: itSchedP.scheduleDetail || "",
    matchCount: itParsed.matchCount, groupCount: itParsed.groupCount,
  });
}
