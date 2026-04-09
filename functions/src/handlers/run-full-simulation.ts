/**
 * 전체 시뮬레이션 워크플로우 핸들러 (run_full_simulation)
 * - 예선 시뮬레이션 → 본선 생성/시뮬 → 5-8위/9-16위/17위~ 순위결정전 → 최종 순위 산출
 */
import { db } from "../db-helpers";
import {
  computeGroupRankings,
  computeFinalRanking,
  computeRankingDisplayCount,
  type MatchLike,
} from "../lib/rankings-compute";

type ExecuteTool = (name: string, input: Record<string, unknown>) => Promise<string>;

export async function runFullSimulation(input: Record<string, unknown>, executeTool: ExecuteTool): Promise<string> {
  const tid = input.tournamentId as string;
  const allSteps: string[] = [];

  const tourSnap = await db.ref(`tournaments/${tid}`).once("value");
  if (!tourSnap.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다." });
  const tourData = tourSnap.val() as Record<string, unknown>;
  const isTeam = tourData.type === "team" || tourData.type === "randomTeamLeague";

  // 풀리그 여부 확인
  const simTourFormat = tourData.format as string || "";
  const simIsFullLeague = simTourFormat === "full_league" || tourData.formatType === "round_robin";

  // 1. 리그/예선 시뮬레이션 (결승 자동 생성 비활성화 — run_full_simulation이 직접 처리)
  const simResult = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
  const simParsed = JSON.parse(simResult);
  if (!simParsed.success && simParsed.count !== 0) return JSON.stringify({ error: `${simIsFullLeague ? "리그" : "예선"} 시뮬레이션 실패: ${simParsed.error}` });
  allSteps.push(`${simIsFullLeague ? "리그" : "예선"} ${simParsed.count}경기 완료`);

  // 2. 결승 생성 + 시뮬레이션 (풀리그 제외)
  if (!simIsFullLeague) {
    // 결승이 없으면 생성
    const mSnap = await db.ref(`matches/${tid}`).once("value");
    const allM = mSnap.exists() ? Object.values(mSnap.val() as Record<string, Record<string, unknown>>) : [];
    const hasFinals = allM.some(m => ((m.stageId as string) || "").includes("finals") || ((m.stageId as string) || "").includes("ranking"));

    if (!hasFinals) {
      const fc = tourData.finalsConfig as Record<string, unknown> | undefined;
      const rc = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
      const genR = await executeTool("generate_finals", {
        tournamentId: tid,
        advancePerGroup: (fc?.advancePerGroup as number) || 2,
        wildcardCount: (fc?.wildcardCount as number) || 0,
        includeThirdPlace: rc?.thirdPlace !== false,
        includeFifthToEighth: rc?.fifthToEighth || false,
        includeClassification: rc?.classificationGroups || false,
      });
      const genP = JSON.parse(genR);
      if (genP.success) {
        allSteps.push(`본선 ${genP.matchCount}경기 생성 (${genP.structure || ""})`);
      } else {
        allSteps.push(`본선 생성 오류: ${genP.error || "unknown"}`);
      }
    } else {
      allSteps.push("본선 이미 존재");
    }

    // 본선 + 분류 경기 반복 시뮬레이션 (hasFinals 여부와 무관하게 항상 실행)
    let consecutiveZero = 0;
    for (let round = 0; round < 12; round++) {
      const finSim = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
      const finP = JSON.parse(finSim);
      if (finP.success && finP.count > 0) {
        allSteps.push(`라운드${round + 1}: ${finP.count}경기 완료`);
        consecutiveZero = 0;
      } else if (finP.success) {
        consecutiveZero++;
        if (consecutiveZero >= 2) break;
      } else {
        consecutiveZero++;
        if (consecutiveZero >= 2) break;
      }
    }
  }

  // 2.5 브라켓 패자 기반 순위결정전 생성 + 시뮬레이션 (배치 처리)
  const mType = isTeam ? "team" : "individual";
  const nowElim = Date.now();
  const createElimRankingMatches = async (
    groups: Array<{ label: string; startRank: number; members: Array<{ id: string; name: string }> }>,
    baseStageId: string,
    timeOffset: number,
  ) => {
    // 1단계: 모든 그룹의 준결승/단일경기 한 번에 생성
    const allBulk: Record<string, unknown> = {};
    const semiKeyMap: Map<string, { semi1: string; semi2: string }> = new Map();
    let totalMc = 0;
    for (const grp of groups) {
      const members = grp.members;
      if (members.length < 2) continue;
      const stageId3 = `${baseStageId}_${grp.startRank}`;
      if (members.length >= 4) {
        const semi1Key = db.ref(`matches/${tid}`).push().key!;
        allBulk[`matches/${tid}/${semi1Key}`] = {
          tournamentId: tid, type: mType, status: "pending", round: 1, stageId: stageId3,
          bracketRound: `${grp.label} 결정전`, roundLabel: `${grp.label} 결정전`,
          player1Id: members[0].id, player2Id: members[3].id,
          player1Name: members[0].name, player2Name: members[3].name,
          ...(isTeam ? { team1Id: members[0].id, team2Id: members[3].id, team1Name: members[0].name, team2Name: members[3].name } : {}),
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + totalMc,
        };
        totalMc++;
        const semi2Key = db.ref(`matches/${tid}`).push().key!;
        allBulk[`matches/${tid}/${semi2Key}`] = {
          tournamentId: tid, type: mType, status: "pending", round: 1, stageId: stageId3,
          bracketRound: `${grp.label} 결정전`, roundLabel: `${grp.label} 결정전`,
          player1Id: members[1].id, player2Id: members[2].id,
          player1Name: members[1].name, player2Name: members[2].name,
          ...(isTeam ? { team1Id: members[1].id, team2Id: members[2].id, team1Name: members[1].name, team2Name: members[2].name } : {}),
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + totalMc,
        };
        totalMc++;
        semiKeyMap.set(stageId3, { semi1: semi1Key, semi2: semi2Key });
      } else {
        // 2-3명: 단순 1경기
        const mKey = db.ref(`matches/${tid}`).push().key!;
        allBulk[`matches/${tid}/${mKey}`] = {
          tournamentId: tid, type: mType, status: "pending", round: 1, stageId: stageId3,
          bracketRound: `${grp.label} 결정전`, roundLabel: `${grp.startRank}/${grp.startRank + 1}위 결정전`,
          player1Id: members[0].id, player2Id: members[1].id,
          player1Name: members[0].name, player2Name: members[1].name,
          ...(isTeam ? { team1Id: members[0].id, team2Id: members[1].id, team1Name: members[0].name, team2Name: members[1].name } : {}),
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + totalMc,
        };
        totalMc++;
      }
    }
    if (totalMc === 0) return;
    await db.ref().update(allBulk);
    // 준결승 1회 시뮬레이션
    await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });

    // 2단계: 모든 그룹의 결승(승자전+패자전) 한 번에 생성
    if (semiKeyMap.size > 0) {
      const refreshSnap = await db.ref(`matches/${tid}`).once("value");
      const allM = refreshSnap.val() as Record<string, Record<string, unknown>>;
      const finalsBulk: Record<string, unknown> = {};
      let finalsMc = 0;
      for (const grp of groups) {
        if (grp.members.length < 4) continue;
        const stageId3 = `${baseStageId}_${grp.startRank}`;
        const keys = semiKeyMap.get(stageId3);
        if (!keys) continue;
        const sm1 = allM[keys.semi1], sm2 = allM[keys.semi2];
        if (!sm1 || !sm2 || sm1.status !== "completed" || sm2.status !== "completed") continue;

        const extractWL = (sm: Record<string, unknown>) => {
          const wId = sm.winnerId as string;
          const p1 = (sm.player1Id || sm.team1Id) as string;
          const wName = wId === p1 ? (sm.player1Name || sm.team1Name) as string : (sm.player2Name || sm.team2Name) as string;
          const lId = wId === p1 ? (sm.player2Id || sm.team2Id) as string : p1;
          const lName = wId === p1 ? (sm.player2Name || sm.team2Name) as string : (sm.player1Name || sm.team1Name) as string;
          return { wId, wName, lId, lName };
        };
        const w1 = extractWL(sm1), w2 = extractWL(sm2);

        const wKey = db.ref(`matches/${tid}`).push().key!;
        finalsBulk[`matches/${tid}/${wKey}`] = {
          tournamentId: tid, type: mType, status: "pending", round: 2, stageId: stageId3,
          bracketRound: `${grp.startRank}/${grp.startRank + 1}위`, roundLabel: `${grp.startRank}/${grp.startRank + 1}위 결정전`,
          player1Id: w1.wId, player2Id: w2.wId,
          player1Name: w1.wName, player2Name: w2.wName,
          ...(isTeam ? { team1Id: w1.wId, team2Id: w2.wId, team1Name: w1.wName, team2Name: w2.wName } : {}),
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + 1000 + finalsMc,
        };
        finalsMc++;
        const lKey = db.ref(`matches/${tid}`).push().key!;
        finalsBulk[`matches/${tid}/${lKey}`] = {
          tournamentId: tid, type: mType, status: "pending", round: 2, stageId: stageId3,
          bracketRound: `${grp.startRank + 2}/${grp.startRank + 3}위`, roundLabel: `${grp.startRank + 2}/${grp.startRank + 3}위 결정전`,
          player1Id: w1.lId, player2Id: w2.lId,
          player1Name: w1.lName, player2Name: w2.lName,
          ...(isTeam ? { team1Id: w1.lId, team2Id: w2.lId, team1Name: w1.lName, team2Name: w2.lName } : {}),
          sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
          currentSet: 0, player1Timeouts: 0, player2Timeouts: 0, winnerId: null, createdAt: nowElim + timeOffset + 1000 + finalsMc,
        };
        finalsMc++;
      }
      if (finalsMc > 0) {
        await db.ref().update(finalsBulk);
        await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
      }
    }
    allSteps.push(`${groups.length}개 순위결정전 그룹: ${totalMc}경기 완료`);
  };

  if (!simIsFullLeague) {
    const rankSnap = await db.ref(`matches/${tid}`).once("value");
    if (rankSnap.exists()) {
      const allRankM = Object.entries(rankSnap.val() as Record<string, Record<string, unknown>>);
      const completedFinals = allRankM.filter(([, m]) =>
        m.status === "completed" && !m.isBye &&
        ((m.stageId as string) || "").includes("finals") &&
        !((m.stageId as string) || "").includes("class") &&
        !((m.stageId as string) || "").includes("3rd") &&
        !((m.stageId as string) || "").includes("5to8")
      );

      // 라운드별 패자 수집
      const roundLosers = new Map<string, Array<{ id: string; name: string }>>();
      for (const [, m] of completedFinals) {
        const rl = (m.roundLabel || m.bracketRound || "") as string;
        if (!rl || rl === "결승") continue;
        if (!roundLosers.has(rl)) roundLosers.set(rl, []);
        const wId = m.winnerId as string;
        const p1Id = (m.player1Id || m.team1Id) as string;
        const p2Id = (m.player2Id || m.team2Id) as string;
        const loserId = wId === p1Id ? p2Id : p1Id;
        const loserName = wId === p1Id
          ? (m.player2Name || m.team2Name) as string
          : (m.player1Name || m.team1Name) as string;
        if (loserId && loserId !== "BYE" && loserName && loserName !== "부전승") {
          roundLosers.get(rl)!.push({ id: loserId, name: loserName });
        }
      }

      const finalsStageId = (tourData.stages as Array<{ id: string; type: string }>)?.find(s => s.type === "finals")?.id || "finals";
      // nowElim/mType 사용 (상위 스코프)

      // 5-8위 결정전: 8강 패자 4명
      const qfLosers = roundLosers.get("8강") || [];
      if (qfLosers.length >= 2) {
        const rankBulk: Record<string, unknown> = {};
        let rmc = 0;
        // 4명이면 풀 방식 (2 준결승 + 5/6위 + 7/8위), 2-3명이면 라운드로빈
        if (qfLosers.length >= 4) {
          // 준결승 2경기
          for (let qi = 0; qi < 2; qi++) {
            const p1 = qfLosers[qi], p2 = qfLosers[3 - qi];
            const mKey = db.ref(`matches/${tid}`).push().key!;
            rankBulk[`matches/${tid}/${mKey}`] = {
              tournamentId: tid, type: mType, status: "pending",
              round: 1, stageId: `${finalsStageId}_class_5to8`,
              bracketRound: "5-8위", roundLabel: "5-8위 결정전",
              player1Id: p1.id, player2Id: p2.id,
              player1Name: p1.name, player2Name: p2.name,
              ...(isTeam ? { team1Id: p1.id, team2Id: p2.id, team1Name: p1.name, team2Name: p2.name } : {}),
              sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
              currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
              winnerId: null, createdAt: nowElim + rmc,
            };
            rmc++;
          }
        } else {
          // 라운드로빈
          for (let i = 0; i < qfLosers.length; i++) {
            for (let j = i + 1; j < qfLosers.length; j++) {
              const mKey = db.ref(`matches/${tid}`).push().key!;
              rankBulk[`matches/${tid}/${mKey}`] = {
                tournamentId: tid, type: mType, status: "pending",
                round: 1, stageId: `${finalsStageId}_class_5to8`,
                bracketRound: "5~8위 순위 결정전", roundLabel: "5~8위 순위 결정전",
                player1Id: qfLosers[i].id, player2Id: qfLosers[j].id,
                player1Name: qfLosers[i].name, player2Name: qfLosers[j].name,
                ...(isTeam ? { team1Id: qfLosers[i].id, team2Id: qfLosers[j].id, team1Name: qfLosers[i].name, team2Name: qfLosers[j].name } : {}),
                sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                winnerId: null, createdAt: nowElim + rmc,
              };
              rmc++;
            }
          }
        }
        if (rmc > 0) {
          await db.ref().update(rankBulk);
          allSteps.push(`5-8위 결정전 ${rmc}경기 생성`);
          // 시뮬레이션 (준결승 → 5/6위, 7/8위)
          for (let r = 0; r < 3; r++) {
            const rs = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
            const rp = JSON.parse(rs);
            if (rp.success && rp.count > 0) {
              allSteps.push(`5-8위 라운드${r + 1}: ${rp.count}경기 완료`);
              // 풀 방식: 준결승 후 5/6위, 7/8위 매치 생성
              if (qfLosers.length >= 4 && r === 0) {
                const refreshSnap2 = await db.ref(`matches/${tid}`).once("value");
                const allM2 = refreshSnap2.val() as Record<string, Record<string, unknown>>;
                const semiMatches = Object.entries(allM2).filter(([, m2]) =>
                  m2.status === "completed" && (m2.roundLabel as string) === "5-8위 결정전" &&
                  ((m2.stageId as string) || "").includes("5to8")
                );
                if (semiMatches.length >= 2) {
                  const winners: Array<{ id: string; name: string }> = [];
                  const losers2: Array<{ id: string; name: string }> = [];
                  for (const [, sm] of semiMatches) {
                    const wId2 = sm.winnerId as string;
                    const p1Id2 = (sm.player1Id || sm.team1Id) as string;
                    const wName2 = wId2 === p1Id2 ? (sm.player1Name || sm.team1Name) as string : (sm.player2Name || sm.team2Name) as string;
                    const lId2 = wId2 === p1Id2 ? (sm.player2Id || sm.team2Id) as string : p1Id2;
                    const lName2 = wId2 === p1Id2 ? (sm.player2Name || sm.team2Name) as string : (sm.player1Name || sm.team1Name) as string;
                    winners.push({ id: wId2, name: wName2 });
                    losers2.push({ id: lId2, name: lName2 });
                  }
                  const finalBulk: Record<string, unknown> = {};
                  // 5/6위전
                  const k56 = db.ref(`matches/${tid}`).push().key!;
                  finalBulk[`matches/${tid}/${k56}`] = {
                    tournamentId: tid, type: mType, status: "pending",
                    round: 2, stageId: `${finalsStageId}_class_5to8`,
                    bracketRound: "5/6위", roundLabel: "5/6위 결정전",
                    player1Id: winners[0].id, player2Id: winners[1].id,
                    player1Name: winners[0].name, player2Name: winners[1].name,
                    ...(isTeam ? { team1Id: winners[0].id, team2Id: winners[1].id, team1Name: winners[0].name, team2Name: winners[1].name } : {}),
                    sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                    currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                    winnerId: null, createdAt: nowElim + 100,
                  };
                  // 7/8위전
                  const k78 = db.ref(`matches/${tid}`).push().key!;
                  finalBulk[`matches/${tid}/${k78}`] = {
                    tournamentId: tid, type: mType, status: "pending",
                    round: 2, stageId: `${finalsStageId}_class_5to8`,
                    bracketRound: "7/8위", roundLabel: "7/8위 결정전",
                    player1Id: losers2[0].id, player2Id: losers2[1].id,
                    player1Name: losers2[0].name, player2Name: losers2[1].name,
                    ...(isTeam ? { team1Id: losers2[0].id, team2Id: losers2[1].id, team1Name: losers2[0].name, team2Name: losers2[1].name } : {}),
                    sets: [{ player1Score: 0, player2Score: 0, winnerId: null }],
                    currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
                    winnerId: null, createdAt: nowElim + 101,
                  };
                  await db.ref().update(finalBulk);
                }
              }
            } else break;
          }
        }
      }

      // 9-16위 순위 결정전: classificationGroups가 true일 때만 실행
      const rankCfgCheck = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
      const r16Losers = roundLosers.get("16강") || roundLosers.get("32강") || [];
      if (rankCfgCheck?.classificationGroups && r16Losers.length >= 2) {
        // 4명씩 그룹 분할
        const r16Groups: Array<{ label: string; startRank: number; members: typeof r16Losers }> = [];
        let r16Remaining = [...r16Losers];
        let r16RankStart = 9; // 16강 패자 = 9위~
        while (r16Remaining.length >= 2) {
          const grpSize = Math.min(4, r16Remaining.length);
          const grpMembers = r16Remaining.slice(0, grpSize);
          const endRank = r16RankStart + grpSize - 1;
          r16Groups.push({ label: `${r16RankStart}~${endRank}위`, startRank: r16RankStart, members: grpMembers });
          r16Remaining = r16Remaining.slice(grpSize);
          r16RankStart = endRank + 1;
        }
        await createElimRankingMatches(r16Groups, `${finalsStageId}_class_9to16`, 200);
      }

      // 남은 미완료 경기 시뮬레이션 (5/6위, 7/8위 등)
      for (let extra = 0; extra < 3; extra++) {
        const extraSim = await executeTool("simulate_matches", { tournamentId: tid, skipAutoGenerate: true, lightweight: true });
        const extraP = JSON.parse(extraSim);
        if (extraP.success && extraP.count > 0) {
          allSteps.push(`추가 순위결정: ${extraP.count}경기 완료`);
        } else break;
      }

      // ===== Phase 2f: 17위~ 그룹 탈락자 순위결정전 직접 생성 =====
      // generate_finals의 classification 매치에 의존하지 않고 직접 생성
      const rankCfg = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
      const doClassification = rankCfg?.classificationGroups;
      if (doClassification) {
        // 조별 순위에서 본선 미진출자(탈락자) 수집
        const qualSnap2 = await db.ref(`matches/${tid}`).once("value");
        if (qualSnap2.exists()) {
          const allQualM = Object.entries(qualSnap2.val() as Record<string, Record<string, unknown>>);

          // 예선 경기에서 조별 순위 계산
          const gRankStats = new Map<string, Array<{ id: string; name: string; wins: number; sd: number; pd: number }>>();
          for (const [, qm] of allQualM) {
            if (qm.status !== "completed") continue;
            const qSid = (qm.stageId as string) || "";
            if (qSid.includes("finals") || qSid.includes("ranking") || qSid.includes("class") || qSid.includes("3rd") || qSid.includes("5to8")) continue;
            const qGid = (qm.groupId as string) || "";
            if (!qGid) continue;
            if (!gRankStats.has(qGid)) gRankStats.set(qGid, []);
            const gArr = gRankStats.get(qGid)!;
            const qp1 = (qm.player1Id || qm.team1Id) as string;
            const qp2 = (qm.player2Id || qm.team2Id) as string;
            const qn1 = (qm.player1Name || qm.team1Name) as string;
            const qn2 = (qm.player2Name || qm.team2Name) as string;
            let e1 = gArr.find(e => e.id === qp1);
            let e2 = gArr.find(e => e.id === qp2);
            if (!e1) { e1 = { id: qp1, name: qn1, wins: 0, sd: 0, pd: 0 }; gArr.push(e1); }
            if (!e2) { e2 = { id: qp2, name: qn2, wins: 0, sd: 0, pd: 0 }; gArr.push(e2); }
            if (qm.winnerId === qp1) e1.wins++; else if (qm.winnerId === qp2) e2.wins++;
            for (const qs of ((qm.sets || []) as Array<{ player1Score: number; player2Score: number }>)) {
              if (qs.player1Score > qs.player2Score) { e1.sd++; e2.sd--; } else if (qs.player2Score > qs.player1Score) { e2.sd++; e1.sd--; }
              e1.pd += qs.player1Score - qs.player2Score; e2.pd += qs.player2Score - qs.player1Score;
            }
          }

          // 본선 진출자 ID 수집
          const advancedIds2 = new Set<string>();
          for (const [, fm] of allQualM) {
            const fSid = (fm.stageId as string) || "";
            if (!fSid.includes("finals") || fSid.includes("class") || fSid.includes("3rd") || fSid.includes("5to8")) continue;
            const fp1 = (fm.player1Id || fm.team1Id) as string;
            const fp2 = (fm.player2Id || fm.team2Id) as string;
            if (fp1 && fp1 !== "" && fp1 !== "BYE") advancedIds2.add(fp1);
            if (fp2 && fp2 !== "" && fp2 !== "BYE") advancedIds2.add(fp2);
          }

          // 그룹 탈락자 수집 (성적순 정렬)
          const groupEliminated: Array<{ id: string; name: string; wins: number; sd: number; pd: number }> = [];
          for (const [, gArr] of [...gRankStats.entries()].sort()) {
            const sorted = [...gArr].sort((a, b) => b.wins - a.wins || b.sd - a.sd || b.pd - a.pd);
            for (const p of sorted) {
              if (!advancedIds2.has(p.id)) groupEliminated.push(p);
            }
          }

          // 이미 classification 매치가 있는지 확인
          const existingClass = allQualM.some(([, cm]) =>
            ((cm.stageId as string) || "").includes("class") && !((cm.stageId as string) || "").includes("5to8") && !((cm.stageId as string) || "").includes("9to16")
          );

          if (groupEliminated.length >= 2 && !existingClass) {
            const classStageId = (tourData.stages as Array<{ id: string; type: string }>)?.find(s => s.type === "finals")?.id || "finals";

            // 4명씩 그룹 분할 (IBSA 방식)
            const classGroups: Array<{ label: string; startRank: number; members: Array<{ id: string; name: string }> }> = [];
            let remaining2 = [...groupEliminated];
            // 17위부터 (본선 16명 + 5-8위 + 9-16위 = 16)
            let tierStart2 = 17;
            while (remaining2.length >= 2) {
              const grpSize = Math.min(4, remaining2.length);
              const grpMembers = remaining2.slice(0, grpSize);
              const endRank = tierStart2 + grpSize - 1;
              classGroups.push({ label: `${tierStart2}~${endRank}위`, startRank: tierStart2, members: grpMembers });
              remaining2 = remaining2.slice(grpSize);
              tierStart2 = endRank + 1;
            }

            await createElimRankingMatches(classGroups, `${classStageId}_class`, 500);
          }
        }
      }
    }
  }

  // 3. 대회 완료
  await db.ref(`tournaments/${tid}/status`).set("completed");

  // 4. 조별 순위 계산 — lib/rankings-compute의 순수 함수 위임
  const finalSnap = await db.ref(`matches/${tid}`).once("value");
  const finalM = finalSnap.exists() ? Object.entries(finalSnap.val() as Record<string, Record<string, unknown>>) : [];
  const matchList: MatchLike[] = finalM.map(([, m]) => m);
  const groupRankingsMap = computeGroupRankings(matchList);
  const groupRankings = [...groupRankingsMap.entries()].map(([gid, sorted]) => {
    const header = gid === "full_league" ? "최종 순위" : `${gid} 순위`;
    const tableHeader = "순위 | 이름 | 승 | 패 | 세트(승-패) | 득점-실점";
    const separator = "---|---|---|---|---|---";
    const rows = sorted.map((s, i) =>
      `${i + 1}위 | ${s.name} | ${s.wins}승 | ${s.losses}패 | ${s.setsWon}-${s.setsLost} | ${s.pointsFor}-${s.pointsAgainst}`
    ).join("\n");
    return `${header}:\n${tableHeader}\n${separator}\n${rows}`;
  }).join("\n\n");

  // 5. 본선 + 순위결정전 결과 (BYE 제외)
  const finalsResults = finalM
    .filter(([, m]) => m.status === "completed" && !m.isBye && ((m.stageId as string) || "").match(/finals|ranking|3rd|5to8|class/))
    .map(([, m]) => {
      const n1 = (m.team1Name || m.player1Name) as string, n2 = (m.team2Name || m.player2Name) as string;
      const winner = m.winnerId === (m.team1Id || m.player1Id) ? n1 : n2;
      const label = (m.roundLabel || m.bracketRound || "본선") as string;
      const sets = (m.sets || []) as Array<{ player1Score: number; player2Score: number }>;
      // 서브 기준 점수 계산
      const ctWinner = m.coinTossWinner as string || "player1";
      const ctChoice = m.coinTossChoice as string || "serve";
      const fServer = ctChoice === "serve" ? ctWinner : (ctWinner === "player1" ? "player2" : "player1");
      const scoreStr = sets.map((s, si) => {
        const srv = si % 2 === 0 ? fServer : (fServer === "player1" ? "player2" : "player1");
        const srvScore = srv === "player1" ? s.player1Score : s.player2Score;
        const rcvScore = srv === "player1" ? s.player2Score : s.player1Score;
        return `${srvScore}-${rcvScore}`;
      }).join(", ");
      return `[${label}] ${n1} vs ${n2} → ${winner} 승 (${scoreStr})`;
    }).join("\n");

  // 6. 팀 로스터
  let teamRoster = "";
  if (isTeam) {
    const tSnap = await db.ref(`teams/${tid}`).once("value");
    if (tSnap.exists()) {
      teamRoster = Object.values(tSnap.val() as Record<string, { name: string; memberNames?: string[]; coachName?: string }>)
        .map(t => `${t.name}: ${(t.memberNames || []).join(", ")}${t.coachName ? ` (코치: ${t.coachName})` : ""}`).join("\n");
    }
  }

  // 7. 최종 전체 순위 산출 — lib/rankings-compute의 순수 함수 위임
  const finalRanking: string[] = [];
  const sortedPlayers = computeFinalRanking(matchList);
  const rkCfg = tourData.rankingMatchConfig as Record<string, unknown> | undefined;
  const displayCount = computeRankingDisplayCount(sortedPlayers.length, rkCfg);
  for (let i = 0; i < displayCount; i++) {
    const p = sortedPlayers[i];
    finalRanking.push(`${i + 1}위: ${p.name} (${p.wins}승 ${p.losses}패, 세트 ${p.setsWon}-${p.setsLost})`);
  }

  return JSON.stringify({
    success: true, steps: allSteps, groupRankings, finalsResults, teamRoster,
    finalRanking: finalRanking.join("\n"),
    totalMatches: finalM.length,
    completedMatches: finalM.filter(([, m]) => m.status === "completed").length,
  });
}
