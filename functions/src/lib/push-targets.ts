/**
 * 푸시 알림 대상 고르기 (순수 함수, index.ts onMatchChange·preMatchNotify가 쓴다).
 * 구독 기록에는 토큰과 즐겨찾기 선수 ID·이름이 있다. 선수 ID는 대회마다 달라(tournamentPlayers/{tid}) ID로 먼저 맞추고,
 * 다음 대회의 같은 선수는 이름(favoriteNames)으로 맞춘다.
 */
export interface PushSubscriptionLike {
  token?: string;
  favoriteIds?: unknown;
  favoriteNames?: unknown;
  platform?: string;
}

export interface PushMatchLike {
  player1Id?: string;
  player2Id?: string;
  player1Name?: string;
  player2Name?: string;
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
  team1?: { memberIds?: unknown; memberNames?: unknown };
  team2?: { memberIds?: unknown; memberNames?: unknown };
}

/** RTDB 배열(객체로 올 수도 있음)을 문자열 목록으로 */
export function stringList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>) : [];
  return arr.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/** 경기 참가자 ID·이름 (단체전 팀원 포함) */
export function matchParticipants(match: PushMatchLike): string[] {
  const ids = [
    match.player1Id, match.player2Id, match.player1Name, match.player2Name,
    match.team1Id, match.team2Id, match.team1Name, match.team2Name,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  ids.push(...stringList(match.team1?.memberIds), ...stringList(match.team1?.memberNames));
  ids.push(...stringList(match.team2?.memberIds), ...stringList(match.team2?.memberNames));
  return ids;
}

/** 이 구독이 경기 참가자 중 누구를 즐겨찾기했는가 (없으면 null) */
export function favoriteInMatch(sub: PushSubscriptionLike, participants: readonly string[]): string | null {
  const set = new Set(participants);
  const byId = stringList(sub.favoriteIds).find((id) => set.has(id));
  if (byId) return byId;
  const byName = stringList(sub.favoriteNames).find((n) => set.has(n));
  return byName ?? null;
}

export function selectSubscriptions<S extends PushSubscriptionLike>(subs: readonly S[], participants: readonly string[]): S[] {
  if (participants.length === 0) return [];
  return subs.filter((s) => typeof s.token === "string" && s.token.length > 0 && favoriteInMatch(s, participants) !== null);
}

/** 즐겨찾기한 쪽 이름·상대 이름·1번 자리인지 */
export function favoriteSideInfo(match: PushMatchLike, favKey: string): { favName: string; oppName: string; isP1: boolean } {
  const t1 = [match.player1Id, match.player1Name, match.team1Id, match.team1Name, ...stringList(match.team1?.memberIds), ...stringList(match.team1?.memberNames)];
  const isP1 = t1.includes(favKey);
  const p1 = match.player1Name || match.team1Name || "";
  const p2 = match.player2Name || match.team2Name || "";
  return isP1 ? { favName: p1 || favKey, oppName: p2, isP1 } : { favName: p2 || favKey, oppName: p1, isP1 };
}
