/**
 * 전체 시뮬레이션 워크플로우 핸들러 (run_full_simulation)
 * - 예선 시뮬레이션 → 본선 생성(generate_finals) → 본선·순위결정전 시뮬레이션 반복 → 최종 순위 산출
 *
 * 어떤 순위결정전을 만들지는 모두 대회 규칙(resolveCompetitionRules(..).finalRanking)이 정한다:
 * 3/4위전(thirdPlace), 5~8위 결정전(fifthToEighthMatches: 8강 패자 링크), 예선 탈락자 순위 결정전 리그
 * (classificationGroups + classificationGroupSize 티어). generate_finals가 한 번에 만들고,
 * 패자/승자 링크는 simulate_matches의 진출 처리(lib/advancement)가 채운다. 여기서 경기를 직접 만들지 않는다.
 * 순위표·최종 순위는 shared/rules(rankMatches, computeFinalPlacements)로 계산한다.
 */
import { db } from "../db-helpers";
import { toList } from "../shared/rules/competitionRules";
import { resultContextFor, type MatchLike } from "../shared/rules/standings";
import { rankMatches, splitByGroup } from "../shared/rules/qualification";
import { finalPlacementsFor } from "../shared/rules/finalRanking";

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
    const stageIds = toList<Record<string, unknown>>(tourData.stages).filter(x => x && typeof x === "object" && x.type !== "qualifying").map(x => x.id).filter((x): x is string => typeof x === "string");
    const hasFinals = allM.some(m => typeof m.stageId === "string" && stageIds.some(sid => m.stageId === sid || (m.stageId as string).startsWith(`${sid}_`)));

    if (!hasFinals) {
      const genR = await executeTool("generate_finals", {
        tournamentId: tid,
        // 3/4위전·5~8위 결정전·순위 결정전 리그는 대회 규칙(finalRanking)에서 generate_finals가 읽는다 (여기서 강제하지 않음)
        // 시뮬레이션: 진출 경계 동률은 seed 추첨으로 정하고 그 결정을 기록한다
        resolveTiesByLot: true,
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
    for (let round = 0; round < 16; round++) {
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

  // 3. 대회 완료
  await db.ref(`tournaments/${tid}/status`).set("completed");

  // 4. 조별 순위 계산 — 대회 규칙 단일 설정원(shared/rules)의 순위·동률 규칙
  const finalSnap = await db.ref(`matches/${tid}`).once("value");
  const finalM = finalSnap.exists() ? Object.entries(finalSnap.val() as Record<string, Record<string, unknown>>) : [];
  const matchList: MatchLike[] = finalM.map(([, m]) => m);
  const latestTourSnap = await db.ref(`tournaments/${tid}`).once("value");
  const latestTour = (latestTourSnap.exists() ? latestTourSnap.val() : tourData) as Record<string, unknown>;
  // 예선(리그) 경기 = 예선 스테이지 경기 (스테이지가 없는 옛 대회는 조 경기)
  const stageList = toList<Record<string, unknown>>(latestTour.stages).filter(x => x && typeof x === "object");
  const qualStageId = stageList.find(x => x.type === "qualifying")?.id;
  const finalsStageId = stageList.find(x => x.type === "finals")?.id;
  // 조별 순위표는 예선 스테이지 규칙(동률 기준·승점·부전승 집계)으로
  const rankCtx = resultContextFor(latestTour, "standings", typeof qualStageId === "string" ? qualStageId : undefined);
  const inStage = (m: MatchLike, sid: unknown) => typeof sid === "string" && typeof m.stageId === "string" && (m.stageId === sid || m.stageId.startsWith(`${sid}_`));
  const leagueMatches = matchList.filter(m => (qualStageId ? m.stageId === qualStageId : !!m.groupId));
  const groupRankings = splitByGroup(leagueMatches).filter(g => g.matches.some(m => m.status === "completed")).map(({ groupId, matches }) => {
    const header = !groupId || groupId === "full_league" ? "최종 순위" : `${groupId} 순위`;
    const tableHeader = "순위 | 이름 | 승 | 패 | 세트(승-패) | 득점-실점";
    const separator = "---|---|---|---|---|---";
    const rows = rankMatches(matches, rankCtx, groupId).ranked.map(({ row: s, rank, tied }) =>
      `${rank}위${tied ? "(공동)" : ""} | ${s.name} | ${s.wins}승 | ${s.losses}패 | ${s.setsWon}-${s.setsLost} | ${s.pointsFor}-${s.pointsAgainst}`
    ).join("\n");
    return `${header}:\n${tableHeader}\n${separator}\n${rows}`;
  }).join("\n\n");

  // 5. 본선 + 순위결정전 결과 (BYE 제외)
  const finalsResults = finalM
    .filter(([, m]) => m.status === "completed" && !m.isBye && (finalsStageId ? inStage(m, finalsStageId) : !leagueMatches.includes(m)))
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

  // 7. 최종 전체 순위 산출 — shared/rules/finalRanking
  // 총 승수가 아니라 대진 결과(결승 → 3/4위전 → 순위결정전 → 라운드)로 정한다 (B4)
  const finalRanking = finalPlacementsFor(matchList, latestTour)
    .map(p => `${p.place}위${p.joint ? "(공동)" : ""}: ${p.name}`);

  return JSON.stringify({
    success: true, steps: allSteps, groupRankings, finalsResults, teamRoster,
    finalRanking: finalRanking.join("\n"),
    totalMatches: finalM.length,
    completedMatches: finalM.filter(([, m]) => m.status === "completed").length,
  });
}
