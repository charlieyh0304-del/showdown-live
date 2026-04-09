/**
 * 풀 토너먼트 생성 핸들러 (개인전/팀전, 풀리그/조별리그)
 */
import { db, asString, asNumber, asBoolean } from "../db-helpers";

export async function setupFullTournament(input: Record<string, unknown>): Promise<string> {
  const now = Date.now();
  const tourType = asString(input.type, "individual");
  const isTeamTour = tourType === "team" || tourType === "randomTeamLeague";
  const players = (input.players as Array<{ name: string; club?: string; class?: string; gender?: string }>) || [];
  const inputTeams = (input.teams as Array<{ name: string; memberNames?: string[]; coachName?: string }>) || [];

  // 코드 가드: type=team인데 teams가 비어있으면 에러
  if (isTeamTour && inputTeams.length === 0) {
    return JSON.stringify({ error: "type=team이지만 teams 파라미터가 비어있습니다. 사용자가 지정한 팀 구성을 teams: [{name:'팀명', memberNames:['선수1','선수2'], coachName:'코치명'}] 형태로 전달하세요. players가 아닌 teams를 사용해야 합니다." });
  }
  const groupCount = asNumber(input.groupCount, 4);
  const advancePerGroup = asNumber(input.advancePerGroup, 2);
  const seeds = (input.seeds as string[]) || [];
  const qualWinScore = asNumber(input.qualifyingWinScore, isTeamTour ? 31 : 11);
  const qualSetsToWin = asNumber(input.qualifyingSetsToWin, isTeamTour ? 1 : 2);
  const finalsFormat = asString(input.finalsFormat, "single_elimination");
  const thirdPlace = input.thirdPlace !== false;
  const fifthToEighth = asBoolean(input.fifthToEighth);
  const classificationGroups = asBoolean(input.classificationGroups);
  const wildcardCountInput = asNumber(input.wildcardCount);
  const rankingUpToInput = asNumber(input.rankingUpTo);
  // 새 파라미터들
  const scheduleDatesInput = (input.scheduleDates as string[]) || [];
  const teamSize = asNumber(input.teamSize, 3);
  const maxReserves = asNumber(input.maxReserves, 1);
  const genderRatio = (input.genderRatio as { male: number; female: number }) || { male: 2, female: 1 };
  const rotationEnabled = asBoolean(input.rotationEnabled);
  const rotationInterval = asNumber(input.rotationInterval, 6);
  const finalsStartRound = input.finalsStartRound as number | undefined;
  const avoidSameGroup = input.avoidSameGroup !== false;
  const bracketArrangement = asString(input.bracketArrangement, "cross_group");
  const fifthToEighthFormat = asString(input.fifthToEighthFormat, "simple");
  const classificationGroupSize = asNumber(input.classificationGroupSize, 4);
  const minLead = asNumber(input.minLead, 2);
  const deuceEnabled = input.deuceEnabled !== false;
  const tiebreakerRules = (input.tiebreakerRules as string[]) || [];
  const finalsSetsToWin = input.finalsSetsToWin as number | undefined;
  const finalsWinScore = input.finalsWinScore as number | undefined;
  const roundOverrideFromRound = input.roundOverrideFromRound as number | undefined;
  const roundOverrideSetsToWin = input.roundOverrideSetsToWin as number | undefined;
  // 참가 단위 수 (개인전: 선수 수, 팀전: 팀 수)
  const participants = isTeamTour ? inputTeams : players;
  const participantCount = participants.length;
  const totalAdvance = groupCount * advancePerGroup;

  // 입력 검증
  if (participantCount < 2) return JSON.stringify({ error: isTeamTour ? "최소 2팀이 필요합니다." : "최소 2명의 선수가 필요합니다." });
  if (groupCount > participantCount) return JSON.stringify({ error: `조 수(${groupCount})가 ${isTeamTour ? "팀" : "선수"} 수(${participantCount})를 초과할 수 없습니다.` });

  // 동일 이름 대회 중복 방지
  const ftExisting = await db.ref("tournaments").once("value");
  if (ftExisting.exists()) {
    for (const [eid, ev] of Object.entries(ftExisting.val() as Record<string, { name?: string }>)) {
      if (ev.name === input.name) {
        return JSON.stringify({ error: `"${input.name}" 대회가 이미 존재합니다 (ID: ${eid}). 삭제 후 다시 생성하거나 다른 이름을 사용하세요.` });
      }
    }
  }

  // 중복 이름 검사
  const nameSet = new Set<string>();
  for (const p of participants) {
    if (nameSet.has(p.name)) return JSON.stringify({ error: `중복 이름: ${p.name}` });
    nameSet.add(p.name);
  }

  // 시드 검증
  const invalidSeeds = seeds.filter(s => !nameSet.has(s));
  if (invalidSeeds.length > 0) return JSON.stringify({ error: `시드 선수를 찾을 수 없습니다: ${invalidSeeds.join(", ")}` });

  // 날짜 검증
  const dateStr = asString(input.date, new Date().toISOString().split("T")[0]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return JSON.stringify({ error: "날짜 형식: YYYY-MM-DD" });

  // 1. 대회 생성
  const tourRef = db.ref("tournaments").push();
  const tid = tourRef.key!;
  const qualStageId = `stage_qualifying_${tid}`;
  const finalsStageId = `stage_finals_${tid}`;

  const isFullLeague = groupCount <= 1;
  const effectiveFinalsStartRound = finalsStartRound || totalAdvance;
  const effectiveFinalsSetsToWin = finalsSetsToWin || qualSetsToWin;
  const effectiveFinalsWinScore = finalsWinScore || qualWinScore;
  const tournamentData: Record<string, unknown> = {
    name: input.name || "새 대회",
    date: input.date || new Date().toISOString().split("T")[0],
    ...(input.endDate ? { endDate: input.endDate } : {}),
    ...(scheduleDatesInput.length > 0 ? { scheduleDates: scheduleDatesInput } : {}),
    ...(input.groupId ? { groupId: input.groupId, groupName: input.groupName || "" } : {}),
    type: tourType,
    format: isFullLeague ? "full_league" : "group_league",
    formatType: isFullLeague ? "round_robin" : "group_knockout",
    status: "draft",
    gameConfig: { winScore: qualWinScore, setsToWin: qualSetsToWin },
    scoringRules: { winScore: qualWinScore, setsToWin: qualSetsToWin, maxSets: qualSetsToWin * 2 - 1, minLead, deuceEnabled },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    ...(isTeamTour ? {
      teamMatchSettings: { winScore: qualWinScore, setsToWin: qualSetsToWin, minLead },
      teamRules: { teamSize, maxReserves, rotationEnabled, rotationInterval, genderRatio },
    } : {}),
    ...(tiebreakerRules.length > 0 ? { tiebreakerRules } : {}),
    qualifyingConfig: isFullLeague
      ? { format: "round_robin", scoringRules: { winScore: qualWinScore, setsToWin: qualSetsToWin, maxSets: qualSetsToWin * 2 - 1, minLead, deuceEnabled } }
      : { format: "group_round_robin", groupCount, scoringRules: { winScore: qualWinScore, setsToWin: qualSetsToWin, maxSets: qualSetsToWin * 2 - 1, minLead, deuceEnabled } },
    // 풀리그도 rankingMatchConfig 저장 (rankingUpTo 등 제한 가능)
    ...(isFullLeague ? {
      rankingMatchConfig: {
        enabled: rankingUpToInput > 0,
        thirdPlace: false,
        fifthToEighth: false,
        fifthToEighthFormat: "simple",
        classificationGroups: false,
        classificationGroupSize: 4,
        ...(rankingUpToInput > 0 ? { rankingUpTo: rankingUpToInput } : {}),
      },
    } : {
      finalsConfig: {
        format: finalsFormat,
        advanceCount: totalAdvance,
        startingRound: effectiveFinalsStartRound,
        seedMethod: bracketArrangement === "custom" ? "custom" : "ranking",
        advancePerGroup,
        ...(wildcardCountInput > 0 ? { wildcardCount: wildcardCountInput } : {}),
        avoidSameGroup,
        bracketArrangement,
        scoringRules: { winScore: effectiveFinalsWinScore, setsToWin: effectiveFinalsSetsToWin, maxSets: effectiveFinalsSetsToWin * 2 - 1, minLead, deuceEnabled },
        ...(roundOverrideFromRound && roundOverrideSetsToWin ? {
          roundScoringOverride: {
            fromRound: roundOverrideFromRound,
            scoringRules: { winScore: effectiveFinalsWinScore, setsToWin: roundOverrideSetsToWin, maxSets: roundOverrideSetsToWin * 2 - 1, minLead, deuceEnabled },
          },
        } : {}),
      },
      rankingMatchConfig: {
        enabled: thirdPlace || fifthToEighth || classificationGroups || rankingUpToInput > 0,
        thirdPlace,
        fifthToEighth,
        fifthToEighthFormat,
        classificationGroups,
        classificationGroupSize,
        ...(rankingUpToInput > 0 ? { rankingUpTo: rankingUpToInput } : {}),
        ...((input.rankingSetsToWin as number) ? { rankingSetsToWin: input.rankingSetsToWin as number } : {}),
        ...((input.rankingWinScore as number) ? { rankingWinScore: input.rankingWinScore as number } : {}),
      },
    }),
    stages: isFullLeague
      ? [{ id: qualStageId, type: "qualifying", format: "round_robin", status: "pending", groupCount: 1, groups: [] }]
      : [
          { id: qualStageId, type: "qualifying", format: "group_round_robin", status: "pending", groupCount, groups: [] },
          { id: finalsStageId, type: "finals", format: finalsFormat, status: "pending", advanceCount: totalAdvance },
        ],
    createdAt: now,
    updatedAt: now,
  };
  await tourRef.set(tournamentData);

  // 2~4 전부 한 번의 multi-path update로 처리
  const bulkUpdate: Record<string, unknown> = {};
  const idMap = new Map<string, string>(); // name → id
  const nameMap = new Map<string, string>(); // id → name

  if (isTeamTour) {
    // 팀전: 팀 등록 + 팀원을 선수로도 등록
    for (const team of inputTeams) {
      const teamId = db.ref(`teams/${tid}`).push().key!;
      const memberIds: string[] = [];
      for (const mName of (team.memberNames || [])) {
        const pKey = db.ref(`tournamentPlayers/${tid}`).push().key!;
        bulkUpdate[`tournamentPlayers/${tid}/${pKey}`] = { name: mName, club: "", class: "", gender: "", createdAt: now };
        memberIds.push(pKey);
      }
      bulkUpdate[`teams/${tid}/${teamId}`] = {
        name: team.name, memberIds, memberNames: team.memberNames || [], createdAt: now,
        ...(team.coachName ? { coachName: team.coachName } : {}),
      };
      idMap.set(team.name, teamId);
      nameMap.set(teamId, team.name);
    }
  } else {
    // 개인전: 선수 등록
    for (const p of players) {
      const pKey = db.ref(`tournamentPlayers/${tid}`).push().key!;
      bulkUpdate[`tournamentPlayers/${tid}/${pKey}`] = { name: p.name, club: (p as Record<string, unknown>).club || "", class: (p as Record<string, unknown>).class || "", gender: (p as Record<string, unknown>).gender || "", createdAt: now };
      idMap.set(p.name, pKey);
      nameMap.set(pKey, p.name);
    }
  }

  // 3. 조 편성
  const groups: Array<{ id: string; stageId: string; name: string; playerIds: string[]; teamIds: string[] }> = [];
  const allIds = participants.map(p => idMap.get(p.name)!).filter(Boolean);

  if (isFullLeague) {
    // 풀리그: 조 없이 전체 참가자를 하나의 그룹으로
    const fullGroup = { id: "full_league", stageId: qualStageId, name: "전체 리그", playerIds: [] as string[], teamIds: [] as string[] };
    if (isTeamTour) fullGroup.teamIds = allIds;
    else fullGroup.playerIds = allIds;
    groups.push(fullGroup);
  } else {
    // 조별 리그: 스네이크 드래프트 + 시드
    for (let i = 0; i < groupCount; i++) {
      groups.push({ id: `group_${String.fromCharCode(65 + i)}`, stageId: qualStageId, name: `${String.fromCharCode(65 + i)}조`, playerIds: [], teamIds: [] });
    }
    // 시드 배치: 각 조에 1명씩, 초과 시드는 2번째 라운드로 분산
    const seedSet = new Set<string>();
    const seedIds: string[] = [];
    for (const sName of seeds) {
      const sid = idMap.get(sName);
      if (sid) seedIds.push(sid);
    }
    // 1라운드: 각 조에 시드 1명씩 (최대 groupCount명)
    for (let i = 0; i < Math.min(seedIds.length, groupCount); i++) {
      if (isTeamTour) groups[i].teamIds.push(seedIds[i]);
      else groups[i].playerIds.push(seedIds[i]);
      seedSet.add(seedIds[i]);
    }
    // 초과 시드: 뒤쪽 조부터 역순 배치 (시드끼리 같은 조 최소화)
    for (let i = groupCount; i < seedIds.length; i++) {
      const groupIdx = groupCount - 1 - (i - groupCount);
      const safeIdx = Math.max(0, groupIdx);
      if (isTeamTour) groups[safeIdx].teamIds.push(seedIds[i]);
      else groups[safeIdx].playerIds.push(seedIds[i]);
      seedSet.add(seedIds[i]);
    }
    // 나머지 선수: 스네이크 드래프트 (시드가 적은 조부터 우선 배정)
    const remainingIds = allIds.filter(id => !seedSet.has(id));
    // 각 조의 현재 인원수 기준으로 적은 조부터 채움
    for (const rid of remainingIds) {
      // 가장 인원이 적은 조 찾기 (동점이면 앞쪽 조 우선)
      let minIdx = 0;
      let minSize = Infinity;
      for (let g = 0; g < groups.length; g++) {
        const size = isTeamTour ? groups[g].teamIds.length : groups[g].playerIds.length;
        if (size < minSize) { minSize = size; minIdx = g; }
      }
      if (isTeamTour) groups[minIdx].teamIds.push(rid);
      else groups[minIdx].playerIds.push(rid);
    }
  }

  const tdStages = tournamentData.stages as Array<Record<string, unknown>>;
  bulkUpdate[`tournaments/${tid}/stages`] = isFullLeague
    ? [{ ...tdStages[0], groups }]
    : [{ ...tdStages[0], groups }, tdStages[1]];
  bulkUpdate[`tournaments/${tid}/seeds`] = seeds.map((name, i) => ({
    position: i + 1, playerId: idMap.get(name) || "", name,
  }));

  // 4. 예선 라운드로빈 경기 생성
  let matchCount = 0;
  for (const group of groups) {
    const ids = isTeamTour ? group.teamIds : group.playerIds;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const mKey = db.ref(`matches/${tid}`).push().key!;
        if (isTeamTour) {
          // 팀전 경기
          const t1Data = (bulkUpdate[`teams/${tid}/${ids[i]}`] || {}) as Record<string, unknown>;
          const t2Data = (bulkUpdate[`teams/${tid}/${ids[j]}`] || {}) as Record<string, unknown>;
          bulkUpdate[`matches/${tid}/${mKey}`] = {
            tournamentId: tid, type: "team", status: "pending",
            round: matchCount + 1,
            team1Id: ids[i], team2Id: ids[j],
            team1Name: nameMap.get(ids[i]) || ids[i],
            team2Name: nameMap.get(ids[j]) || ids[j],
            team1: { memberIds: t1Data.memberIds || [], memberNames: t1Data.memberNames || [], coachName: t1Data.coachName || "" },
            team2: { memberIds: t2Data.memberIds || [], memberNames: t2Data.memberNames || [], coachName: t2Data.coachName || "" },
            player1Coach: t1Data.coachName || "",
            player2Coach: t2Data.coachName || "",
            sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
            currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null,
            createdAt: now + matchCount, groupId: group.id, stageId: qualStageId,
          };
        } else {
          // 개인전 경기
          bulkUpdate[`matches/${tid}/${mKey}`] = {
            tournamentId: tid, type: "individual", status: "pending",
            round: matchCount + 1, player1Id: ids[i], player2Id: ids[j],
            player1Name: nameMap.get(ids[i]) || ids[i], player2Name: nameMap.get(ids[j]) || ids[j],
            sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
            currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null,
            createdAt: now + matchCount, groupId: group.id, stageId: qualStageId,
          };
        }
        matchCount++;
      }
    }
  }

  await db.ref().update(bulkUpdate);

  const groupSummary = groups.map(g => {
    const ids = isTeamTour ? g.teamIds : g.playerIds;
    return `${g.name}: ${ids.map(id => nameMap.get(id) || id).join(", ")}`;
  }).join("\n");

  return JSON.stringify({
    success: true,
    tournamentId: tid,
    participantCount,
    type: isTeamTour ? "team" : "individual",
    groupCount,
    matchCount,
    advancePerGroup,
    totalAdvance,
    thirdPlace,
    fifthToEighth,
    classificationGroups,
    groupAssignment: groupSummary,
    message: isFullLeague
      ? `${isTeamTour ? "팀전" : "개인전"} "${input.name}" 생성 완료\n${isTeamTour ? "팀" : "선수"} ${participantCount}${isTeamTour ? "팀" : "명"}, 풀리그 ${matchCount}경기`
      : `${isTeamTour ? "팀전" : "개인전"} "${input.name}" 생성 완료\n${isTeamTour ? "팀" : "선수"} ${participantCount}${isTeamTour ? "팀" : "명"}, ${groupCount}개 조, 예선 ${matchCount}경기\n조당 ${advancePerGroup}${isTeamTour ? "팀" : "명"} 본선 진출 (총 ${totalAdvance})\n3/4위=${thirdPlace}, 5-8위=${fifthToEighth}, 하위순위=${classificationGroups}`,
  });
}
