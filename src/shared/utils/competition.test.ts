import { describe, it, expect } from 'vitest';
import type { Match, Tournament } from '../types';
import { computeFinalsSeeding, slotSourceInfo, walkoverSetsFor, isUndecidedSide, byeSetsFactory } from './competition';
import { finalRankingRows, calculateIndividualRanking } from './ranking';
import { getEffectiveScoringRules } from './scoring';

const tour = (extra: Partial<Tournament> = {}): Tournament => ({
  id: 't', name: 'T', date: '', type: 'individual', format: 'group_league', status: 'in_progress',
  gameConfig: { winScore: 11, setsToWin: 2 }, createdAt: 0, updatedAt: 0, ...extra,
});

let n = 0;
const match = (p: Partial<Match>): Match => ({
  id: `m${n++}`, tournamentId: 't', type: 'individual', status: 'completed', round: 1, createdAt: n, ...p,
});
const win = (a: string, b: string, winner: string, extra: Partial<Match> = {}): Match => match({
  player1Id: a, player2Id: b, player1Name: a.toUpperCase(), player2Name: b.toUpperCase(), winnerId: winner,
  sets: (winner === a ? [[11, 3], [11, 3]] : [[3, 11], [3, 11]]).map(([x, y]) => ({ player1Score: x, player2Score: y, player1Faults: 0, player2Faults: 0, player1Violations: 0, player2Violations: 0 })),
  ...extra,
});

describe('walkover sets from tournament rules', () => {
  it('uses stage rules and team target', () => {
    const t = tour({ stages: [{ id: 'f', name: 'F', order: 1, format: 'single_elimination', status: 'pending', scoringRules: { winScore: 11, setsToWin: 3, maxSets: 5, minLead: 2, deuceEnabled: true } }] });
    expect(walkoverSetsFor({ type: 'individual', stageId: 'f' }, t, 1, 'a')).toHaveLength(3);
    expect(walkoverSetsFor({ type: 'individual' }, t, 2, 'b').map(s => s.player2Score)).toEqual([11, 11]);
    expect(walkoverSetsFor({ type: 'team' }, tour({ type: 'team' }), 1, 'x').map(s => s.player1Score)).toEqual([31]);
    expect(byeSetsFactory(tour({ rules: { walkover: { byeCountsAsWalkover: false } } }), 'f', 'individual')(1, 'a')).toEqual([]);
  });
  it('score correction uses the match rules (B12: team 31 winner is not null)', () => {
    const cfg = getEffectiveScoringRules({ type: 'team' }, tour({ type: 'team' }));
    expect(cfg.POINTS_TO_WIN).toBe(31);
  });
});

describe('computeFinalsSeeding (client finals creation)', () => {
  const qual = (g: string) => [win(`${g}1`, `${g}2`, `${g}1`, { groupId: g }), win(`${g}1`, `${g}3`, `${g}1`, { groupId: g }), win(`${g}2`, `${g}3`, `${g}2`, { groupId: g })];
  it('never pairs same group or self in round 1 and gives BYEs to group winners', () => {
    const s = computeFinalsSeeding(tour(), [...qual('A'), ...qual('B'), ...qual('C')], undefined, 'f');
    expect(s.size).toBe(8);
    for (let k = 0; k < 4; k++) {
      const a = s.slots[2 * k];
      const b = s.slots[2 * k + 1];
      if (a && b) {
        expect(a.groupId).not.toBe(b.groupId);
        expect(a.id).not.toBe(b.id);
      } else {
        expect((a || b)!.groupRank).toBe(1);
      }
    }
  });
  it('blocks on unresolved ties and incomplete qualifying', () => {
    const circ = [win('a', 'b', 'a', { groupId: 'A' }), win('b', 'c', 'b', { groupId: 'A' }), win('c', 'a', 'c', { groupId: 'A' })];
    expect(computeFinalsSeeding(tour(), circ, undefined, 'f', { perGroup: 1 }).qualification.blockingTies).toHaveLength(1);
    const inc = [...qual('A'), match({ status: 'pending', groupId: 'A', player1Id: 'A1', player2Id: 'A9' })];
    expect(computeFinalsSeeding(tour(), inc, undefined, 'f').qualification.complete).toBe(false);
  });
});

describe('finalRankingRows (B4: champion is the final winner, not the most wins)', () => {
  it('orders by bracket result', () => {
    // a는 예선 3승, 결승 패. b는 예선 1승, 결승 승.
    const ms = [
      win('a', 'x', 'a', { groupId: 'A' }), win('a', 'y', 'a', { groupId: 'A' }), win('a', 'z', 'a', { groupId: 'A' }),
      win('b', 'x', 'b', { groupId: 'B' }),
      win('a', 'b', 'b', { stageId: 'f', roundLabel: '결승', bracketRound: '결승' }),
    ];
    expect(calculateIndividualRanking(ms)[0].playerId).toBe('a'); // 총 승수로는 a
    const rows = finalRankingRows(ms, tour());
    expect(rows.slice(0, 2).map(r => [r.id, r.place])).toEqual([['b', 1], ['a', 2]]);
    expect(rows.find(r => r.id === 'x')?.place).toBeNull();
  });
});

describe('slot placeholders', () => {
  it('describes the source match of an undecided slot', () => {
    const sf = match({ id: 'sf1', roundLabel: '4강', bracketPosition: 0, status: 'pending' });
    const f = match({ id: 'f', roundLabel: '결승', player1Id: '', player2Id: '', sourceMatch1: 'sf1', sourceMatch2: 'sf2', sourceType: 'winner', status: 'pending' });
    expect(isUndecidedSide(f, 1)).toBe(true);
    expect(slotSourceInfo(f, 1, new Map([['sf1', sf]]))).toEqual({ roundLabel: '4강', matchNumber: 1, outcome: 'winner' });
    expect(slotSourceInfo(f, 2, new Map([['sf1', sf]]))).toBeNull();
  });
});
