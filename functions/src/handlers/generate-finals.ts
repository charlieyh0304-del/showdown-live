/**
 * 본선 브라켓 + 순위결정전 생성 핸들러 (generate_finals)
 *
 * 로직(가드·진출자 선정·동률·시드·부전승 점수)은 lib/finals-plan.ts(순수 함수)에 있다.
 * 여기서는 DB 읽기와 한 번의 multi-path 쓰기만 한다.
 */
import { db } from "../db-helpers";
import { planFinals, isPlanError, type FinalsPlanInput } from "../lib/finals-plan";

export async function generateFinals(input: Record<string, unknown>): Promise<string> {
  const tid = input.tournamentId as string;
  const tourSnap = await db.ref(`tournaments/${tid}`).once("value");
  if (!tourSnap.exists()) return JSON.stringify({ error: "대회를 찾을 수 없습니다.", code: "not_found" });
  const tour = tourSnap.val() as Record<string, unknown>;

  const matchesSnap = await db.ref(`matches/${tid}`).once("value");
  if (!matchesSnap.exists()) return JSON.stringify({ error: "경기가 없습니다.", code: "no_qualifying" });
  const allMatches = matchesSnap.val() as Record<string, Record<string, unknown>>;

  const isTeam = tour.type === "team" || tour.type === "randomTeamLeague";
  const teams = isTeam
    ? await db.ref(`teams/${tid}`).once("value").then(s => (s.exists() ? s.val() as Record<string, { memberIds?: string[]; memberNames?: string[]; coachName?: string }> : {}))
    : {};

  const opts: FinalsPlanInput = {
    advancePerGroup: typeof input.advancePerGroup === "number" ? input.advancePerGroup : undefined,
    wildcardCount: typeof input.wildcardCount === "number" ? input.wildcardCount : undefined,
    includeThirdPlace: typeof input.includeThirdPlace === "boolean" ? input.includeThirdPlace : undefined,
    includeFifthToEighth: typeof input.includeFifthToEighth === "boolean" ? input.includeFifthToEighth : undefined,
    includeClassification: typeof input.includeClassification === "boolean" ? input.includeClassification : undefined,
    rankingUpTo: typeof input.rankingUpTo === "number" ? input.rankingUpTo : undefined,
    force: input.force === true,
    resolveTiesByLot: input.resolveTiesByLot === true,
    lotSeed: typeof input.lotSeed === "string" ? input.lotSeed : undefined,
  };

  const plan = planFinals(tid, tour, allMatches, opts, {
    makeKey: () => db.ref(`matches/${tid}`).push().key!,
    now: Date.now(),
    teams,
  });
  if (isPlanError(plan)) return JSON.stringify(plan);

  const bulk: Record<string, unknown> = {};
  for (const { key, match } of plan.matches) bulk[`matches/${tid}/${key}`] = match;
  if (plan.newStage) {
    const stages = Array.isArray(tour.stages) ? tour.stages : tour.stages ? Object.values(tour.stages as Record<string, unknown>) : [];
    bulk[`tournaments/${tid}/stages`] = [...stages, plan.newStage];
  }
  for (const [key, d] of Object.entries(plan.decisions)) bulk[`tournaments/${tid}/rules/tiebreakDecisions/${key}`] = d;
  await db.ref().update(bulk);

  return JSON.stringify({
    success: true,
    matchCount: plan.matches.length,
    advancedCount: plan.qualifiers.length,
    eliminatedCount: plan.eliminated.length,
    structure: plan.summary.join("\n"),
    groupRankings: plan.groupRankings,
    ...(Object.keys(plan.decisions).length > 0 ? { tiebreakDecisions: plan.decisions } : {}),
    message: `본선 ${plan.matches.length}경기 생성 완료\n${plan.summary.join("\n")}`,
  });
}
