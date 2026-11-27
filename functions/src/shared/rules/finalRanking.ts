// 자동 생성 사본: 원본은 src/shared/rules/. 직접 고치지 말고 node scripts/sync-shared-rules.mjs를 실행하세요.
/**
 * 최종 순위 (M0c, 감사 B4). 총 승수가 아니라 대진 결과로 정한다.
 *
 * 순서
 * 1. 결승 승자 1위, 패자 2위.
 * 2. 3·4위: thirdPlace='match'이고 3/4위전이 있으면 그 결과, 아니면 4강 패자 공동 3위.
 *    (3/4위전이 있는데 아직 안 끝났으면 미정으로 둔다.)
 * 3. "X/Y위 결정전"(5/6위전 등) 결과: placementMatches가 켜져 있으면 승자 X위, 패자 Y위.
 * 4. "N~M위 순위 결정전" 리그: 그 경기들의 순위표 + 동률 규칙으로 N위부터.
 * 5. 순위결정전으로 정해지지 않은 R강 패자: 5~8위는 fifthToEighth, 9위 이하는 lowerPlaces 정책
 *    (joint = 공동 R/2+1위, qualifying_record = 예선 성적순으로 R/2+1위부터).
 *    그 범위에 순위결정전이 있으면 정책 대신 결정전 결과를 기다린다(미정).
 * 6. 대진이 없는 대회(풀리그 등)는 전체 순위표 + 동률 규칙.
 * 정해지지 않은 순위는 결과에 넣지 않는다(미정). 순위는 저장하지 않고 항상 계산한다.
 *
 * 순수 모듈. functions/src/shared/rules/finalRanking.ts는 이 파일의 사본이다.
 */
import { isObject, toList, type CompetitionRules, type TournamentLike } from './competitionRules';
import { rankMatches } from './qualification';
import { normalizeResult, resultContextFor, sideOf, type MatchLike, type ResultContext } from './standings';
import { isRealParticipantId } from './walkover';

export type PlacementBasis =
  | 'final'
  | 'third_place_match'
  | 'semifinal'
  | 'placement_match'
  | 'placement_league'
  | 'round'
  | 'qualifying_record'
  | 'standings';

