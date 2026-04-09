import { describe, it, expect } from 'vitest';
import { generateRoundRobin, generateSingleElimination } from './bracket';

describe('generateRoundRobin', () => {
  it('4명 → C(4,2) = 6경기', () => {
    const players = [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
      { id: 'p3', name: 'C' },
      { id: 'p4', name: 'D' },
    ];
    const matches = generateRoundRobin(players, 't1', 'individual');
    expect(matches).toHaveLength(6);
  });

  it('3명 → C(3,2) = 3경기 (BYE 추가됨)', () => {
    const players = [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
      { id: 'p3', name: 'C' },
    ];
    const matches = generateRoundRobin(players, 't1', 'individual');
    expect(matches).toHaveLength(3);
  });

  it('5명 → C(5,2) = 10경기', () => {
    const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const matches = generateRoundRobin(players, 't1', 'individual');
    expect(matches).toHaveLength(10);
  });

  it('6명 → C(6,2) = 15경기', () => {
    const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const matches = generateRoundRobin(players, 't1', 'individual');
    expect(matches).toHaveLength(15);
  });

  it('각 페어가 정확히 한 번씩만 나옴', () => {
    const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const matches = generateRoundRobin(players, 't1', 'individual');
    const pairs = new Set<string>();
    for (const m of matches) {
      const a = m.player1Id!;
      const b = m.player2Id!;
      const key = [a, b].sort().join('-');
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
    }
    expect(pairs.size).toBe(15);
  });

  it('팀전 모드 → team1Id/team2Id 사용', () => {
    const teams = [
      { id: 't1', name: '전남' },
      { id: 't2', name: '경북' },
    ];
    const matches = generateRoundRobin(teams, 'tour1', 'team');
    expect(matches).toHaveLength(1);
    expect(matches[0].team1Id).toBe('t1');
    expect(matches[0].team2Id).toBe('t2');
  });

  it('개인전 모드 → player1Id/player2Id 사용', () => {
    const players = [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
    ];
    const matches = generateRoundRobin(players, 't1', 'individual');
    expect(matches[0].player1Id).toBe('p1');
    expect(matches[0].player2Id).toBe('p2');
  });

  it('빈 리스트 → 빈 매치', () => {
    expect(generateRoundRobin([], 't1', 'individual')).toEqual([]);
  });

  it('1명 → 빈 매치', () => {
    expect(generateRoundRobin([{ id: 'p1', name: 'A' }], 't1', 'individual')).toEqual([]);
  });
});

describe('generateSingleElimination', () => {
  it('8명 → 7경기 (4+2+1)', () => {
    const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const matches = generateSingleElimination(players, 't1', 'individual');
    expect(matches.length).toBeGreaterThanOrEqual(7);
  });

  it('4명 → 3경기 (2+1)', () => {
    const players = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const matches = generateSingleElimination(players, 't1', 'individual');
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('2명 → 1경기 (결승)', () => {
    const players = [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
    ];
    const matches = generateSingleElimination(players, 't1', 'individual');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
