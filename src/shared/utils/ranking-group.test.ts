import { describe, it, expect } from 'vitest';
import { calculateGroupRanking } from './ranking';
import type { Match } from '../types';

function makeMatch(p1Id: string, p1Name: string, p2Id: string, p2Name: string, scores: Array<[number, number]>, status: 'pending' | 'completed' = 'completed'): Match {
  const sets = scores.map(([s1, s2]) => ({ player1Score: s1, player2Score: s2, winnerId: s1 > s2 ? p1Id : p2Id }));
  const p1Wins = scores.filter(([s1, s2]) => s1 > s2).length;
  return {
    id: `m_${Math.random()}`, tournamentId: 't1', type: 'individual', status,
    player1Id: p1Id, player2Id: p2Id, player1Name: p1Name, player2Name: p2Name,
    sets, currentSet: sets.length - 1, player1Timeouts: 0, player2Timeouts: 0,
    winnerId: status === 'completed' ? (p1Wins > 0 ? p1Id : p2Id) : null,
    createdAt: Date.now(), updatedAt: Date.now(),
  } as Match;
}

describe('calculateGroupRanking', () => {
  it('완료 + 미완료 매치 모두 → 전체 참가자 표시', () => {
    const matches = [
      makeMatch('a', 'A', 'b', 'B', [[11, 5], [11, 7]], 'completed'),
      makeMatch('c', 'C', 'd', 'D', [[0, 0]], 'pending'),
    ];
    const r = calculateGroupRanking(matches);
    expect(r.length).toBe(4);
    expect(r.map(p => p.playerId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('승수 0인 pending 참가자도 순위 표시', () => {
    const matches = [
      makeMatch('a', 'A', 'b', 'B', [[11, 5], [11, 7]], 'completed'),
      makeMatch('c', 'C', 'd', 'D', [[0, 0]], 'pending'),
    ];
    const r = calculateGroupRanking(matches);
    const c = r.find(p => p.playerId === 'c');
    expect(c).toBeDefined();
    expect(c!.wins).toBe(0);
    expect(c!.losses).toBe(0);
  });

  it('승자가 1위', () => {
    const matches = [
      makeMatch('a', 'A', 'b', 'B', [[11, 5], [11, 7]], 'completed'),
    ];
    const r = calculateGroupRanking(matches);
    expect(r[0].playerId).toBe('a');
    expect(r[0].rank).toBe(1);
  });

  it('전부 pending → 0승 0패로 표시', () => {
    const matches = [
      makeMatch('a', 'A', 'b', 'B', [[0, 0]], 'pending'),
      makeMatch('c', 'C', 'd', 'D', [[0, 0]], 'pending'),
    ];
    const r = calculateGroupRanking(matches);
    expect(r.length).toBe(4);
    r.forEach(p => {
      expect(p.wins).toBe(0);
      expect(p.losses).toBe(0);
    });
  });
});
