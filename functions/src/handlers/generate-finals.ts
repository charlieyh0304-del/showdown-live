/**
 * 본선 브라켓 + 순위결정전 생성 핸들러 (generate_finals)
 */
import { db } from "../db-helpers";

export async function generateFinals(input: Record<string, unknown>): Promise<string> {
  const tid = input.tournamentId as string;
  const tourSnap2 = await db.ref(`tournaments/${tid}`).once("value");
  if (!tourSnap2.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });
  const tour2 = tourSnap2.val() as Record<string, unknown>;

  const finalsConfig2 = tour2.finalsConfig as Record<string, unknown> | undefined;
  const rankingConfig2 = tour2.rankingMatchConfig as Record<string, unknown> | undefined;
  const stages2 = (tour2.stages || []) as Array<Record<string, unknown>>;
  const qualStage2 = stages2.find(s => s.type === "qualifying");
  let finalsStageId2 = stages2.find(s => s.type === "finals")?.id as string | undefined;
  if (!finalsStageId2) {
    // finals 스테이지가 없으면 자동 생성
    finalsStageId2 = `stage_finals_${tid}`;
    const newStages = [...stages2, { id: finalsStageId2, type: "finals", format: "single_elimination", status: "pending" }];
    await db.ref(`tournaments/${tid}/stages`).set(newStages);
  }
  const advancePerGroup2 = (input.advancePerGroup as number) || (finalsConfig2?.advancePerGroup as number) || 2;
  const includeThirdPlace2 = input.includeThirdPlace !== false;
  const includeFifthToEighth2 = input.includeFifthToEighth !== false;
  const includeClassification2 = input.includeClassification !== false;
  const rankingUpTo = (input.rankingUpTo as number) || (rankingConfig2?.rankingUpTo as number) || 0;

  // 예선 경기 로드
  const matchesSnap2 = await db.ref(`matches/${tid}`).once("value");
  if (!matchesSnap2.exists()) return JSON.stringify({ error: "경기가 없습니다." });
  const qualStageId2 = qualStage2?.id as string | undefined;
  const allMatches2 = Object.entries(matchesSnap2.val() as Record<string, Record<string, unknown>>);
  const qualMatches2 = allMatches2
    .map(([id, m]) => ({ id, ...m } as Record<string, unknown> & { id: string }))
    .filter((m) => m.status === "completed" && (qualStageId2 ? m.stageId === qualStageId2 : !!m.groupId));

  if (qualMatches2.length === 0) return JSON.stringify({ error: "완료된 예선 경기가 없습니다." });

  // 조별 순위 계산
  const gStats = new Map<string, Map<string, { id: string; name: string; wins: number; sd: number; pd: number }>>();
  for (const m of qualMatches2) {
    const gid = m.groupId as string;
    if (!gid) continue;
    if (!gStats.has(gid)) gStats.set(gid, new Map());
    const st = gStats.get(gid)!;
    const p1Id = (m.player1Id || m.team1Id) as string;
    const p2Id = (m.player2Id || m.team2Id) as string;
    if (!st.has(p1Id)) st.set(p1Id, { id: p1Id, name: (m.player1Name || m.team1Name) as string, wins: 0, sd: 0, pd: 0 });
    if (!st.has(p2Id)) st.set(p2Id, { id: p2Id, name: (m.player2Name || m.team2Name) as string, wins: 0, sd: 0, pd: 0 });
    const s1 = st.get(p1Id)!;
    const s2 = st.get(p2Id)!;
    if (m.winnerId === p1Id) s1.wins++; else if (m.winnerId === p2Id) s2.wins++;
    for (const s of ((m.sets || []) as Array<{ player1Score: number; player2Score: number }>)) {
      s1.pd += s.player1Score - s.player2Score; s2.pd += s.player2Score - s.player1Score;
      if (s.player1Score > s.player2Score) { s1.sd++; s2.sd--; } else if (s.player2Score > s.player1Score) { s2.sd++; s1.sd--; }
    }
  }

  let wildcardCount = (input.wildcardCount as number) || (finalsConfig2?.wildcardCount as number) || 0;

  // 자동 와일드카드 추론: 조당 진출자 × 조 수가 2의 거듭제곱이 아니면 자동 보충
  const groupCount2 = gStats.size;
  const baseAdvance = advancePerGroup2 * groupCount2;
  if (wildcardCount === 0 && baseAdvance > 0) {
    const nearestPow = Math.pow(2, Math.ceil(Math.log2(baseAdvance)));
    if (nearestPow > baseAdvance) {
      wildcardCount = nearestPow - baseAdvance; // 예: 14→16, 와일드카드=2
    }
  }

  const advanced: Array<{ id: string; name: string; gid: string; rank: number }> = [];
  const eliminated: Array<{ id: string; name: string; gid: string; rank: number }> = [];
  const wildcardCandidates: Array<{ id: string; name: string; gid: string; rank: number; wins: number; sd: number; pd: number }> = [];
  const gids = [...gStats.keys()].sort();
  for (const gid of gids) {
    const sorted = [...gStats.get(gid)!.values()].sort((a, b) => b.wins - a.wins || b.sd - a.sd || b.pd - a.pd || a.name.localeCompare(b.name));
    sorted.forEach((p, i) => {
      if (i < advancePerGroup2) {
        advanced.push({ id: p.id, name: p.name, gid, rank: i + 1 });
      } else if (wildcardCount > 0 && i === advancePerGroup2) {
        wildcardCandidates.push({ id: p.id, name: p.name, gid, rank: i + 1, wins: p.wins, sd: p.sd, pd: p.pd });
      } else {
        eliminated.push({ id: p.id, name: p.name, gid, rank: i + 1 });
      }
    });
  }

  // 와일드카드: 전체 조의 차순위 중 성적 상위 M명 추가 진출
  if (wildcardCount > 0 && wildcardCandidates.length > 0) {
    wildcardCandidates.sort((a, b) => b.wins - a.wins || b.sd - a.sd || b.pd - a.pd);
    const wcAdvanced = wildcardCandidates.slice(0, Math.min(wildcardCount, wildcardCandidates.length));
    const wcEliminated = wildcardCandidates.slice(Math.min(wildcardCount, wildcardCandidates.length));
    for (const wc of wcAdvanced) advanced.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
    for (const wc of wcEliminated) eliminated.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
  } else {
    // 와일드카드 없으면 후보를 전부 탈락으로
    for (const wc of wildcardCandidates) eliminated.push({ id: wc.id, name: wc.name, gid: wc.gid, rank: wc.rank });
  }

  if (advanced.length < 2) return JSON.stringify({ error: `진출자 ${advanced.length}명. 최소 2명 필요.` });

  // 브라켓 크기: 항상 진출자 수에서 가장 가까운 2의 거듭제곱
  const nearestPow2 = Math.pow(2, Math.ceil(Math.log2(Math.max(2, advanced.length))));
  const bracketSize = nearestPow2;
  const isTeamTour2 = tour2.type === "team" || tour2.type === "randomTeamLeague";

  // 교차 시드 배치 (같은 조 1라운드 대결 방지)
  const top = advanced.filter(p => p.rank === 1);
  const sec = advanced.filter(p => p.rank === 2);
  const wcPlayers = advanced.filter(p => p.rank > 2);
  // 2위 역순 배치 (A1 vs G2, B1 vs F2 형태를 위해)
  const secReversed = [...sec].reverse();
  // 시드 순서: 1위들(정순) → 2위들(역순) → 와일드카드
  const seeded = [...top, ...secReversed, ...wcPlayers];

  // 같은 조 대결 방지: fold-pairing 후 같은 조면 인접 슬롯과 스왑
  const halfBracket = Math.floor(bracketSize / 2);
  const pairIndices: [number, number][] = [];
  for (let i = 0; i < halfBracket; i++) {
    pairIndices.push([i, bracketSize - 1 - i]);
  }
  // 같은 조 충돌 검사 및 스왑
  for (let i = 0; i < pairIndices.length; i++) {
    const [idx1, idx2] = pairIndices[i];
    const p1 = idx1 < seeded.length ? seeded[idx1] : null;
    const p2 = idx2 < seeded.length ? seeded[idx2] : null;
    if (p1 && p2 && p1.gid === p2.gid) {
      // 같은 조 충돌 → 다음 페어의 p2와 스왑 시도
      for (let j = i + 1; j < pairIndices.length; j++) {
        const [, swapIdx2] = pairIndices[j];
        const swapP2 = swapIdx2 < seeded.length ? seeded[swapIdx2] : null;
        if (swapP2 && swapP2.gid !== p1.gid) {
          const origP2Gid = p2.gid;
          const swapTarget1 = pairIndices[j][0] < seeded.length ? seeded[pairIndices[j][0]] : null;
          if (!swapTarget1 || swapTarget1.gid !== origP2Gid) {
            // 스왑 실행
            [seeded[idx2], seeded[swapIdx2]] = [seeded[swapIdx2], seeded[idx2]];
            break;
          }
        }
      }
    }
  }

  // 전체 브라켓 생성 (BYE 포함, 모든 라운드)
  const now2 = Date.now();
  const bulk2: Record<string, unknown> = {};
  let mc = 0;
  const summary: string[] = [];

  const ROUND_NAMES: Record<number, string> = { 32: "32강", 16: "16강", 8: "8강", 4: "4강", 2: "결승" };
  const getRoundName = (n: number) => ROUND_NAMES[n] || `${n}강`;

  // 라운드별 matchKey 추적 (승자 연결용)
  const roundMatchKeys: string[][] = [];

  // 1라운드: 모든 브라켓 슬롯 생성 (BYE 포함)
  const r1Keys: string[] = [];
  const firstRoundName = getRoundName(bracketSize);
  let r1RealCount = 0;
  const r1Summaries: string[] = [];
  for (let i = 0; i < halfBracket; i++) {
    const p1 = i < seeded.length ? seeded[i] : null;
    const p2 = (bracketSize - 1 - i) < seeded.length ? seeded[bracketSize - 1 - i] : null;
    const mKey = db.ref(`matches/${tid}`).push().key!;

    if (p1 && p2) {
      // 실제 경기
      bulk2[`matches/${tid}/${mKey}`] = {
        tournamentId: tid, type: tour2.type || "individual", status: "pending",
        round: 1, bracketPosition: i, bracketRound: firstRoundName, roundLabel: firstRoundName,
        stageId: finalsStageId2,
        player1Id: p1.id, player2Id: p2.id,
        player1Name: p1.name, player2Name: p2.name,
        ...(isTeamTour2 ? { team1Id: p1.id, team2Id: p2.id, team1Name: p1.name, team2Name: p2.name } : {}),
        sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
        currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
        winnerId: null, createdAt: now2 + mc,
      };
      r1Summaries.push(`  ${r1RealCount + 1}. ${p1.name}(${p1.gid}${p1.rank}위) vs ${p2.name}(${p2.gid}${p2.rank}위)`);
      r1RealCount++;
    } else if (p1) {
      // BYE: p1 자동 진출 (completed 경기로 생성)
      bulk2[`matches/${tid}/${mKey}`] = {
        tournamentId: tid, type: tour2.type || "individual", status: "completed",
        round: 1, bracketPosition: i, bracketRound: firstRoundName, roundLabel: firstRoundName,
        stageId: finalsStageId2, isBye: true,
        player1Id: p1.id, player2Id: "BYE",
        player1Name: p1.name, player2Name: "부전승",
        ...(isTeamTour2 ? { team1Id: p1.id, team2Id: "BYE", team1Name: p1.name, team2Name: "부전승" } : {}),
        sets: [], winnerId: p1.id, createdAt: now2 + mc,
      };
      r1Summaries.push(`  (부전승) ${p1.name}(${p1.gid}${p1.rank}위)`);
    } else if (p2) {
      // BYE: p2 자동 진출
      bulk2[`matches/${tid}/${mKey}`] = {
        tournamentId: tid, type: tour2.type || "individual", status: "completed",
        round: 1, bracketPosition: i, bracketRound: firstRoundName, roundLabel: firstRoundName,
        stageId: finalsStageId2, isBye: true,
        player1Id: "BYE", player2Id: p2.id,
        player1Name: "부전승", player2Name: p2.name,
        ...(isTeamTour2 ? { team1Id: "BYE", team2Id: p2.id, team1Name: "부전승", team2Name: p2.name } : {}),
        sets: [], winnerId: p2.id, createdAt: now2 + mc,
      };
      r1Summaries.push(`  (부전승) ${p2.name}(${p2.gid}${p2.rank}위)`);
    } else {
      // 양쪽 모두 없음 (일어나면 안 되지만 안전장치)
      bulk2[`matches/${tid}/${mKey}`] = {
        tournamentId: tid, type: tour2.type || "individual", status: "completed",
        round: 1, bracketPosition: i, bracketRound: firstRoundName, roundLabel: firstRoundName,
        stageId: finalsStageId2, isBye: true,
        player1Id: "BYE", player2Id: "BYE",
        player1Name: "부전승", player2Name: "부전승",
        sets: [], winnerId: null, createdAt: now2 + mc,
      };
    }
    r1Keys.push(mKey);
    mc++;
  }
  const byeCount = halfBracket - r1RealCount;
  summary.push(`\n[ ${firstRoundName} ] ${r1RealCount}경기${byeCount > 0 ? ` (부전승 ${byeCount})` : ""}`);
  summary.push(...r1Summaries);
  roundMatchKeys.push(r1Keys);

  // 후속 라운드: bracketSize 기반으로 정확한 라운드 수 생성
  let remainingSlots = halfBracket; // 1라운드 매치 수 (= bracketSize/2)
  let roundNum = 2;
  while (remainingSlots > 1) {
    const nextSlots = Math.floor(remainingSlots / 2);
    const rName = getRoundName(remainingSlots); // remainingSlots = 이 라운드의 참가자 수
    const rKeys: string[] = [];
    const prevRName = getRoundName(remainingSlots * 2);
    summary.push(`\n[ ${rName} ] ${nextSlots}경기`);
    for (let i = 0; i < nextSlots; i++) {
      const mKey = db.ref(`matches/${tid}`).push().key!;
      bulk2[`matches/${tid}/${mKey}`] = {
        tournamentId: tid, type: tour2.type || "individual", status: "pending",
        round: roundNum, bracketPosition: i, bracketRound: rName, roundLabel: rName,
        stageId: finalsStageId2,
        player1Id: "", player2Id: "",
        player1Name: `${prevRName} 승자${i * 2 + 1}`, player2Name: `${prevRName} 승자${i * 2 + 2}`,
        ...(isTeamTour2 ? { team1Id: "", team2Id: "", team1Name: `${prevRName} 승자${i * 2 + 1}`, team2Name: `${prevRName} 승자${i * 2 + 2}` } : {}),
        sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
        currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
        winnerId: null, createdAt: now2 + mc,
        sourceMatch1: roundMatchKeys[roundMatchKeys.length - 1][i * 2],
        sourceMatch2: roundMatchKeys[roundMatchKeys.length - 1][i * 2 + 1],
      };
      summary.push(`  ${i + 1}. ${prevRName} 승자${i * 2 + 1} vs ${prevRName} 승자${i * 2 + 2}`);
      rKeys.push(mKey);
      mc++;
    }
    roundMatchKeys.push(rKeys);
    remainingSlots = nextSlots;
    roundNum++;
  }

  // 3/4위 결정전 (bracketSize >= 4이면 4강이 존재하므로 가능)
  if (includeThirdPlace2 && bracketSize >= 4) {
    const sfKeys = roundMatchKeys[roundMatchKeys.length - 2]; // 4강 키
    const mKey = db.ref(`matches/${tid}`).push().key!;
    bulk2[`matches/${tid}/${mKey}`] = {
      tournamentId: tid, type: tour2.type || "individual", status: "pending",
      round: roundNum, bracketRound: "3/4위", roundLabel: "3/4위 결정전", stageId: `${finalsStageId2}_3rd`,
      player1Id: "", player2Id: "", player1Name: "4강 패자1", player2Name: "4강 패자2",
      ...(isTeamTour2 ? { team1Id: "", team2Id: "", team1Name: "4강 패자1", team2Name: "4강 패자2" } : {}),
      sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
      currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
      winnerId: null, createdAt: now2 + mc,
      sourceMatch1: sfKeys?.[0], sourceMatch2: sfKeys?.[1], sourceType: "loser",
    };
    summary.push("\n[ 3/4위 결정전 ] 1경기");
    mc++;
  }

  // 5-8위, 9-16위는 run_full_simulation에서 브라켓 시뮬 완료 후 직접 생성
  // (여기서 sourceMatch 방식으로 사전 생성하면 run_full_simulation과 중복됨)

  // 순위 결정전: 그룹 예선 탈락자를 티어별로 분류 (17위~)
  // rankingUpTo > 0이면 해당 순위까지만 순위 결정전 진행
  const doRanking = rankingUpTo > 0 || includeFifthToEighth2 || includeClassification2;
  if (doRanking && eliminated.length >= 2) {
    const elimTeamData = isTeamTour2
      ? await db.ref(`teams/${tid}`).once("value").then(s => s.exists() ? s.val() as Record<string, { memberIds?: string[]; memberNames?: string[]; coachName?: string }> : {})
      : {};

    const classGroupSize = (rankingConfig2?.classificationGroupSize as number) || 8;
    const tierSize = Math.max(4, classGroupSize);
    const advCount = advanced.length;

    // rankingUpTo가 설정되면 해당 순위까지의 탈락자만 사용
    const maxRankingSlots = rankingUpTo > 0 ? Math.max(0, rankingUpTo - advCount) : eliminated.length;
    const rankableEliminated = eliminated.slice(0, Math.min(maxRankingSlots, eliminated.length));

    const tiers: Array<{ label: string; members: typeof eliminated }> = [];

    if (rankableEliminated.length >= 2) {
      // rankingUpTo만 설정된 경우 (fifthToEighth/classification 없이)
      // → tierSize 단위로 자동 분류
      if (rankingUpTo > 0 && !includeFifthToEighth2 && !includeClassification2) {
        let remaining = [...rankableEliminated];
        let tierStart = advCount + 1;
        while (remaining.length >= 2) {
          const tierMembers = remaining.slice(0, tierSize);
          const tierEnd = tierStart + tierMembers.length - 1;
          tiers.push({ label: `${tierStart}~${tierEnd}위 순위 결정전`, members: tierMembers });
          remaining = remaining.slice(tierSize);
          tierStart = tierEnd + 1;
        }
      } else if (includeClassification2) {
        // classificationGroups:true일 때만 그룹 탈락자 순위결정전 생성
        // (fifthToEighth만 true이면 5-8위는 run_full_simulation에서 처리)
        let remaining = [...rankableEliminated];
        let tierStart = advCount + 1;
        while (remaining.length >= 2) {
          const tierMembers = remaining.slice(0, tierSize);
          const tierEnd = tierStart + tierMembers.length - 1;
          tiers.push({ label: `${tierStart}~${tierEnd}위 순위 결정전`, members: tierMembers });
          remaining = remaining.slice(tierSize);
          tierStart = tierEnd + 1;
        }
      }
    }

    // 각 티어별 라운드로빈 경기 생성
    for (let t = 0; t < tiers.length; t++) {
      const tier = tiers[t];
      let tierMc = 0;
      for (let i = 0; i < tier.members.length; i++) {
        for (let j = i + 1; j < tier.members.length; j++) {
          const e1 = tier.members[i], e2 = tier.members[j];
          const mKey = db.ref(`matches/${tid}`).push().key!;
          const t1d = elimTeamData[e1.id] || {};
          const t2d = elimTeamData[e2.id] || {};
          bulk2[`matches/${tid}/${mKey}`] = {
            tournamentId: tid, type: tour2.type || "individual", status: "pending",
            round: tierMc + 1, stageId: `${finalsStageId2}_class_${t}`,
            bracketRound: tier.label, roundLabel: tier.label,
            player1Id: e1.id, player2Id: e2.id,
            player1Name: e1.name, player2Name: e2.name,
            ...(isTeamTour2 ? {
              team1Id: e1.id, team2Id: e2.id, team1Name: e1.name, team2Name: e2.name,
              team1: { memberIds: t1d.memberIds || [], memberNames: t1d.memberNames || [], coachName: t1d.coachName || "" },
              team2: { memberIds: t2d.memberIds || [], memberNames: t2d.memberNames || [], coachName: t2d.coachName || "" },
              player1Coach: t1d.coachName || "", player2Coach: t2d.coachName || "",
            } : {}),
            sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
            currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
            winnerId: null, createdAt: now2 + mc,
          };
          mc++; tierMc++;
        }
      }
      summary.push(`[ ${tier.label} ] ${tier.members.length}명, ${tierMc}경기`);
    }
  }

  await db.ref().update(bulk2);

  // 조별 순위
  const gRank = gids.map(gid => {
    const s = [...gStats.get(gid)!.values()].sort((a, b) => b.wins - a.wins || b.sd - a.sd);
    return `${gid}: ${s.map((p, i) => `${i + 1}.${p.name}(${p.wins}승)`).join(", ")}`;
  }).join("\n");

  return JSON.stringify({
    success: true, matchCount: mc,
    advancedCount: advanced.length, eliminatedCount: eliminated.length,
    structure: summary.join("\n"), groupRankings: gRank,
    message: `본선 ${mc}경기 생성 완료\n${summary.join("\n")}`,
  });
}
