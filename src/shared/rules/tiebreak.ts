/**
 * 동률 처리 (M0c, 감사 B11). 비교자를 쓰지 않고 "집단 분할"로 구현해 비이행성(3자 순환)을 원천 제거한다.
 *
 * 절차 (resolve(집단, 기준 번호))
 * 1. 집단이 1명이면 끝.
 * 2. 기준을 순서대로 적용한다. 값이 큰 순으로 집단을 나눈다.
 *    - head_to_head는 "지금 동률인 집단끼리의 경기만"으로 승점을 다시 계산한다(미니 테이블).
 *    - 나머지 기준은 전체 기록(그 범위의 모든 경기) 값이다.
 * 3. 집단이 둘 이상으로 갈리면, 2명 이상 남은 작은 집단마다
 *    - recursive 모드: 기준을 처음부터 다시 적용한다(상대 전적은 작은 집단끼리 다시 계산).
 *    - single_pass 모드: 다음 기준부터 적용한다.
 * 4. 기준을 다 써도 남은 동률은
 *    - 관리자가 기록한 결정(tiebreakDecisions)이 있으면 그 순서를 쓴다.
 *    - 'lot' 기준이나 'lot' 정책이면 저장된 seed로 추첨한다(seed가 없으면 추첨하지 않는다).
 *    - 그래도 남으면 "미해결 동률"로 돌려준다. 이름순 같은 임의 순서로 조용히 정하지 않는다.
 *
 * 기본 순서와 근거는 competitionRules.ts DEFAULT_TIEBREAK_CRITERIA 참고(IBSA 원문 확인 대기).
 *
 * 순수 모듈. functions/src/shared/rules/tiebreak.ts는 이 파일의 사본이다.
 */
import type { CompetitionRules, TiebreakCriterion, TiebreakDecision } from './competitionRules';
import { hashString } from './rng';
import { aggregateStandings, type ResultRecord, type StandingRow } from './standings';

export type DecidedBy = TiebreakCriterion | 'admin_decision' | 'unresolved' | null;

export interface RankedRow<R extends StandingRow = StandingRow> {
  row: R;
  /** 1부터. 미해결 동률은 같은 순위를 공유한다. */
  rank: number;
  /** 미해결 동률인가 */
  tied: boolean;
  /** 이 선수의 순위를 바로 위/아래와 갈라 준 기준 (첫 기준 이전에 혼자면 null) */
  decidedBy: DecidedBy;
}

export interface UnresolvedTie {
  ids: string[];
  /** 이 동률 집단이 차지하는 첫 순위 */
  fromRank: number;
  toRank: number;
  scope: string;
}

export interface RankingResult<R extends StandingRow = StandingRow> {
  ranked: RankedRow<R>[];
  unresolved: UnresolvedTie[];
}

function ratio(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : Number.POSITIVE_INFINITY;
  return a / b;
}

function globalValue(row: StandingRow, c: TiebreakCriterion): number {
  switch (c) {
    case 'points': return row.points;
    case 'wins': return row.wins;
    case 'set_difference': return row.setsWon - row.setsLost;
    case 'point_difference': return row.pointsFor - row.pointsAgainst;
    case 'points_scored': return row.pointsFor;
    case 'set_ratio': return ratio(row.setsWon, row.setsLost);
    case 'point_ratio': return ratio(row.pointsFor, row.pointsAgainst);
    default: return 0;
  }
}

/** 값이 큰 순으로 분할 (같은 값끼리 한 집단, 입력 순서 유지) */
function partitionBy(ids: string[], value: (id: string) => number): string[][] {
  const groups = new Map<number, string[]>();
  for (const id of ids) {
    const v = value(id);
    const key = Number.isNaN(v) ? 0 : v;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(id);
  }
  return [...groups.entries()].sort(([a], [b]) => b - a).map(([, g]) => g);
}

function findDecision(ids: string[], decisions: Record<string, TiebreakDecision>, scope: string): TiebreakDecision | null {
  for (const d of Object.values(decisions)) {
    if (d.scope && scope && d.scope !== scope) continue;
    if (ids.every(id => d.ids.includes(id))) return d;
  }
  return null;
}

