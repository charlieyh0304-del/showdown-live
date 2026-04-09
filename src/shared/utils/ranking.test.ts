import { describe, it, expect } from 'vitest';
import { calculateIndividualRanking, calculateTeamRanking } from './ranking';
import type { Match } from '../types';

function makeMatch(
  id: string,
  p1Id: string,
  p1Name: string,
  p2Id: string,
  p2Name: string,
  setScores: Array<[number, number]>,
): Match {
  const sets = setScores.map(([s1, s2]) => ({
    player1Score: s1,
    player2Score: s2,
    winnerId: s1 > s2 ? p1Id : p2Id,
  }));
  const p1Wins = setScores.filter(([s1, s2]) => s1 > s2).length;
  const p2Wins = setScores.length - p1Wins;
  return {
    id,
    tournamentId: 't1',
    type: 'individual',
    status: 'completed',
    player1Id: p1Id,
    player2Id: p2Id,
    player1Name: p1Name,
    player2Name: p2Name,
    sets,
    currentSet: sets.length - 1,
    player1Timeouts: 0,
    player2Timeouts: 0,
    winnerId: p1Wins > p2Wins ? p1Id : p2Id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Match;
}

describe('calculateIndividualRanking', () => {
  it('빈 매치 → 빈 순위', () => {
    expect(calculateIndividualRanking([])).toEqual([]);
  });

  it('미완료 경기 제외', () => {
    const m: Match = {
      id: 'm1', tournamentId: 't1', type: 'individual', status: 'pending',
      player1Id: 'a', player2Id: 'b', player1Name: 'A', player2Name: 'B',
      sets: [], currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
      createdAt: Date.now(), updatedAt: Date.now(),
    } as Match;
    expect(calculateIndividualRanking([m])).toEqual([]);
  });

  it('1경기: 승자가 1위', () => {
    const m = makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 7]]);
    const r = calculateIndividualRanking([m]);
    expect(r).toHaveLength(2);
    expect(r[0].playerId).toBe('a');
    expect(r[0].rank).toBe(1);
    expect(r[0].wins).toBe(1);
    expect(r[0].losses).toBe(0);
    expect(r[1].playerId).toBe('b');
    expect(r[1].rank).toBe(2);
  });

  it('승수 동점 → 세트 득실로 정렬', () => {
    // A는 B를 2-0으로, C는 D를 2-1로 이김
    // 그 다음 A vs C는 1-2 로 A 패배 → A 1승1패, C 2승, B 0승 1패, D 0승 1패
    const matches = [
      makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 7]]),
      makeMatch('m2', 'c', 'C', 'd', 'D', [[11, 5], [9, 11], [11, 8]]),
      makeMatch('m3', 'a', 'A', 'c', 'C', [[11, 9], [9, 11], [9, 11]]),
    ];
    const r = calculateIndividualRanking(matches);
    expect(r[0].playerId).toBe('c');
    expect(r[0].wins).toBe(2);
    expect(r[1].playerId).toBe('a');
    expect(r[1].wins).toBe(1);
  });

  it('세트 득실 동점 → 점수 득실로 정렬', () => {
    // A: 11-5 11-5 (세트 +2, 점수 +12) vs C: 11-9 11-9 (세트 +2, 점수 +4)
    // A가 더 큰 점수 차이로 이김 → A가 1위
    const matches = [
      makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 5]]),
      makeMatch('m2', 'c', 'C', 'd', 'D', [[11, 9], [11, 9]]),
    ];
    const r = calculateIndividualRanking(matches);
    expect(r[0].playerId).toBe('a');
    expect(r[1].playerId).toBe('c');
  });

  it('순위는 1부터 시작', () => {
    const m = makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 7]]);
    const r = calculateIndividualRanking([m]);
    expect(r[0].rank).toBe(1);
    expect(r[1].rank).toBe(2);
  });

  it('완료된 매치만 점수 합산', () => {
    const m1 = makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 7]]);
    const m2 = makeMatch('m2', 'a', 'A', 'b', 'B', [[5, 11], [7, 11]]);
    const r = calculateIndividualRanking([m1, m2]);
    expect(r[0].wins).toBe(1);
    expect(r[0].losses).toBe(1);
    expect(r[0].played).toBe(2);
  });
});

describe('calculateTeamRanking', () => {
  function makeTeamMatch(id: string, t1Id: string, t1Name: string, t2Id: string, t2Name: string, score1: number, score2: number): Match {
    return {
      id,
      tournamentId: 't1',
      type: 'team',
      status: 'completed',
      team1Id: t1Id,
      team2Id: t2Id,
      team1Name: t1Name,
      team2Name: t2Name,
      sets: [{ player1Score: score1, player2Score: score2, winnerId: score1 > score2 ? t1Id : t2Id }],
      currentSet: 0,
      player1Timeouts: 0,
      player2Timeouts: 0,
      winnerId: score1 > score2 ? t1Id : t2Id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Match;
  }

  it('팀 1경기 → 승자가 1위', () => {
    const m = makeTeamMatch('m1', 't1', '전남', 't2', '경북', 31, 25);
    const r = calculateTeamRanking([m]);
    expect(r[0].teamId).toBe('t1');
    expect(r[0].rank).toBe(1);
    expect(r[1].teamId).toBe('t2');
    expect(r[1].rank).toBe(2);
  });
});
