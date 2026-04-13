import { describe, it, expect } from 'vitest';
import {
  mapToLegacyFormat,
  buildGroupAssignment,
  generateRoundRobinPairings,
  generateSingleEliminationBracket,
  calculateWildcard,
  calculateMatchCount,
} from './tournament';

describe('mapToLegacyFormat', () => {
  it('group + finals → group_league', () => {
    expect(mapToLegacyFormat(true, true)).toBe('group_league');
  });
  it('finals only → tournament', () => {
    expect(mapToLegacyFormat(false, true)).toBe('tournament');
  });
  it('no finals → full_league', () => {
    expect(mapToLegacyFormat(true, false)).toBe('full_league');
    expect(mapToLegacyFormat(false, false)).toBe('full_league');
  });
});

describe('buildGroupAssignment', () => {
  it('distributes players evenly across groups via snake draft', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const groups = buildGroupAssignment(ids, 2);
    expect(groups).toHaveLength(2);
    expect(groups[0].playerIds).toHaveLength(3);
    expect(groups[1].playerIds).toHaveLength(3);
    // Snake: round0 → A,B; round1 → B,A; round2 → A,B
    expect(groups[0].playerIds).toEqual(['a', 'd', 'e']);
    expect(groups[1].playerIds).toEqual(['b', 'c', 'f']);
  });

  it('places seeds first into corresponding groups', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const groups = buildGroupAssignment(ids, 2, ['c', 'd']);
    // Seeds: c→A, d→B. Remaining a,b distributed via snake.
    expect(groups[0].playerIds[0]).toBe('c');
    expect(groups[1].playerIds[0]).toBe('d');
  });

  it('handles uneven distribution', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const groups = buildGroupAssignment(ids, 3);
    expect(groups).toHaveLength(3);
    const total = groups.reduce((s, g) => s + g.playerIds.length, 0);
    expect(total).toBe(5);
  });

  it('returns empty groups when manualOnly', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const groups = buildGroupAssignment(ids, 2, undefined, true);
    expect(groups[0].playerIds).toEqual([]);
    expect(groups[1].playerIds).toEqual([]);
  });

  it('assigns group names as A조, B조, ...', () => {
    const groups = buildGroupAssignment(['a', 'b', 'c'], 3);
    expect(groups.map(g => g.name)).toEqual(['A조', 'B조', 'C조']);
  });
});

