import { describe, it, expect } from 'vitest';
import { resolveCompetitionRules, tiebreakDecisionKey } from './competitionRules';
import { resultContextFor, type MatchLike } from './standings';
import { rankMatches, selectQualifiers } from './qualification';
import { tieAtCutoff } from './tiebreak';
import { standardSeedPositions, placeSeeds, crossGroupSeedOrder, earliestMeetingRound, findDuplicateSlot, nextPowerOfTwo } from './seeding';
import { seededShuffle } from './rng';

const m = (a: string, b: string, winner: string, sets: Array<[number, number]>, groupId = 'A'): MatchLike => ({
  status: 'completed', type: 'individual', groupId, player1Id: a, player2Id: b, player1Name: a, player2Name: b, winnerId: winner,
  sets: sets.map(([p1, p2]) => ({ player1Score: p1, player2Score: p2 })),
});
const W = (a: string, b: string, groupId?: string) => m(a, b, a, [[11, 5], [11, 5]], groupId);
const order = (r: ReturnType<typeof rankMatches>) => r.ranked.map(x => x.row.id);

describe('tiebreaks', () => {
  it('2-way tie → head-to-head', () => {
    // a, b 2승 1패. a가 b를 이김. 세트 득실은 b가 더 좋음.
    const ms = [W('a', 'b'), m('c', 'a', 'c', [[11, 9], [11, 9]]), W('a', 'd'), W('b', 'c'), W('b', 'd'), W('d', 'c')];
    const r = rankMatches(ms, resultContextFor({}));
    expect(order(r).slice(0, 2)).toEqual(['a', 'b']);
    expect(r.ranked[0].decidedBy).toBe('head_to_head');
  });

  // a>b, b>c, c>a (순환), 모두 d를 이김 → a,b,c 3승1패... 실제로는 2승1패
  const circular = (scores: Record<string, Array<[number, number]>>) => [
    m('a', 'b', 'a', scores.ab), m('b', 'c', 'b', scores.bc), m('c', 'a', 'c', scores.ca),
    W('a', 'd'), W('b', 'd'), W('c', 'd'),
  ];
  it('3-way circular head-to-head falls through to set difference, then point difference', () => {
    const ms = circular({ ab: [[11, 5], [11, 5]], bc: [[11, 5], [5, 11], [11, 5]], ca: [[11, 5], [5, 11], [11, 5]] });
    const r = rankMatches(ms, resultContextFor({}));
    // 세트 득실: a = 2+(-1)+2 = +3, b = -2+1+2 = +1, c = -1+1+2 = +2 → a, c, b
    expect(order(r)).toEqual(['a', 'c', 'b', 'd']);
    expect(r.unresolved).toEqual([]);
  });
  it('recursive: after a subset splits off, head-to-head is recomputed among the remaining pair', () => {
    // a·b·c 모두 2승(순환: a>b, b>c, c>a) → 상대 전적으로 안 갈림 → 세트 득실 a +3, b +1, c +1로 a가 먼저 빠진다.
    // recursive: b·c끼리 상대 전적 다시 계산 → b가 c를 이겼으므로 b, c.
    // single_pass: 다음 기준(점수 득실) → c +16, b +12 이므로 c, b.
    const ms = [
      m('a', 'b', 'a', [[11, 5], [11, 5]]),
      m('b', 'c', 'b', [[11, 9], [9, 11], [11, 9]]),
      m('c', 'a', 'c', [[11, 9], [9, 11], [11, 9]]),
      m('a', 'd', 'a', [[11, 5], [11, 5]]),
      m('b', 'd', 'b', [[11, 0], [11, 0]]),
      m('c', 'd', 'c', [[11, 0], [5, 11], [11, 0]]),
    ];
    const criteria = ['points', 'head_to_head', 'set_difference', 'point_difference'];
    const rec = rankMatches(ms, resultContextFor({ rules: { tiebreak: { criteria, headToHeadMode: 'recursive' } } }));
    expect(order(rec)).toEqual(['a', 'b', 'c', 'd']);
    expect(rec.ranked[1].decidedBy).toBe('head_to_head');
    const flat = rankMatches(ms, resultContextFor({ rules: { tiebreak: { criteria, headToHeadMode: 'single_pass' } } }));
    expect(order(flat)).toEqual(['a', 'c', 'b', 'd']);
    expect(flat.ranked[1].decidedBy).toBe('point_difference');
  });
  it('perfect tie is reported as unresolved (no silent name order)', () => {
    const ms = [m('z', 'y', 'z', [[11, 5], [11, 5]]), m('y', 'z', 'y', [[11, 5], [11, 5]])];
    const r = rankMatches(ms, resultContextFor({}), 'A');
    expect(r.unresolved).toEqual([{ ids: ['z', 'y'], fromRank: 1, toRank: 2, scope: 'A' }]);
    expect(r.ranked.every(x => x.tied && x.rank === 1)).toBe(true);
    expect(tieAtCutoff(r, 1)).not.toBeNull();
    expect(tieAtCutoff(r, 2)).toBeNull();
  });
  it('recorded admin decision is honored', () => {
    const ms = [m('z', 'y', 'z', [[11, 5], [11, 5]]), m('y', 'z', 'y', [[11, 5], [11, 5]])];
    const key = tiebreakDecisionKey('A', ['y', 'z']);
    const r = rankMatches(ms, resultContextFor({ rules: { tiebreakDecisions: { [key]: { ids: ['y', 'z'], scope: 'A' } } } }), 'A');
    expect(order(r)).toEqual(['y', 'z']);
    expect(r.ranked[0].decidedBy).toBe('admin_decision');
    expect(r.unresolved).toEqual([]);
    // 다른 범위의 결정은 쓰지 않는다
    const other = rankMatches(ms, resultContextFor({ rules: { tiebreakDecisions: { [key]: { ids: ['y', 'z'], scope: 'B' } } } }), 'A');
    expect(other.unresolved).toHaveLength(1);
  });
  it('lot policy with stored seed is reproducible; without seed stays unresolved', () => {
    const ms = [m('z', 'y', 'z', [[11, 5], [11, 5]]), m('y', 'z', 'y', [[11, 5], [11, 5]])];
    const t = { rules: { tiebreak: { unresolved: 'lot', lotSeed: 'seed-1' } } };
    const r1 = rankMatches(ms, resultContextFor(t), 'A');
    const r2 = rankMatches(ms, resultContextFor(t), 'A');
    expect(order(r1)).toEqual(order(r2));
    expect(r1.ranked[0].decidedBy).toBe('lot');
    expect(rankMatches(ms, resultContextFor({ rules: { tiebreak: { unresolved: 'lot' } } })).unresolved).toHaveLength(1);
  });
  it('custom criteria order changes the result', () => {
    // a: 세트 득실 우세, b: 득점 우세
    const ms = [
      m('a', 'c', 'a', [[11, 0], [11, 0]]), m('b', 'c', 'b', [[11, 9], [9, 11], [15, 13]]),
      m('a', 'd', 'd', [[5, 11], [5, 11]]), m('b', 'd', 'd', [[13, 15], [14, 16]]), W('d', 'c'),
    ];
    const def = rankMatches(ms, resultContextFor({}));
    expect(order(def).indexOf('a')).toBeLessThan(order(def).indexOf('b'));
    const custom = rankMatches(ms, resultContextFor({ rules: { tiebreak: { criteria: ['points', 'points_scored'] } } }));
    expect(order(custom).indexOf('b')).toBeLessThan(order(custom).indexOf('a'));
  });
  it('includes zero-match participants', () => {
    const ms: MatchLike[] = [{ status: 'pending', player1Id: 'p', player2Id: 'q', player1Name: 'P', player2Name: 'Q' }];
    expect(rankMatches(ms, resultContextFor({})).ranked).toHaveLength(2);
  });
});

