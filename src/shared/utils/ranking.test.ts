import { describe, it, expect } from 'vitest';
import { participantStats, qualifierMarks } from './ranking';
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
    round: 1,
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

describe('participantStats', () => {
  it('빈 매치 → 빈 순위', () => {
    expect(participantStats([])).toEqual([]);
  });

  it('미완료 경기 제외', () => {
    const m: Match = {
      id: 'm1', tournamentId: 't1', type: 'individual', status: 'pending',
      round: 1,
      player1Id: 'a', player2Id: 'b', player1Name: 'A', player2Name: 'B',
      sets: [], currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
      createdAt: Date.now(), updatedAt: Date.now(),
    } as Match;
    expect(participantStats([m])).toEqual([]);
  });

  it('1경기: 승자가 1위', () => {
    const m = makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 7]]);
    const r = participantStats([m]);
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
    const r = participantStats(matches);
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
    const r = participantStats(matches);
    expect(r[0].playerId).toBe('a');
    expect(r[1].playerId).toBe('c');
  });

  it('순위는 1부터 시작', () => {
    const m = makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 7]]);
    const r = participantStats([m]);
    expect(r[0].rank).toBe(1);
    expect(r[1].rank).toBe(2);
  });

  it('완료된 매치만 점수 합산', () => {
    const m1 = makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 7]]);
    const m2 = makeMatch('m2', 'a', 'A', 'b', 'B', [[5, 11], [7, 11]]);
    const r = participantStats([m1, m2]);
    expect(r[0].wins).toBe(1);
    expect(r[0].losses).toBe(1);
    expect(r[0].played).toBe(2);
  });
});

describe('participantStats (team)', () => {
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
    const r = participantStats([m]);
    expect(r[0].playerId).toBe('t1');
    expect(r[0].rank).toBe(1);
    expect(r[1].playerId).toBe('t2');
    expect(r[1].rank).toBe(2);
  });
});

describe('participantStats uses the stats context and match rules', () => {
  it('sets are counted with the match rules (31-point team set, not raw >)', () => {
    const m = makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 10], [11, 5], [11, 3]]);
    // 11:10은 2점 차 규칙상 끝나지 않은 세트 → 세지 않는다
    expect(participantStats([m])[0].setsWon).toBe(2);
  });
  it('walkovers can be excluded from player stats (walkover.countInPlayerStats)', () => {
    const m = { ...makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 0], [11, 0]]), walkover: true } as Match;
    expect(participantStats([m])).toHaveLength(2);
    expect(participantStats([m], { rules: { walkover: { countInPlayerStats: false } } })).toHaveLength(0);
  });
});

describe('qualifierMarks (advance badges from selectQualifiers)', () => {
  const g = (m: Match, groupId: string) => ({ ...m, groupId }) as Match;
  it('marks perGroup qualifiers and explicit wildcards', () => {
    const ms = [
      g(makeMatch('a1', 'a', 'A', 'b', 'B', [[11, 1], [11, 1]]), 'A'),
      g(makeMatch('a2', 'a', 'A', 'c', 'C', [[11, 1], [11, 1]]), 'A'),
      g(makeMatch('a3', 'b', 'B', 'c', 'C', [[11, 1], [11, 1]]), 'A'),
      g(makeMatch('b1', 'd', 'D', 'e', 'E', [[11, 1], [11, 1]]), 'B'),
      g(makeMatch('b2', 'd', 'D', 'f', 'F', [[11, 1], [11, 1]]), 'B'),
      g(makeMatch('b3', 'e', 'E', 'f', 'F', [[11, 9], [11, 9]]), 'B'),
    ];
    const marks = qualifierMarks(ms, { rules: { qualification: { perGroup: 1, wildcards: 1 } } });
    expect(marks.get('a')).toBe('qualified');
    expect(marks.get('d')).toBe('qualified');
    expect(marks.get('b')).toBe('wildcard'); // 2위끼리: B(점수 득실 0)가 E(-16)보다 앞선다
    expect(marks.has('e')).toBe(false);
  });
  it('a tie across the cutoff is not shown as qualified', () => {
    const circ = [
      g(makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 5], [11, 5]]), 'A'),
      g(makeMatch('m2', 'b', 'B', 'c', 'C', [[11, 5], [11, 5]]), 'A'),
      g(makeMatch('m3', 'c', 'C', 'a', 'A', [[11, 5], [11, 5]]), 'A'),
    ];
    const marks = qualifierMarks(circ, { rules: { qualification: { perGroup: 1 } } });
    expect([...marks.values()]).toEqual(['tie', 'tie', 'tie']);
  });
  it('before or during the group stage, an open cutoff tie gets no badge (not "tie" on every row)', () => {
    const pend = (m: Match) => ({ ...m, status: 'pending', sets: [], winnerId: null }) as Match;
    const ms = [
      g(pend(makeMatch('p1', 'a', 'A', 'b', 'B', [[11, 0]])), 'A'),
      g(pend(makeMatch('p2', 'c', 'C', 'd', 'D', [[11, 0]])), 'A'),
      g(pend(makeMatch('p3', 'a', 'A', 'c', 'C', [[11, 0]])), 'A'),
    ];
    expect(qualifierMarks(ms, { rules: { qualification: { perGroup: 2 } } }).size).toBe(0);
    // 한 조가 끝나고 다른 조가 진행 중: 끝난 조의 동률만 'tie', 진행 중인 조의 동률은 표시 없음
    const done = [
      g(makeMatch('m1', 'x', 'X', 'y', 'Y', [[11, 5], [11, 5]]), 'B'),
      g(makeMatch('m2', 'y', 'Y', 'z', 'Z', [[11, 5], [11, 5]]), 'B'),
      g(makeMatch('m3', 'z', 'Z', 'x', 'X', [[11, 5], [11, 5]]), 'B'),
    ];
    const marks = qualifierMarks([...ms, ...done], { rules: { qualification: { perGroup: 1 } } });
    expect(['a', 'b', 'c', 'd'].map(id => marks.get(id))).toEqual([undefined, undefined, undefined, undefined]);
    expect(['x', 'y', 'z'].map(id => marks.get(id))).toEqual(['tie', 'tie', 'tie']);
  });
  it('a clear provisional leader mid-stage is still marked qualified', () => {
    const pend = (m: Match) => ({ ...m, status: 'pending', sets: [], winnerId: null }) as Match;
    const ms = [
      g(makeMatch('m1', 'a', 'A', 'b', 'B', [[11, 1], [11, 1]]), 'A'),
      g(makeMatch('m2', 'a', 'A', 'c', 'C', [[11, 1], [11, 1]]), 'A'),
      g(pend(makeMatch('m3', 'b', 'B', 'c', 'C', [[11, 0]])), 'A'),
    ];
    const marks = qualifierMarks(ms, { rules: { qualification: { perGroup: 1 } } });
    expect(marks.get('a')).toBe('qualified');
    expect(marks.has('b') || marks.has('c')).toBe(false);
  });
});