describe('generateRoundRobinPairings', () => {
  it('returns empty for < 2 participants', () => {
    expect(generateRoundRobinPairings(0)).toEqual([]);
    expect(generateRoundRobinPairings(1)).toEqual([]);
  });

  it('generates correct number of matches for even participants', () => {
    // 4 players → 4*3/2 = 6 matches
    const pairings = generateRoundRobinPairings(4);
    expect(pairings).toHaveLength(6);
  });

  it('generates correct number of matches for odd participants', () => {
    // 5 players → 5*4/2 = 10 matches
    const pairings = generateRoundRobinPairings(5);
    expect(pairings).toHaveLength(10);
  });

  it('each participant appears the right number of times', () => {
    const pairings = generateRoundRobinPairings(4);
    const counts = new Map<number, number>();
    for (const p of pairings) {
      counts.set(p.player1Index, (counts.get(p.player1Index) || 0) + 1);
      counts.set(p.player2Index, (counts.get(p.player2Index) || 0) + 1);
    }
    // Each of 4 players plays 3 matches
    for (let i = 0; i < 4; i++) {
      expect(counts.get(i)).toBe(3);
    }
  });

  it('no duplicate pairings', () => {
    const pairings = generateRoundRobinPairings(6);
    const seen = new Set<string>();
    for (const p of pairings) {
      const key = [Math.min(p.player1Index, p.player2Index), Math.max(p.player1Index, p.player2Index)].join('-');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('generateSingleEliminationBracket', () => {
  it('returns empty for < 2 participants', () => {
    expect(generateSingleEliminationBracket(0)).toEqual([]);
    expect(generateSingleEliminationBracket(1)).toEqual([]);
  });

  it('generates correct total slots for power of 2', () => {
    // 4 participants → 2 rounds: 2 + 1 = 3 slots
    const slots = generateSingleEliminationBracket(4);
    expect(slots).toHaveLength(3);
  });

  it('generates correct total slots for non-power of 2', () => {
    // 5 participants → rounds up to 8 → 3 rounds: 4 + 2 + 1 = 7 slots
    const slots = generateSingleEliminationBracket(5);
    expect(slots).toHaveLength(7);
  });

  it('round 1 has no source positions', () => {
    const slots = generateSingleEliminationBracket(8);
    const r1 = slots.filter(s => s.round === 1);
    expect(r1).toHaveLength(4);
    for (const s of r1) {
      expect(s.sourcePosition1).toBeUndefined();
      expect(s.sourcePosition2).toBeUndefined();
    }
  });

  it('subsequent rounds reference previous round positions', () => {
    const slots = generateSingleEliminationBracket(4);
    const final = slots.find(s => s.round === 2);
    expect(final).toBeDefined();
    expect(final!.sourcePosition1).toBe(1);
    expect(final!.sourcePosition2).toBe(2);
  });
});

describe('calculateWildcard', () => {
  it('calculates wildcard when finalsSlots > direct advance', () => {
    const result = calculateWildcard(8, 2, 3);
    expect(result.directAdvance).toBe(6);
    expect(result.wildcardCount).toBe(2);
    expect(result.wildcardFromRank).toBe(3);
  });

  it('returns 0 wildcards when finalsSlots <= direct advance', () => {
    const result = calculateWildcard(4, 2, 3);
    expect(result.wildcardCount).toBe(0);
  });
});

describe('calculateMatchCount', () => {
  const noRanking = { enabled: false };

  it('single stage (no groups, no finals) → full round robin', () => {
    const result = calculateMatchCount(4, false, 0, false, 0, noRanking);
    expect(result.qualifying).toBe(6); // 4*3/2
    expect(result.total).toBe(6);
  });

  it('group stage only (1 group = full league)', () => {
    const result = calculateMatchCount(6, true, 1, false, 0, noRanking);
    expect(result.qualifying).toBe(15); // 6*5/2
    expect(result.finals).toBe(0);
    expect(result.total).toBe(15);
  });

  it('group stage with multiple groups', () => {
    // 8 players, 2 groups → 4 per group → 4*3/2 = 6 per group → 12 total
    const result = calculateMatchCount(8, true, 2, false, 0, noRanking);
    expect(result.qualifying).toBe(12);
  });

  it('finals only → single elimination', () => {
    const result = calculateMatchCount(8, false, 0, true, 8, noRanking);
    expect(result.finals).toBe(7); // 8-1
  });

  it('group + finals', () => {
    const result = calculateMatchCount(8, true, 2, true, 4, noRanking);
    expect(result.qualifying).toBe(12); // 2 groups of 4
    expect(result.finals).toBe(3);      // 4-1
    expect(result.total).toBe(15);
  });

  it('ranking match: 3rd place adds 1', () => {
    const result = calculateMatchCount(8, true, 2, true, 4, { enabled: true, thirdPlace: true });
    expect(result.ranking).toBe(1);
  });

  it('ranking match: 5-8th simple adds 2', () => {
    const result = calculateMatchCount(8, true, 2, true, 4, {
      enabled: true, fifthToEighth: true, fifthToEighthFormat: 'simple',
    });
    expect(result.ranking).toBe(2);
  });

  it('uneven group distribution calculates correctly', () => {
    // 7 players, 2 groups → 4 + 3 → 6 + 3 = 9
    const result = calculateMatchCount(7, true, 2, false, 0, noRanking);
    expect(result.qualifying).toBe(9);
  });
});
