// 자동 생성 사본: 원본은 src/shared/rules/. 직접 고치지 말고 node scripts/sync-shared-rules.mjs를 실행하세요.
/**
 * 범위(조/리그)별 순위와 본선 진출자 선정 (M0c).
 * 클라이언트(FinalsSection, StatusTab, 관전 순위표)와 서버(generate_finals, 시뮬레이션)가 같은 함수를 쓴다.
 *
 * 순수 모듈. functions/src/shared/rules/qualification.ts는 이 파일의 사본이다.
 */
import type { CompetitionRules } from './competitionRules';
import { aggregateStandings, normalizeResults, participantsOf, type MatchLike, type ResultContext } from './standings';
import { rankStandings, tieAtCutoff, type RankingResult, type UnresolvedTie } from './tiebreak';
import { isRealParticipantId } from './walkover';

/** 경기 목록 하나(한 범위)의 순위. pending 경기 참가자도 0전 행으로 넣는다. */
export function rankMatches(matches: ReadonlyArray<MatchLike>, ctx: ResultContext, scope = ''): RankingResult {
  const results = normalizeResults(matches, ctx);
  const rows = aggregateStandings(results, ctx.rules, { participants: participantsOf(matches) });
  return rankStandings([...rows.values()], results, ctx.rules, scope);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 예선 경기를 조별로 나눈다 (groupId 없으면 '' 한 범위). 조 ID 순으로 정렬. */
export function splitByGroup<M extends MatchLike>(matches: ReadonlyArray<M>): Array<{ groupId: string; matches: M[] }> {
  const map = new Map<string, M[]>();
  for (const m of matches) {
    const gid = str(m.groupId);
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid)!.push(m);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([groupId, ms]) => ({ groupId, matches: ms }));
}

export interface Qualifier {
  id: string;
  name: string;
  groupId: string;
  /** 조 내 순위 (와일드카드는 실제 조 순위) */
  groupRank: number;
  /** 시드 계층: 1 = 조 1위, 2 = 조 2위 ... 와일드카드는 perGroup + 1 */
  tier: number;
  wildcard: boolean;
}

export interface QualificationResult {
  qualifiers: Qualifier[];
  eliminated: Qualifier[];
  groups: Array<{ groupId: string; ranking: RankingResult }>;
  /** 진출 경계에 걸친 미해결 동률 (있으면 진출자를 확정할 수 없다) */
  blockingTies: UnresolvedTie[];
  /** 모든 예선 경기가 완료됐는가 (BYE-vs-BYE 같은 빈 경기는 제외) */
  complete: boolean;
  incompleteCount: number;
}

/** 실제 참가자가 있는 경기인가 (일정·완료 판단용) */
function hasRealSide(m: MatchLike): boolean {
  return isRealParticipantId(m.player1Id) || isRealParticipantId(m.player2Id) || isRealParticipantId(m.team1Id) || isRealParticipantId(m.team2Id);
}

/**
 * 조별 순위로 진출자를 고른다.
 * - 조당 perGroup명 + (명시적으로 설정한) 와일드카드 수만큼 차순위 중 성적 상위.
 * - 경계에 미해결 동률이 있으면 blockingTies에 담는다(관리자 결정 후 다시 계산하면 풀린다).
 */
export function selectQualifiers(
  qualifyingMatches: ReadonlyArray<MatchLike>,
  ctx: ResultContext,
  opts: { perGroup?: number; wildcards?: number; rules?: CompetitionRules } = {},
): QualificationResult {
  const rules = opts.rules ?? ctx.rules;
  const perGroup = opts.perGroup ?? rules.qualification.perGroup;
  const wildcards = opts.wildcards ?? rules.qualification.wildcards;
  const groups = splitByGroup(qualifyingMatches).map(g => ({ groupId: g.groupId, ranking: rankMatches(g.matches, ctx, g.groupId) }));
  const blockingTies: UnresolvedTie[] = [];
  const qualifiers: Qualifier[] = [];
  const eliminated: Qualifier[] = [];
  const candidates: Qualifier[] = [];

  for (const g of groups) {
    const tie = tieAtCutoff(g.ranking, perGroup);
    if (tie) blockingTies.push(tie);
    g.ranking.ranked.forEach((r, idx) => {
      const q: Qualifier = { id: r.row.id, name: r.row.name, groupId: g.groupId, groupRank: idx + 1, tier: Math.min(idx + 1, perGroup + 1), wildcard: false };
      if (idx < perGroup) qualifiers.push(q);
      else if (wildcards > 0 && idx === perGroup) candidates.push(q);
      else eliminated.push(q);
    });
  }

  if (wildcards > 0 && candidates.length > 0) {
    // 차순위끼리 전체 기록으로 비교 (상대 전적은 서로 다른 조라 보통 없음)
    const rowsById = new Map(groups.flatMap(g => g.ranking.ranked.map(r => [r.row.id, r.row] as const)));
    const results = normalizeResults(qualifyingMatches, ctx);
    const wc = rankStandings(candidates.map(c => rowsById.get(c.id)!), results, rules, 'wildcard');
    const take = Math.min(wildcards, candidates.length);
    const tie = tieAtCutoff(wc, take);
    if (tie) blockingTies.push(tie);
    wc.ranked.forEach((r, idx) => {
      const c = candidates.find(x => x.id === r.row.id)!;
      if (idx < take) qualifiers.push({ ...c, wildcard: true, tier: perGroup + 1 });
      else eliminated.push(c);
    });
  } else {
    eliminated.push(...candidates);
  }

  const playable = qualifyingMatches.filter(hasRealSide);
  const incompleteCount = playable.filter(m => m.status !== 'completed').length;
  return { qualifiers, eliminated, groups, blockingTies, complete: incompleteCount === 0, incompleteCount };
}