interface Bucket { ids: string[]; decidedBy: DecidedBy; tied: boolean }

/**
 * 순위를 매긴다.
 * @param rows 이 범위(조/리그)의 순위표 행
 * @param results 이 범위의 정규화된 결과 (상대 전적 계산용)
 * @param scope 동률 결정/추첨에 쓰는 범위 이름 (예: 조 ID)
 */
export function rankStandings<R extends StandingRow>(
  rows: ReadonlyArray<R>,
  results: ReadonlyArray<ResultRecord>,
  rules: CompetitionRules,
  scope = '',
): RankingResult<R> {
  const byId = new Map(rows.map(r => [r.id, r]));
  const { criteria, headToHeadMode, unresolved: policy, lotSeed } = rules.tiebreak;
  const decisions = rules.tiebreakDecisions || {};

  const lotOrder = (ids: string[]): string[] | null => {
    if (!lotSeed) return null;
    return [...ids].sort((a, b) => hashString(`${lotSeed}|${scope}|${a}`) - hashString(`${lotSeed}|${scope}|${b}`) || (a < b ? -1 : 1));
  };

  const resolve = (ids: string[], start: number, depth: number): Bucket[] => {
    if (ids.length <= 1) return [{ ids, decidedBy: null, tied: false }];
    if (depth > 64) return [{ ids, decidedBy: 'unresolved', tied: true }];
    for (let i = start; i < criteria.length; i++) {
      const c = criteria[i];
      let parts: string[][];
      if (c === 'lot') {
        const order = lotOrder(ids);
        if (!order) continue;
        parts = order.map(id => [id]);
      } else if (c === 'head_to_head') {
        const mini = aggregateStandings(results, rules, { onlyIds: new Set(ids) });
        parts = partitionBy(ids, id => mini.get(id)?.points ?? 0);
      } else {
        parts = partitionBy(ids, id => globalValue(byId.get(id)!, c));
      }
      if (parts.length <= 1) continue;
      const out: Bucket[] = [];
      for (const part of parts) {
        if (part.length === 1) out.push({ ids: part, decidedBy: c, tied: false });
        else {
          const nextStart = headToHeadMode === 'recursive' ? 0 : i + 1;
          out.push(...resolve(part, nextStart, depth + 1));
        }
      }
      return out;
    }
    // 기준 소진: 기록된 관리자 결정 → 추첨 정책 → 미해결
    const decision = findDecision(ids, decisions, scope);
    if (decision) {
      return [...ids].sort((a, b) => decision.ids.indexOf(a) - decision.ids.indexOf(b))
        .map(id => ({ ids: [id], decidedBy: 'admin_decision' as const, tied: false }));
    }
    if (policy === 'lot' && !criteria.includes('lot')) {
      const order = lotOrder(ids);
      if (order) return order.map(id => ({ ids: [id], decidedBy: 'lot' as const, tied: false }));
    }
    return [{ ids, decidedBy: 'unresolved', tied: true }];
  };

  const all = rows.map(r => r.id);
  const buckets = resolve(all, 0, 0);
  const ranked: RankedRow<R>[] = [];
  const unresolvedTies: UnresolvedTie[] = [];
  let pos = 1;
  for (const b of buckets) {
    for (const id of b.ids) ranked.push({ row: byId.get(id)!, rank: pos, tied: b.tied, decidedBy: b.decidedBy });
    if (b.tied) unresolvedTies.push({ ids: [...b.ids], fromRank: pos, toRank: pos + b.ids.length - 1, scope });
    pos += b.ids.length;
  }
  return { ranked, unresolved: unresolvedTies };
}

/**
 * 상위 cutoff명을 뽑을 때 경계에 걸친 미해결 동률 (진출자 결정 불가).
 * 예: cutoff 2, 2~3위 미해결 동률 → 그 동률을 돌려준다.
 */
export function tieAtCutoff(result: RankingResult, cutoff: number): UnresolvedTie | null {
  for (const t of result.unresolved) {
    if (t.fromRank <= cutoff && t.toRank > cutoff) return t;
  }
  return null;
}
