/**
 * 순위 조회 핸들러 — get_tournament_rankings
 * chatbot-tools.ts에서 분리됨 (모듈화의 첫 단계)
 */
import { db } from "../db-helpers";

export interface RankingEntry {
  rank: number;
  name: string;
  wins: number;
  losses: number;
  sets: string;
}

export interface TournamentRankingsResponse {
  tournamentName?: string;
  tournamentType?: "team" | "individual";
  totalMatches?: number;
  completedMatches?: number;
  rankings?: RankingEntry[];
  error?: string;
  message?: string;
}

/**
 * 대회 순위 조회
 * - 본선 결과(1-4위)를 우선 사용
 * - 5위 이하는 통합 순위 (승수 → 세트득실 → 점수득실)
 */
export async function getTournamentRankings(
  tid: string,
  topN?: number,
): Promise<TournamentRankingsResponse> {
  // 대회 정보
  const tSnap = await db.ref(`tournaments/${tid}`).once("value");
  if (!tSnap.exists()) return { error: "대회를 찾을 수 없습니다." };
  const tData = tSnap.val() as Record<string, unknown>;
  const tName = tData.name as string;
  const isTeamT = tData.type === "team" || tData.type === "randomTeamLeague";

  // 모든 완료 경기
  const mSnap = await db.ref(`matches/${tid}`).once("value");
  if (!mSnap.exists()) return { tournamentName: tName, rankings: [], message: "경기 정보 없음" };
  const allMatches = Object.values(mSnap.val() as Record<string, Record<string, unknown>>);

  // 1) 본선 결승/3-4위 결과 → 1-4위
  const finalsResults: Map<number, { id: string; name: string }> = new Map();
  for (const m of allMatches) {
    if (m.status !== "completed" || m.isBye) continue;
    const sid = (m.stageId as string) || "";
    const rl = (m.roundLabel as string) || "";
    const br = (m.bracketRound as string) || "";
    const wId = m.winnerId as string;
    const p1Id = (m.player1Id || m.team1Id) as string;
    const wName = wId === p1Id ? (m.player1Name || m.team1Name) as string : (m.player2Name || m.team2Name) as string;
    const lId = wId === p1Id ? (m.player2Id || m.team2Id) as string : p1Id;
    const lName = wId === p1Id ? (m.player2Name || m.team2Name) as string : (m.player1Name || m.team1Name) as string;

    if ((br === "결승" || rl === "결승") && sid.includes("finals") && !sid.includes("class") && !sid.includes("3rd")) {
      finalsResults.set(1, { id: wId, name: wName });
      finalsResults.set(2, { id: lId, name: lName });
    }
    if (br === "3/4위" || sid.includes("3rd")) {
      finalsResults.set(3, { id: wId, name: wName });
      finalsResults.set(4, { id: lId, name: lName });
    }
  }

  // 2) 전체 통합 순위 (모든 경기 기반)
  const stats = new Map<string, { name: string; wins: number; losses: number; setsWon: number; setsLost: number; pf: number; pa: number }>();
  for (const m of allMatches) {
    if (m.status !== "completed" || m.isBye) continue;
    const id1 = (m.player1Id || m.team1Id) as string;
    const id2 = (m.player2Id || m.team2Id) as string;
    const n1 = (m.player1Name || m.team1Name) as string;
    const n2 = (m.player2Name || m.team2Name) as string;
    if (!id1 || !id2 || id1 === "BYE" || id2 === "BYE") continue;
    if (!stats.has(id1)) stats.set(id1, { name: n1, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pf: 0, pa: 0 });
    if (!stats.has(id2)) stats.set(id2, { name: n2, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pf: 0, pa: 0 });
    const s1 = stats.get(id1)!, s2 = stats.get(id2)!;
    if (m.winnerId === id1) { s1.wins++; s2.losses++; }
    else if (m.winnerId === id2) { s2.wins++; s1.losses++; }
    for (const s of ((m.sets || []) as Array<{ player1Score: number; player2Score: number }>)) {
      if (s.player1Score > s.player2Score) { s1.setsWon++; s2.setsLost++; }
      else if (s.player2Score > s.player1Score) { s2.setsWon++; s1.setsLost++; }
      s1.pf += s.player1Score; s1.pa += s.player2Score;
      s2.pf += s.player2Score; s2.pa += s.player1Score;
    }
  }
  const sorted = [...stats.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aSD = a.setsWon - a.setsLost, bSD = b.setsWon - b.setsLost;
    if (bSD !== aSD) return bSD - aSD;
    return (b.pf - b.pa) - (a.pf - a.pa);
  });

  // 본선 순위가 있으면 그것을 우선 (1-4위), 없으면 통합 순위 사용
  const rankings: RankingEntry[] = [];
  if (finalsResults.size > 0) {
    for (let r = 1; r <= 4; r++) {
      const entry = finalsResults.get(r);
      if (entry) {
        const st = stats.get(entry.id);
        rankings.push({
          rank: r,
          name: entry.name,
          wins: st?.wins || 0,
          losses: st?.losses || 0,
          sets: st ? `${st.setsWon}-${st.setsLost}` : "",
        });
      }
    }
    const finalsIds = new Set([...finalsResults.values()].map(v => v.id));
    const rest = sorted.filter(s => {
      const id = [...stats.entries()].find(([, v]) => v === s)?.[0];
      return id && !finalsIds.has(id);
    });
    rest.forEach((s, i) => {
      rankings.push({ rank: 5 + i, name: s.name, wins: s.wins, losses: s.losses, sets: `${s.setsWon}-${s.setsLost}` });
    });
  } else {
    sorted.forEach((s, i) => {
      rankings.push({ rank: i + 1, name: s.name, wins: s.wins, losses: s.losses, sets: `${s.setsWon}-${s.setsLost}` });
    });
  }

  const finalRankings = topN ? rankings.slice(0, topN) : rankings;
  return {
    tournamentName: tName,
    tournamentType: isTeamT ? "team" : "individual",
    totalMatches: allMatches.length,
    completedMatches: allMatches.filter(m => m.status === "completed").length,
    rankings: finalRankings,
  };
}