export interface Placement {
  id: string;
  name: string;
  place: number;
  /** 공동 순위 (같은 place를 다른 사람과 공유) */
  joint: boolean;
  basis: PlacementBasis;
  /** 동률 규칙으로 풀리지 않아 관리자 결정이 필요한 공동 순위 */
  unresolved?: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 본선 라운드 참가 인원 ("결승" = 2, "8강" = 8). 본선 라운드가 아니면 0. */
export function knockoutParticipants(label: unknown): number {
  const s = str(label).trim();
  if (s === '결승' || /^final$/i.test(s)) return 2;
  const m = /^(\d+)강$/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** "X/Y위 결정전" → [X, Y] */
export function pairPlacementRange(label: unknown): [number, number] | null {
  const m = /^(\d+)\s*\/\s*(\d+)\s*위/.exec(str(label).trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return b === a + 1 ? [a, b] : null;
}

/** "N~M위 순위 결정전" 리그 → [N, M] */
export function leaguePlacementRange(label: unknown): [number, number] | null {
  const m = /^(\d+)\s*~\s*(\d+)\s*위\s*순위\s*결정전/.exec(str(label).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function labelOf(m: MatchLike): string {
  return str(m.roundLabel) || str(m.bracketRound);
}

function isMainBracket(m: MatchLike): boolean {
  if (str(m.groupId)) return false;
  const sid = str(m.stageId);
  if (/_3rd$|_class_|5to8|9to16/.test(sid)) return false;
  return knockoutParticipants(m.bracketRound) > 0 || knockoutParticipants(m.roundLabel) > 0;
}

function roundSize(m: MatchLike): number {
  return knockoutParticipants(m.bracketRound) || knockoutParticipants(m.roundLabel);
}

function isThirdPlaceMatch(m: MatchLike): boolean {
  const range = pairPlacementRange(labelOf(m));
  return (range !== null && range[0] === 3) || /_3rd$/.test(str(m.stageId));
}

interface Decided { winner: { id: string; name: string } | null; loser: { id: string; name: string } | null }

function decided(m: MatchLike, ctx: ResultContext): Decided | null {
  if (m.status !== 'completed') return null;
  // 결과 판정은 집계 여부와 무관해야 한다(부전승을 통계에서 빼도 진출·순위는 정해진다)
  const r = normalizeResult(m, { ...ctx, rules: { ...ctx.rules, walkover: { ...ctx.rules.walkover, countInStandings: true, countInPlayerStats: true, byeCountsAsWalkover: true } } });
  if (!r || !r.winner) return null;
  const s1 = sideOf(m, 1);
  const s2 = sideOf(m, 2);
  const w = r.winner === s1.id ? s1 : s2;
  const l = r.winner === s1.id ? s2 : s1;
  return { winner: w, loser: isRealParticipantId(l.id) ? l : null };
}

export interface FinalRankingInput {
  matches: ReadonlyArray<MatchLike>;
  ctx: ResultContext;
  rules?: CompetitionRules;
  /** 예선 성적 순서(1위가 첫 원소). qualifying_record 정책에 쓴다. 없으면 예선 경기(groupId 있음)로 계산한다. */
  qualifyingOrder?: readonly string[];
}

export function computeFinalPlacements(input: FinalRankingInput): Placement[] {
  const { matches, ctx } = input;
  const rules = input.rules ?? ctx.rules;
  const fr = rules.finalRanking;
  const placed = new Map<string, Placement>();
  const put = (p: Placement) => { if (!placed.has(p.id)) placed.set(p.id, p); };

  const main = matches.filter(isMainBracket);
  if (main.length === 0) {
    // 대진 없는 대회: 전체 순위표
    const ranking = rankMatches(matches, ctx, 'final');
    const counts = new Map<number, number>();
    for (const r of ranking.ranked) counts.set(r.rank, (counts.get(r.rank) || 0) + 1);
    const out = ranking.ranked
      .filter(r => r.row.played > 0)
      .map(r => ({ id: r.row.id, name: r.row.name, place: r.rank, joint: (counts.get(r.rank) || 0) > 1, basis: 'standings' as const, ...(r.tied ? { unresolved: true } : {}) }));
    return cap(out, fr.rankingUpTo);
  }

  // 1. 결승
  const finalMatch = main.find(m => roundSize(m) === 2);
  if (finalMatch) {
    const d = decided(finalMatch, ctx);
    if (d?.winner) put({ id: d.winner.id, name: d.winner.name, place: 1, joint: false, basis: 'final' });
    if (d?.loser) put({ id: d.loser.id, name: d.loser.name, place: 2, joint: false, basis: 'final' });
  }

  // 2~4. 순위결정전
  const thirdMatches = matches.filter(m => !isMainBracket(m) && isThirdPlaceMatch(m));
  const useThirdMatch = fr.thirdPlace === 'match' && thirdMatches.length > 0;
  if (useThirdMatch) {
    for (const m of thirdMatches) {
      const d = decided(m, ctx);
      if (d?.winner) put({ id: d.winner.id, name: d.winner.name, place: 3, joint: false, basis: 'third_place_match' });
      if (d?.loser) put({ id: d.loser.id, name: d.loser.name, place: 4, joint: false, basis: 'third_place_match' });
    }
  }
  /** 순위결정전이 다루는 순위 범위 (해당 범위는 정책 대신 결정전 결과를 쓴다) */
  const coveredRanges: Array<[number, number]> = [];
  if (fr.placementMatches) {
    for (const m of matches) {
      if (isMainBracket(m) || isThirdPlaceMatch(m)) continue;
      const range = pairPlacementRange(labelOf(m));
      if (!range) continue;
      coveredRanges.push(range);
      const d = decided(m, ctx);
      if (d?.winner) put({ id: d.winner.id, name: d.winner.name, place: range[0], joint: false, basis: 'placement_match' });
      if (d?.loser) put({ id: d.loser.id, name: d.loser.name, place: range[1], joint: false, basis: 'placement_match' });
    }
    // "5-8위 결정전"처럼 범위로 묶인 결정전 대진(교차전)도 그 범위를 덮는다.
    // 그 범위 안에 X/Y위 결정전이 없으면(간단 방식: 교차전 2경기만) 승자는 공동 X위, 패자는 공동 X+승자 수 위.
    const rangeMatches = new Map<string, { range: [number, number]; matches: MatchLike[] }>();
    for (const m of matches) {
      const mm = /^(\d+)\s*[-~]\s*(\d+)\s*위\s*결정전/.exec(labelOf(m));
      if (!mm) continue;
      const range: [number, number] = [Number(mm[1]), Number(mm[2])];
      coveredRanges.push(range);
      const key = `${range[0]}-${range[1]}`;
      if (!rangeMatches.has(key)) rangeMatches.set(key, { range, matches: [] });
      rangeMatches.get(key)!.matches.push(m);
    }
    for (const { range, matches: rm } of rangeMatches.values()) {
      const hasPairInside = matches.some(m => {
        const pr = pairPlacementRange(labelOf(m));
        return !!pr && pr[0] >= range[0] && pr[1] <= range[1];
      });
      if (hasPairInside) continue;
      const results = rm.map(m => decided(m, ctx));
      if (results.some(d => !d)) continue; // 교차전이 다 끝나야 정한다
      const winners = results.map(d => d!.winner).filter((x): x is { id: string; name: string } => !!x);
      const losers = results.map(d => d!.loser).filter((x): x is { id: string; name: string } => !!x);
      for (const w of winners) put({ id: w.id, name: w.name, place: range[0], joint: winners.length > 1, basis: 'placement_match' });
      for (const l of losers) put({ id: l.id, name: l.name, place: range[0] + winners.length, joint: losers.length > 1, basis: 'placement_match' });
    }
    const leagues = new Map<string, { range: [number, number]; matches: MatchLike[] }>();
    for (const m of matches) {
      const range = leaguePlacementRange(labelOf(m));
      if (!range) continue;
      const key = `${range[0]}-${range[1]}`;
      if (!leagues.has(key)) leagues.set(key, { range, matches: [] });
      leagues.get(key)!.matches.push(m);
    }
    for (const { range, matches: lm } of leagues.values()) {
      coveredRanges.push(range);
      const ranking = rankMatches(lm, ctx, `placement_${range[0]}`);
      if (!ranking.ranked.some(r => r.row.played > 0)) continue;
      const counts = new Map<number, number>();
      for (const r of ranking.ranked) counts.set(r.rank, (counts.get(r.rank) || 0) + 1);
      for (const r of ranking.ranked) {
        put({ id: r.row.id, name: r.row.name, place: range[0] + r.rank - 1, joint: (counts.get(r.rank) || 0) > 1, basis: 'placement_league', ...(r.tied ? { unresolved: true } : {}) });
      }
    }
  }
  const isCovered = (from: number, to: number) => coveredRanges.some(([a, b]) => a <= to && b >= from);

  // 5. 본선 라운드 패자
  const qualifyingOrder = input.qualifyingOrder ?? qualifyingOrderFrom(matches, ctx);
  const sizes = [...new Set(main.map(roundSize))].filter(n => n >= 4).sort((a, b) => a - b);
  for (const size of sizes) {
    const losers: Array<{ id: string; name: string }> = [];
    for (const m of main.filter(x => roundSize(x) === size)) {
      const d = decided(m, ctx);
      if (d?.loser && !placed.has(d.loser.id)) losers.push(d.loser);
    }
    if (losers.length === 0) continue;
    const from = size / 2 + 1;
    const to = size;
    if (size === 4) {
      // 4강 패자: 3/4위전을 쓰면 그 결과를 기다리고, 아니면 공동 3위
      if (useThirdMatch) continue;
      for (const l of losers) put({ id: l.id, name: l.name, place: 3, joint: losers.length > 1, basis: 'semifinal' });
      continue;
    }
    if (isCovered(from, to)) continue;
    const policy = size === 8 ? fr.fifthToEighth : fr.lowerPlaces;
    if (policy === 'qualifying_record') {
      const idx = (id: string) => { const i = qualifyingOrder.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
      const sorted = [...losers].sort((a, b) => idx(a.id) - idx(b.id));
      sorted.forEach((l, i) => put({ id: l.id, name: l.name, place: from + i, joint: false, basis: 'qualifying_record' }));
    } else {
      for (const l of losers) put({ id: l.id, name: l.name, place: from, joint: losers.length > 1, basis: 'round' });
    }
  }

  const out = [...placed.values()].sort((a, b) => a.place - b.place);
  return cap(out, fr.rankingUpTo);
}

function cap(list: Placement[], upTo: number): Placement[] {
  return upTo > 0 ? list.filter(p => p.place <= upTo) : list;
}

/** 예선(조별) 성적 순서: 조 순위가 같은 선수끼리는 전체 기록(승점 → 세트 득실 → 점수 득실 → 득점) */
export function qualifyingOrderFrom(matches: ReadonlyArray<MatchLike>, ctx: ResultContext): string[] {
  const qual = matches.filter(m => !!str(m.groupId));
  if (qual.length === 0) return [];
  const byGroup = new Map<string, MatchLike[]>();
  for (const m of qual) {
    const g = str(m.groupId);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(m);
  }
  const entries: Array<{ id: string; groupRank: number; points: number; sd: number; pd: number; pf: number }> = [];
  for (const [g, ms] of byGroup) {
    for (const r of rankMatches(ms, ctx, g).ranked) {
      entries.push({ id: r.row.id, groupRank: r.rank, points: r.row.points, sd: r.row.setsWon - r.row.setsLost, pd: r.row.pointsFor - r.row.pointsAgainst, pf: r.row.pointsFor });
    }
  }
  entries.sort((a, b) => a.groupRank - b.groupRank || b.points - a.points || b.sd - a.sd || b.pd - a.pd || b.pf - a.pf);
  return entries.map(e => e.id);
}

/**
 * 대회 노드로 최종 순위를 계산한다 (관리자·관전·챗봇·시뮬레이션 공통).
 * - 최종 순위 정책·순위결정전 판정: 대회 규칙
 * - 예선 성적순(qualifying_record)·대진 없는 리그 순위: 예선 스테이지 규칙(동률 기준·승점·부전승 집계)
 */
export function finalPlacementsFor(matches: ReadonlyArray<MatchLike>, tournament: TournamentLike | null | undefined): Placement[] {
  const qual = toList<unknown>(tournament?.stages).filter(isObject).find(s => s.type === 'qualifying');
  const qualCtx = resultContextFor(tournament, 'standings', typeof qual?.id === 'string' ? qual.id : undefined);
  const ctx = resultContextFor(tournament);
  const hasBracket = matches.some(isMainBracket);
  return computeFinalPlacements({ matches, ctx: hasBracket ? ctx : qualCtx, qualifyingOrder: qualifyingOrderFrom(matches, qualCtx) });
}
