/**
 * 순위 조회 핸들러 — get_tournament_rankings
 * chatbot-tools.ts에서 분리됨 (모듈화의 첫 단계)
 */
import { db, asString } from "../db-helpers";
import { aggregateStandings, normalizeResults, resultContextFor } from "../shared/rules/standings";
import { finalPlacementsFor } from "../shared/rules/finalRanking";

export interface RankingEntry {
  rank: number;
  name: string;
  wins: number;
  losses: number;
  sets: string;
  /** 공동 순위 */
  joint?: boolean;
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
 * - 본선이 있으면 대진 결과로 (shared/rules/finalRanking)
 * - 대진이 없으면 순위표 + 대회 동률 규칙
 */
export async function getTournamentRankings(
  tid: string,
  topN?: number,
): Promise<TournamentRankingsResponse> {
  // 대회 정보
  const tSnap = await db.ref(`tournaments/${tid}`).once("value");
  if (!tSnap.exists()) return { error: "대회를 찾을 수 없습니다." };
  const tData = tSnap.val() as Record<string, unknown>;
  const tName = asString(tData.name);
  const isTeamT = tData.type === "team" || tData.type === "randomTeamLeague";

  // 모든 완료 경기
  const mSnap = await db.ref(`matches/${tid}`).once("value");
  if (!mSnap.exists()) return { tournamentName: tName, rankings: [], message: "경기 정보 없음" };
  const allMatches = Object.values(mSnap.val() as Record<string, Record<string, unknown>>);

  // 최종 순위: 대진 결과(결승 → 3/4위전 → 순위결정전 → 라운드), 대진이 없으면 순위표 + 동률 규칙.
  // 순위표/통계는 대회 규칙(shared/rules)의 점수 규칙·부전승 집계 설정을 따른다.
  const ctx = resultContextFor(tData, "stats");
  const statRows = aggregateStandings(normalizeResults(allMatches, ctx), ctx.rules);
  const rankings: RankingEntry[] = finalPlacementsFor(allMatches, tData).map(p => {
    const st = statRows.get(p.id);
    return {
      rank: p.place,
      name: p.name,
      wins: st?.wins || 0,
      losses: st?.losses || 0,
      sets: st ? `${st.setsWon}-${st.setsLost}` : "",
      ...(p.joint ? { joint: true } : {}),
    };
  });

  const finalRankings = topN ? rankings.slice(0, topN) : rankings;
  return {
    tournamentName: tName,
    tournamentType: isTeamT ? "team" : "individual",
    totalMatches: allMatches.length,
    completedMatches: allMatches.filter(m => m.status === "completed").length,
    rankings: finalRankings,
  };
}