describe('selectQualifiers', () => {
  it('blocks on an unresolved tie at the cutoff and resolves after a decision', () => {
    const ms = [m('a', 'b', 'a', [[11, 5], [11, 5]]), m('b', 'c', 'b', [[11, 5], [11, 5]]), m('c', 'a', 'c', [[11, 5], [11, 5]])];
    const q = selectQualifiers(ms, resultContextFor({}), { perGroup: 1 });
    expect(q.blockingTies).toHaveLength(1);
    const key = tiebreakDecisionKey('A', ['a', 'b', 'c']);
    const q2 = selectQualifiers(ms, resultContextFor({ rules: { tiebreakDecisions: { [key]: { ids: ['c', 'a', 'b'], scope: 'A' } } } }), { perGroup: 1 });
    expect(q2.blockingTies).toEqual([]);
    expect(q2.qualifiers.map(x => x.id)).toEqual(['c']);
  });
  it('reports incomplete qualifying', () => {
    const ms: MatchLike[] = [W('a', 'b'), { status: 'pending', groupId: 'A', player1Id: 'a', player2Id: 'c' }];
    const q = selectQualifiers(ms, resultContextFor({}), { perGroup: 1 });
    expect(q.complete).toBe(false);
    expect(q.incompleteCount).toBe(1);
  });
  it('wildcards only when configured', () => {
    const ms = [W('a1', 'a2', 'A'), W('a2', 'a3', 'A'), W('a1', 'a3', 'A'), W('b1', 'b2', 'B'), W('b2', 'b3', 'B'), m('b1', 'b3', 'b1', [[11, 9], [11, 9]], 'B')];
    expect(selectQualifiers(ms, resultContextFor({}), { perGroup: 1 }).qualifiers).toHaveLength(2);
    const q = selectQualifiers(ms, resultContextFor({}), { perGroup: 1, wildcards: 1 });
    expect(q.qualifiers.map(x => x.id)).toEqual(['a1', 'b1', 'a2']);
    expect(q.qualifiers[2].wildcard).toBe(true);
    expect(resolveCompetitionRules({}).qualification.wildcards).toBe(0);
  });
});

