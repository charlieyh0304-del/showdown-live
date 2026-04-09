/**
 * 랜덤 팀 리그 생성 핸들러
 * - 선수만 받아서 자동으로 팀을 구성하고 리그를 생성
 * - 시드 분산 + 성별 균등 배분 + 조별 편성 지원
 */
import { db } from "../db-helpers";

export async function setupRandomTeamLeague(input: Record<string, unknown>): Promise<string> {
  // 코드 레벨 가드: 사전 구성 팀 정보가 넘어오면 잘못된 도구 선택 → 에러
  if (input.teams && Array.isArray(input.teams) && (input.teams as unknown[]).length > 0) {
    return JSON.stringify({ error: "팀별 선수가 이미 지정되어 있습니다. setup_random_team_league가 아닌 setup_full_tournament(type='team', teams=[...]) 도구를 사용하세요." });
  }
  const rtPlayersRaw = input.players as Array<{ name: string; gender?: string; team?: string }> | undefined;
  if (rtPlayersRaw?.some(p => p.team)) {
    return JSON.stringify({ error: "선수에 팀 소속(team)이 지정되어 있습니다. 사전 구성 팀전은 setup_full_tournament(type='team', teams=[{name:'팀명', memberNames:['선수1','선수2']}]) 도구를 사용하세요." });
  }
  const now = Date.now();
  const rtPlayers = input.players as Array<{ name: string; gender?: string }>;
  const rtTeamSize = (input.teamSize as number) || 3;
  const rtSeeds = (input.seeds as string[]) || [];
  const rtCustomNames = (input.teamNames as string[]) || [];
  const rtWinScore = (input.winScore as number) || 31;
  const rtGroupCount = (input.groupCount as number) || 1;

  if (!rtPlayers || rtPlayers.length < rtTeamSize * 2) return JSON.stringify({ error: `최소 ${rtTeamSize * 2}명의 선수가 필요합니다.` });

  // 동일 이름 대회 중복 방지
  const rtExisting = await db.ref("tournaments").once("value");
  if (rtExisting.exists()) {
    for (const [eid, ev] of Object.entries(rtExisting.val() as Record<string, { name?: string }>)) {
      if (ev.name === input.name) {
        return JSON.stringify({ error: `"${input.name}" 대회가 이미 존재합니다 (ID: ${eid}).` });
      }
    }
  }

  // 중복 검사
  const rtNameSet = new Set<string>();
  for (const p of rtPlayers) {
    if (rtNameSet.has(p.name)) return JSON.stringify({ error: `중복 선수명: ${p.name}` });
    rtNameSet.add(p.name);
  }
  const rtInvalidSeeds = rtSeeds.filter(s => !rtNameSet.has(s));
  if (rtInvalidSeeds.length > 0) return JSON.stringify({ error: `시드 선수를 찾을 수 없습니다: ${rtInvalidSeeds.join(", ")}` });

  const teamCount = Math.floor(rtPlayers.length / rtTeamSize);
  if (teamCount < 2) return JSON.stringify({ error: `최소 2팀 필요 (${rtPlayers.length}명 / ${rtTeamSize}인 = ${teamCount}팀)` });
  if (rtGroupCount > teamCount) return JSON.stringify({ error: `조 수(${rtGroupCount})가 팀 수(${teamCount})를 초과` });

  // 1. 대회 생성
  const rtRef = db.ref("tournaments").push();
  const rtTid = rtRef.key!;
  const rtDate = (input.date as string) || new Date().toISOString().split("T")[0];
  const rtQualStageId = `stage_qualifying_${rtTid}`;

  await rtRef.set({
    name: input.name || "랜덤 팀 리그",
    date: rtDate,
    ...(input.endDate ? { endDate: input.endDate } : {}),
    type: "randomTeamLeague",
    format: rtGroupCount > 1 ? "group_league" : "full_league",
    formatType: rtGroupCount > 1 ? "group_knockout" : "round_robin",
    status: "draft",
    gameConfig: { winScore: rtWinScore, setsToWin: 1 },
    teamMatchSettings: { winScore: rtWinScore, setsToWin: 1, minLead: 2 },
    teamRules: { teamSize: rtTeamSize, rotationEnabled: false },
    qualifyingConfig: rtGroupCount > 1 ? { format: "group_round_robin", groupCount: rtGroupCount } : undefined,
    createdAt: now, updatedAt: now,
  });

  // 2. 선수 등록
  const rtBulk: Record<string, unknown> = {};
  const rtPlayerMap = new Map<string, string>();
  for (const p of rtPlayers) {
    const key = db.ref(`tournamentPlayers/${rtTid}`).push().key!;
    rtBulk[`tournamentPlayers/${rtTid}/${key}`] = { name: p.name, gender: p.gender || "", club: "", class: "", createdAt: now };
    rtPlayerMap.set(p.name, key);
  }

  // 3. 팀 구성 (탑시드 분산 + 성별 균등 배분)
  const males = rtPlayers.filter(p => p.gender === "male" || p.gender === "남");
  const females = rtPlayers.filter(p => p.gender === "female" || p.gender === "여");
  const rtTeams: Array<{ id: string; name: string; memberIds: string[]; memberNames: string[] }> = [];
  for (let i = 0; i < teamCount; i++) {
    const tName = rtCustomNames[i] || `${i + 1}팀`;
    rtTeams.push({ id: `team_${i + 1}`, name: tName, memberIds: [], memberNames: [] });
  }

  // 3a. 시드 배치: 각 팀에 1명씩
  const rtSeedSet = new Set<string>();
  for (let i = 0; i < Math.min(rtSeeds.length, teamCount); i++) {
    const sid = rtPlayerMap.get(rtSeeds[i]);
    if (sid) {
      rtTeams[i].memberIds.push(sid);
      rtTeams[i].memberNames.push(rtSeeds[i]);
      rtSeedSet.add(rtSeeds[i]);
    }
  }

  // 3b. 성별 균등 배분: 여자 먼저 배분 → 남자 채우기
  const remainFemales = females.filter(p => !rtSeedSet.has(p.name)).sort(() => Math.random() - 0.5);
  const remainMales = males.filter(p => !rtSeedSet.has(p.name)).sort(() => Math.random() - 0.5);
  const remainOthers = rtPlayers.filter(p => !rtSeedSet.has(p.name) && p.gender !== "male" && p.gender !== "남" && p.gender !== "female" && p.gender !== "여").sort(() => Math.random() - 0.5);

  // 여자 1명씩 각 팀에 배정
  for (const f of remainFemales) {
    const team = rtTeams.find(t => t.memberIds.length < rtTeamSize && !t.memberNames.some(n => {
      const pl = rtPlayers.find(p => p.name === n);
      return pl && (pl.gender === "female" || pl.gender === "여");
    }));
    if (team) {
      const fid = rtPlayerMap.get(f.name)!;
      team.memberIds.push(fid);
      team.memberNames.push(f.name);
    }
  }

  // 남자로 나머지 채우기
  for (const m of [...remainMales, ...remainOthers]) {
    const team = rtTeams.reduce((a, b) => a.memberIds.length <= b.memberIds.length ? a : b);
    if (team.memberIds.length >= rtTeamSize) break;
    const mid = rtPlayerMap.get(m.name)!;
    if (mid && !rtTeams.some(t => t.memberIds.includes(mid))) {
      team.memberIds.push(mid);
      team.memberNames.push(m.name);
    }
  }

  // 팀 저장
  for (const team of rtTeams) {
    rtBulk[`teams/${rtTid}/${team.id}`] = { name: team.name, memberIds: team.memberIds, memberNames: team.memberNames, createdAt: now };
  }

  // 4. 조 편성 (groupCount > 1이면 조별)
  const rtGroups: Array<{ id: string; name: string; teamIds: string[] }> = [];
  if (rtGroupCount > 1) {
    for (let i = 0; i < rtGroupCount; i++) {
      rtGroups.push({ id: `group_${String.fromCharCode(65 + i)}`, name: `${String.fromCharCode(65 + i)}조`, teamIds: [] });
    }
    // 스네이크 드래프트로 팀을 조에 배분
    for (let i = 0; i < rtTeams.length; i++) {
      const round = Math.floor(i / rtGroupCount);
      const pos = i % rtGroupCount;
      const gi = round % 2 === 0 ? pos : rtGroupCount - 1 - pos;
      rtGroups[gi].teamIds.push(rtTeams[i].id);
    }
    // 스테이지 저장
    rtBulk[`tournaments/${rtTid}/stages`] = [{
      id: rtQualStageId, type: "qualifying", format: "group_round_robin", status: "pending",
      groupCount: rtGroupCount,
      groups: rtGroups.map(g => ({ id: g.id, stageId: rtQualStageId, name: g.name, playerIds: [], teamIds: g.teamIds })),
    }];
  }

  // 5. 경기 생성 (조별이면 조 안에서만, 아니면 전체)
  let rtMatchCount = 0;
  const matchGroups = rtGroupCount > 1 ? rtGroups : [{ id: "", name: "전체", teamIds: rtTeams.map(t => t.id) }];

  for (const grp of matchGroups) {
    const gTeams = grp.teamIds;
    for (let i = 0; i < gTeams.length; i++) {
      for (let j = i + 1; j < gTeams.length; j++) {
        const t1 = rtTeams.find(t => t.id === gTeams[i])!;
        const t2 = rtTeams.find(t => t.id === gTeams[j])!;
        const mKey = db.ref(`matches/${rtTid}`).push().key!;
        rtBulk[`matches/${rtTid}/${mKey}`] = {
          tournamentId: rtTid, type: "team", status: "pending",
          round: rtMatchCount + 1,
          team1Id: t1.id, team2Id: t2.id,
          team1Name: t1.name, team2Name: t2.name,
          team1: { memberIds: t1.memberIds, memberNames: t1.memberNames },
          team2: { memberIds: t2.memberIds, memberNames: t2.memberNames },
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
          winnerId: null, createdAt: now + rtMatchCount,
          ...(grp.id ? { groupId: grp.id, stageId: rtQualStageId } : {}),
        };
        rtMatchCount++;
      }
    }
  }

  await db.ref().update(rtBulk);

  const rtTeamSummary = rtTeams.map(t => `${t.name}: ${t.memberNames.join(", ")}`).join("\n");
  const rtGroupSummary = rtGroupCount > 1
    ? "\n\n조 편성:\n" + rtGroups.map(g => `${g.name}: ${g.teamIds.map(tid => rtTeams.find(t => t.id === tid)?.name || tid).join(", ")}`).join("\n")
    : "";

  return JSON.stringify({
    success: true,
    tournamentId: rtTid,
    playerCount: rtPlayers.length,
    teamCount, teamSize: rtTeamSize,
    groupCount: rtGroupCount,
    matchCount: rtMatchCount,
    seeds: rtSeeds,
    teamAssignment: rtTeamSummary,
    groupAssignment: rtGroupSummary,
    message: `랜덤 팀 리그 "${input.name}" 생성 완료\n${rtPlayers.length}명 → ${teamCount}팀 (${rtTeamSize}인)${rtGroupCount > 1 ? `, ${rtGroupCount}개 조` : ""}\n시드 ${rtSeeds.length}명 분산, 성별 균등 배분\n${rtMatchCount}경기 ${rtGroupCount > 1 ? "조별 " : ""}라운드로빈\n\n${rtTeamSummary}${rtGroupSummary}`,
  });
}
