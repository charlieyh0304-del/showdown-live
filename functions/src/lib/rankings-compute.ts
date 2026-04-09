/**
 * 순위 계산 순수 로직
 *
 * RTDB 의존성 없이 매치 배열만 받아 통계/순위를 산출.
 * run-full-simulation.ts 등에서 추출한 알고리즘.
 *
 * 정렬 우선순위 (프론트엔드 calculateIndividualRanking과 동일):
 *   1. 승수 (높은 순)
 *   2. 세트 득실차 (setsWon - setsLost)
 *   3. 점수 득실차 (pointsFor - pointsAgainst)
 */

export interface PlayerStats {
  id: string;
  name: string;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** 매치가 가진 최소 필드 — 핸들러의 다양한 매치 형태(individual/team) 모두 호환 */
export interface MatchLike {
  status?: unknown;
  isBye?: unknown;
  stageId?: unknown;
  groupId?: unknown;
  player1Id?: unknown;
  player2Id?: unknown;
  team1Id?: unknown;
  team2Id?: unknown;
  player1Name?: unknown;
  player2Name?: unknown;
  team1Name?: unknown;
  team2Name?: unknown;
  winnerId?: unknown;
  sets?: unknown;
}

interface SetScore { player1Score?: unknown; player2Score?: unknown }

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asNum = (v: unknown): number => (typeof v === "number" && !isNaN(v) ? v : 0);

function getIds(m: MatchLike): { id1: string; id2: string; n1: string; n2: string } {
  return {
    id1: asStr(m.player1Id) || asStr(m.team1Id),
    id2: asStr(m.player2Id) || asStr(m.team2Id),
    n1: asStr(m.player1Name) || asStr(m.team1Name),
    n2: asStr(m.player2Name) || asStr(m.team2Name),
  };
}

/**
 * 매치 배열에서 선수별 통계를 누적.
 * 옵션으로 본선/순위결정전 제외, BYE 제외, 그룹 필터링 지원.
 */
export function accumulatePlayerStats(
  matches: ReadonlyArray<MatchLike>,
  opts: {
    /** stageId에 finals/ranking/3rd/5to8 포함된 경기 제외 (그룹 순위용 기본 true) */
    excludeFinals?: boolean;
    /** isBye=true 매치 제외 (전체 순위용 기본 true) */
    excludeBye?: boolean;
    /** 특정 groupId만 (없으면 전체) */
    onlyGroupId?: string;
  } = {},
): Map<string, PlayerStats> {
  const stats = new Map<string, PlayerStats>();
  const { excludeFinals = false, excludeBye = false, onlyGroupId } = opts;

  for (const m of matches) {
    if (m.status !== "completed") continue;
    if (excludeBye && m.isBye === true) continue;
    if (excludeFinals) {
      const sid = asStr(m.stageId);
      if (sid.includes("finals") || sid.includes("ranking") || sid.includes("3rd") || sid.includes("5to8")) continue;
    }
    if (onlyGroupId !== undefined && asStr(m.groupId) !== onlyGroupId) continue;

    const { id1, id2, n1, n2 } = getIds(m);
    if (!id1 || !id2 || id1 === "BYE" || id2 === "BYE") continue;

    if (!stats.has(id1)) stats.set(id1, { id: id1, name: n1, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
    if (!stats.has(id2)) stats.set(id2, { id: id2, name: n2, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
    const s1 = stats.get(id1)!;
    const s2 = stats.get(id2)!;

    if (m.winnerId === id1) { s1.wins++; s2.losses++; }
    else if (m.winnerId === id2) { s2.wins++; s1.losses++; }

    const sets = Array.isArray(m.sets) ? (m.sets as SetScore[]) : [];
    for (const s of sets) {
      const p1 = asNum(s.player1Score);
      const p2 = asNum(s.player2Score);
      if (p1 > p2) { s1.setsWon++; s2.setsLost++; }
      else if (p2 > p1) { s2.setsWon++; s1.setsLost++; }
      s1.pointsFor += p1; s1.pointsAgainst += p2;
      s2.pointsFor += p2; s2.pointsAgainst += p1;
    }
  }
  return stats;
}

/**
 * 누적 통계를 IBSA 표준 순으로 정렬.
 * 정렬 후 새 배열 반환 (원본 불변).
 */
export function sortByRanking(stats: ReadonlyArray<PlayerStats>): PlayerStats[] {
  return [...stats].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aSD = a.setsWon - a.setsLost;
    const bSD = b.setsWon - b.setsLost;
    if (bSD !== aSD) return bSD - aSD;
    return (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst);
  });
}

/**
 * 매치 배열로부터 그룹별 정렬된 순위 산출.
 * 결과: groupId → 정렬된 PlayerStats 배열
 */
export function computeGroupRankings(matches: ReadonlyArray<MatchLike>): Map<string, PlayerStats[]> {
  // groupId 수집
  const groupIds = new Set<string>();
  for (const m of matches) {
    if (m.status !== "completed") continue;
    const sid = asStr(m.stageId);
    if (sid.includes("finals") || sid.includes("ranking") || sid.includes("3rd") || sid.includes("5to8")) continue;
    groupIds.add(asStr(m.groupId) || "full_league");
  }
  const result = new Map<string, PlayerStats[]>();
  for (const gid of [...groupIds].sort()) {
    const stats = accumulatePlayerStats(matches, {
      excludeFinals: true,
      onlyGroupId: gid === "full_league" ? "" : gid,
    });
    result.set(gid, sortByRanking([...stats.values()]));
  }
  return result;
}

/**
 * 매치 배열로부터 전체(통합) 순위 산출.
 * BYE 제외, 본선 포함 모든 완료 경기 사용.
 */
export function computeFinalRanking(matches: ReadonlyArray<MatchLike>): PlayerStats[] {
  const stats = accumulatePlayerStats(matches, { excludeBye: true });
  return sortByRanking([...stats.values()]);
}

/**
 * 순위 표시 범위 계산.
 * - rankingUpTo > 0: 그 값 사용 (우선)
 * - classificationGroups: 전체
 * - fifthToEighth: 8
 * - 기본: 4 (결승까지)
 */
export function computeRankingDisplayCount(
  totalPlayers: number,
  config: { rankingUpTo?: unknown; classificationGroups?: unknown; fifthToEighth?: unknown } | undefined,
): number {
  if (!config) return Math.min(4, totalPlayers);
  if (typeof config.rankingUpTo === "number" && config.rankingUpTo > 0) {
    return Math.min(config.rankingUpTo, totalPlayers);
  }
  if (config.classificationGroups) return totalPlayers;
  if (config.fifthToEighth) return Math.min(8, totalPlayers);
  return Math.min(4, totalPlayers);
}

// ===== 순위결정전 그룹(tier) 분할 =====

/** tier 구성 항목 — id/name만 있으면 됨 */
export interface TierMember { id: string; name: string }

/** 분할된 tier */
export interface RankingTier<T extends TierMember = TierMember> {
  /** 한국어 라벨 (예: "9~12위") */
  label: string;
  /** tier 시작 순위 (예: 9) */
  startRank: number;
  /** tier 종료 순위 (예: 12) */
  endRank: number;
  /** tier에 포함된 멤버 (입력 배열 순서 그대로) */
  members: T[];
}

/**
 * 정렬된 멤버 배열을 tierSize 단위로 순차 분할.
 *
 * 규칙:
 * - 시작 순위 startRank부터 누적
 * - 각 tier는 최대 tierSize명, 마지막 tier는 더 적을 수 있음
 * - 멤버 < 2면 tier 미생성 (1명 vs 1명 결정전이 불가능)
 *
 * 예: 9명을 startRank=9, tierSize=4로 분할
 *  → [9~12위, 13~16위, 17위 (1명 → 제외)]
 *  → 결과: [9~12위(4명), 13~16위(4명)] (마지막 1명은 짝이 없어 버림)
 *
 * IBSA 9-16위 결정전 / 17위~ classification 양쪽에서 사용.
 */
export function splitIntoRankingTiers<T extends TierMember>(
  sortedMembers: ReadonlyArray<T>,
  tierSize: number,
  startRank: number,
): Array<RankingTier<T>> {
  if (tierSize < 2) return [];
  const tiers: Array<RankingTier<T>> = [];
  let remaining = [...sortedMembers];
  let cursor = startRank;
  while (remaining.length >= 2) {
    const grpSize = Math.min(tierSize, remaining.length);
    const grpMembers = remaining.slice(0, grpSize);
    const endRank = cursor + grpSize - 1;
    tiers.push({
      label: `${cursor}~${endRank}위`,
      startRank: cursor,
      endRank,
      members: grpMembers,
    });
    remaining = remaining.slice(grpSize);
    cursor = endRank + 1;
  }
  return tiers;
}