describe('seeding', () => {
  it('standard positions for 8', () => {
    expect(standardSeedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  for (let n = 2; n <= 64; n++) {
    it(`size ${n}: seeds 1 and 2 meet only in the final, BYEs go to top seeds, no duplicates`, () => {
      const ids = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}` }));
      const size = nextPowerOfTwo(n);
      const slots = placeSeeds(ids, size);
      expect(slots).toHaveLength(size);
      expect(findDuplicateSlot(slots)).toBeNull();
      expect(slots.filter(Boolean)).toHaveLength(n);
      const pos = (id: string) => slots.findIndex(s => s?.id === id);
      expect(earliestMeetingRound(pos('p1'), pos('p2'))).toBe(Math.log2(size));
      if (n >= 4) expect(earliestMeetingRound(pos('p1'), pos('p4'))).toBeGreaterThanOrEqual(Math.log2(size) - 1);
      const byes = size - n;
      for (let k = 0; k < size / 2; k++) {
        const a = slots[2 * k];
        const b = slots[2 * k + 1];
        expect(a || b).toBeTruthy(); // BYE끼리 만나지 않는다
        if (a && b) expect(a.id).not.toBe(b.id);
        if (!a || !b) expect(Number((a || b)!.id.slice(1))).toBeLessThanOrEqual(byes);
      }
    });
  }
  it('cross-group: 2 groups → A1-B2, B1-A2 and same group only in the final', () => {
    const q = ['A', 'B'].flatMap(g => [1, 2].map(tier => ({ id: `${g}${tier}`, groupId: g, tier })));
    const slots = placeSeeds(crossGroupSeedOrder(q, { avoidSameGroup: true }));
    const pairs = [[slots[0]?.id, slots[1]?.id], [slots[2]?.id, slots[3]?.id]];
    expect(pairs).toEqual([['A1', 'B2'], ['B1', 'A2']]);
  });
  it.each([2, 3, 4, 6, 8, 16])('cross-group with %i groups never pairs the same group in round 1', groups => {
    const letters = Array.from({ length: groups }, (_, i) => String.fromCharCode(65 + i));
    const q = letters.flatMap(g => [1, 2].map(tier => ({ id: `${g}${tier}`, groupId: g, tier })));
    const slots = placeSeeds(crossGroupSeedOrder(q, { avoidSameGroup: true }));
    for (let k = 0; k < slots.length / 2; k++) {
      const a = slots[2 * k];
      const b = slots[2 * k + 1];
      if (a && b) expect(a.groupId).not.toBe(b.groupId);
    }
    // 조 1위끼리(1·2번 시드)는 결승에서만
    const pos = (id: string) => slots.findIndex(s => s?.id === id);
    expect(earliestMeetingRound(pos('A1'), pos('B1'))).toBe(Math.log2(slots.length));
    expect(findDuplicateSlot(slots)).toBeNull();
  });
  it('drops duplicate ids', () => {
    expect(crossGroupSeedOrder([{ id: 'a', groupId: 'A', tier: 1 }, { id: 'a', groupId: 'A', tier: 2 }], { avoidSameGroup: true })).toHaveLength(1);
  });
  it('seeded shuffle is reproducible', () => {
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 's')).toEqual(seededShuffle([1, 2, 3, 4, 5, 6], 's'));
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 's').sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
