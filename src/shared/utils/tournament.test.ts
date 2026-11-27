import { describe, it, expect } from 'vitest';
import {
  mapToLegacyFormat,
  buildGroupAssignment,
  calculateWildcard,
  calculateMatchCount,
  countPlayableMatches,
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
  const noRanking: import('../types').RankingMatchConfig = {
    enabled: false,
    thirdPlace: false,
    fifthToEighth: false,
    fifthToEighthFormat: 'simple',
    classificationGroups: false,
    classificationGroupSize: 4,
  };

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
    const result = calculateMatchCount(8, true, 2, true, 4, { ...noRanking, enabled: true, thirdPlace: true });
    expect(result.ranking).toBe(1);
  });

  it('3rd place counts even when other ranking matches are off (wizard toggles are independent)', () => {
    const result = calculateMatchCount(8, true, 2, true, 4, { ...noRanking, enabled: false, thirdPlace: true });
    expect(result.ranking).toBe(1);
    expect(result.total).toBe(16); // 12 + 3 + 1
  });

  it('no 3rd place match with only 2 finalists', () => {
    const result = calculateMatchCount(8, true, 2, true, 2, { ...noRanking, thirdPlace: true });
    expect(result.ranking).toBe(0);
  });

  it('ranking match: 5-8th simple adds 2', () => {
    const result = calculateMatchCount(8, true, 2, true, 4, {
      ...noRanking, enabled: true, fifthToEighth: true, fifthToEighthFormat: 'simple',
    });
    expect(result.ranking).toBe(2);
  });

  it('uneven group distribution calculates correctly', () => {
    // 7 players, 2 groups → 4 + 3 → 6 + 3 = 9
    const result = calculateMatchCount(7, true, 2, false, 0, noRanking);
    expect(result.qualifying).toBe(9);
  });
});

describe('countPlayableMatches', () => {
  it('BYE 경기(bye/isBye)는 세지 않는다', () => {
    expect(countPlayableMatches([{}, { bye: true }, { isBye: true }, { bye: false }])).toBe(2);
  });
});
