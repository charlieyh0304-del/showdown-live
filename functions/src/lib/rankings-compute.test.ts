import { describe, it, expect } from 'vitest';
import {
  accumulatePlayerStats,
  sortByRanking,
  computeGroupRankings,
  computeFinalRanking,
  computeRankingDisplayCount,
  splitIntoRankingTiers,
  type MatchLike,
  type PlayerStats,
  type TierMember,
} from './rankings-compute';

// 헬퍼: 라운드로빈 단일 세트 매치 생성
function m(
  id1: string, n1: string, id2: string, n2: string,
  s1: number, s2: number,
  opts: Partial<MatchLike> = {},
): MatchLike {
  return {
    status: 'completed',
    player1Id: id1, player2Id: id2,
    player1Name: n1, player2Name: n2,
    winnerId: s1 > s2 ? id1 : id2,
    sets: [{ player1Score: s1, player2Score: s2 }],
    ...opts,
  };
}

describe('accumulatePlayerStats', () => {
  it('빈 배열 → 빈 Map', () => {
    expect(accumulatePlayerStats([]).size).toBe(0);
  });

  it('미완료 매치 무시', () => {
    const matches: MatchLike[] = [
      { ...m('a', 'A', 'b', 'B', 11, 5), status: 'pending' },
    ];
    expect(accumulatePlayerStats(matches).size).toBe(0);
  });

  it('단일 매치: 양쪽 통계 정확', () => {
    const stats = accumulatePlayerStats([m('a', 'A', 'b', 'B', 11, 5)]);
    expect(stats.get('a')).toMatchObject({ wins: 1, losses: 0, setsWon: 1, setsLost: 0, pointsFor: 11, pointsAgainst: 5 });
    expect(stats.get('b')).toMatchObject({ wins: 0, losses: 1, setsWon: 0, setsLost: 1, pointsFor: 5, pointsAgainst: 11 });
  });

  it('multi-set: 세트별 누적', () => {
    const matches: MatchLike[] = [{
      status: 'completed',
      player1Id: 'a', player2Id: 'b',
      player1Name: 'A', player2Name: 'B',
      winnerId: 'a',
      sets: [
        { player1Score: 11, player2Score: 5 },
        { player1Score: 8, player2Score: 11 },
        { player1Score: 11, player2Score: 9 },
      ],
    }];
    const stats = accumulatePlayerStats(matches);
    expect(stats.get('a')).toMatchObject({ wins: 1, setsWon: 2, setsLost: 1, pointsFor: 30, pointsAgainst: 25 });
    expect(stats.get('b')).toMatchObject({ losses: 1, setsWon: 1, setsLost: 2, pointsFor: 25, pointsAgainst: 30 });
  });

  it('team match shape (team1Id) 처리', () => {
    const tm: MatchLike = {
      status: 'completed',
      team1Id: 't1', team2Id: 't2',
      team1Name: '레드', team2Name: '블루',
      winnerId: 't1',
      sets: [{ player1Score: 31, player2Score: 28 }],
    };
    const stats = accumulatePlayerStats([tm]);
    expect(stats.get('t1')?.name).toBe('레드');
    expect(stats.get('t1')?.wins).toBe(1);
    expect(stats.get('t2')?.losses).toBe(1);
  });

  it('excludeFinals: 본선/순위결정전 제외', () => {
    const matches: MatchLike[] = [
      { ...m('a', 'A', 'b', 'B', 11, 5), groupId: 'g1' },
      { ...m('a', 'A', 'c', 'C', 11, 7), stageId: 'stage_finals_x' },
    ];
    const stats = accumulatePlayerStats(matches, { excludeFinals: true });
    expect(stats.get('a')?.wins).toBe(1); // 본선 매치 제외
    expect(stats.get('c')).toBeUndefined();
  });

  it('excludeBye: BYE 제외', () => {
    const matches: MatchLike[] = [
      { ...m('a', 'A', 'b', 'B', 11, 5) },
      { ...m('a', 'A', 'BYE', '부전승', 11, 0), isBye: true },
    ];
    const stats = accumulatePlayerStats(matches, { excludeBye: true });
    expect(stats.get('a')?.wins).toBe(1);
    expect(stats.has('BYE')).toBe(false);
  });

  it('BYE id는 자동 차단', () => {
    const matches: MatchLike[] = [
      { ...m('a', 'A', 'BYE', '부전승', 11, 0) },
    ];
    expect(accumulatePlayerStats(matches).size).toBe(0);
  });

  it('onlyGroupId 필터링', () => {
    const matches: MatchLike[] = [
      { ...m('a', 'A', 'b', 'B', 11, 5), groupId: 'g1' },
      { ...m('c', 'C', 'd', 'D', 11, 7), groupId: 'g2' },
    ];
    const stats = accumulatePlayerStats(matches, { onlyGroupId: 'g1' });
    expect(stats.size).toBe(2);
    expect(stats.has('a')).toBe(true);
    expect(stats.has('c')).toBe(false);
  });
});

describe('sortByRanking', () => {
  it('승수 우선', () => {
    const stats: PlayerStats[] = [
      { id: 'a', name: 'A', wins: 1, losses: 2, setsWon: 2, setsLost: 4, pointsFor: 50, pointsAgainst: 60 },
      { id: 'b', name: 'B', wins: 3, losses: 0, setsWon: 6, setsLost: 0, pointsFor: 66, pointsAgainst: 30 },
      { id: 'c', name: 'C', wins: 2, losses: 1, setsWon: 4, setsLost: 2, pointsFor: 60, pointsAgainst: 50 },
    ];
    const sorted = sortByRanking(stats);
    expect(sorted.map(s => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('승수 동률 → 세트 득실차', () => {
    const stats: PlayerStats[] = [
      { id: 'a', name: 'A', wins: 2, losses: 1, setsWon: 4, setsLost: 3, pointsFor: 50, pointsAgainst: 50 },
      { id: 'b', name: 'B', wins: 2, losses: 1, setsWon: 5, setsLost: 2, pointsFor: 50, pointsAgainst: 50 },
    ];
    const sorted = sortByRanking(stats);
    expect(sorted[0].id).toBe('b'); // 세트 +3 > +1
  });

  it('세트 동률 → 점수 득실차', () => {
    const stats: PlayerStats[] = [
      { id: 'a', name: 'A', wins: 1, losses: 1, setsWon: 2, setsLost: 2, pointsFor: 30, pointsAgainst: 35 },
      { id: 'b', name: 'B', wins: 1, losses: 1, setsWon: 2, setsLost: 2, pointsFor: 35, pointsAgainst: 30 },
    ];
    const sorted = sortByRanking(stats);
    expect(sorted[0].id).toBe('b'); // 점수 +5 > -5
  });

  it('원본 배열 불변', () => {
    const stats: PlayerStats[] = [
      { id: 'a', name: 'A', wins: 1, losses: 0, setsWon: 1, setsLost: 0, pointsFor: 11, pointsAgainst: 5 },
      { id: 'b', name: 'B', wins: 0, losses: 1, setsWon: 0, setsLost: 1, pointsFor: 5, pointsAgainst: 11 },
    ];
    const original = [...stats];
    sortByRanking(stats);
    expect(stats).toEqual(original);
  });
});

describe('computeGroupRankings', () => {
  it('단일 그룹 (groupId 없음 → full_league)', () => {
    const matches: MatchLike[] = [
      m('a', 'A', 'b', 'B', 11, 5),
      m('b', 'B', 'c', 'C', 11, 7),
      m('a', 'A', 'c', 'C', 11, 9),
    ];
    const result = computeGroupRankings(matches);
    expect([...result.keys()]).toEqual(['full_league']);
    const ranked = result.get('full_league')!;
    expect(ranked.map(p => p.id)).toEqual(['a', 'b', 'c']); // 2승 / 1승 / 0승
  });

  it('다중 그룹 분리', () => {
    const matches: MatchLike[] = [
      { ...m('a', 'A', 'b', 'B', 11, 5), groupId: 'g1' },
      { ...m('c', 'C', 'd', 'D', 11, 7), groupId: 'g2' },
    ];
    const result = computeGroupRankings(matches);
    expect([...result.keys()].sort()).toEqual(['g1', 'g2']);
    expect(result.get('g1')!.length).toBe(2);
    expect(result.get('g2')!.length).toBe(2);
    expect(result.get('g1')!.find(p => p.id === 'c')).toBeUndefined();
  });

  it('본선 매치는 그룹 순위에서 제외', () => {
    const matches: MatchLike[] = [
      { ...m('a', 'A', 'b', 'B', 11, 5), groupId: 'g1' },
      { ...m('a', 'A', 'b', 'B', 11, 9), groupId: 'g1', stageId: 'stage_finals_x' },
    ];
    const result = computeGroupRankings(matches);
    const a = result.get('g1')!.find(p => p.id === 'a')!;
    expect(a.wins).toBe(1); // 본선 매치 제외, 예선만 카운트
  });
});

describe('computeFinalRanking', () => {
  it('전체 매치(본선 포함) 통합 순위', () => {
    const matches: MatchLike[] = [
      m('a', 'A', 'b', 'B', 11, 5),  // 예선
      { ...m('a', 'A', 'c', 'C', 11, 9), stageId: 'stage_finals_x' }, // 본선
    ];
    const ranked = computeFinalRanking(matches);
    expect(ranked[0].id).toBe('a');
    expect(ranked[0].wins).toBe(2); // 본선까지 합산
  });

  it('BYE 매치 제외', () => {
    const matches: MatchLike[] = [
      m('a', 'A', 'b', 'B', 11, 5),
      { ...m('a', 'A', 'BYE', '부전승', 11, 0), isBye: true },
    ];
    const ranked = computeFinalRanking(matches);
    expect(ranked.find(p => p.id === 'a')?.wins).toBe(1); // BYE 미카운트
  });
});

describe('computeRankingDisplayCount', () => {
  it('config 없음 → 4', () => {
    expect(computeRankingDisplayCount(20, undefined)).toBe(4);
  });
  it('rankingUpTo 우선', () => {
    expect(computeRankingDisplayCount(20, { rankingUpTo: 5, fifthToEighth: true, classificationGroups: true })).toBe(5);
  });
  it('classificationGroups → 전체', () => {
    expect(computeRankingDisplayCount(20, { classificationGroups: true })).toBe(20);
  });
  it('fifthToEighth → 8', () => {
    expect(computeRankingDisplayCount(20, { fifthToEighth: true })).toBe(8);
  });
  it('totalPlayers 미만으로 자름', () => {
    expect(computeRankingDisplayCount(3, { fifthToEighth: true })).toBe(3);
  });
  it('rankingUpTo가 totalPlayers 초과 시 totalPlayers', () => {
    expect(computeRankingDisplayCount(5, { rankingUpTo: 10 })).toBe(5);
  });
});

describe('splitIntoRankingTiers', () => {
  const make = (n: number): TierMember[] =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

  it('빈 배열 → 빈 결과', () => {
    expect(splitIntoRankingTiers([], 4, 9)).toEqual([]);
  });

  it('1명 → 빈 결과 (짝 없음)', () => {
    expect(splitIntoRankingTiers(make(1), 4, 9)).toEqual([]);
  });

  it('정확히 4명 → 단일 tier (9~12위)', () => {
    const tiers = splitIntoRankingTiers(make(4), 4, 9);
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ label: '9~12위', startRank: 9, endRank: 12 });
    expect(tiers[0].members).toHaveLength(4);
  });

  it('8명 → 2 tiers (9~12위, 13~16위)', () => {
    const tiers = splitIntoRankingTiers(make(8), 4, 9);
    expect(tiers).toHaveLength(2);
    expect(tiers[0].label).toBe('9~12위');
    expect(tiers[1].label).toBe('13~16위');
  });

  it('9명 → 마지막 1명 버림 (짝 없음)', () => {
    const tiers = splitIntoRankingTiers(make(9), 4, 9);
    expect(tiers).toHaveLength(2);
    expect(tiers[0].members).toHaveLength(4);
    expect(tiers[1].members).toHaveLength(4);
  });

  it('10명 → 3 tiers (마지막 2명)', () => {
    const tiers = splitIntoRankingTiers(make(10), 4, 9);
    expect(tiers).toHaveLength(3);
    expect(tiers[0]).toMatchObject({ label: '9~12위', startRank: 9, endRank: 12 });
    expect(tiers[1]).toMatchObject({ label: '13~16위', startRank: 13, endRank: 16 });
    expect(tiers[2]).toMatchObject({ label: '17~18위', startRank: 17, endRank: 18 });
    expect(tiers[2].members).toHaveLength(2);
  });

  it('17위부터 시작 (IBSA classification)', () => {
    const tiers = splitIntoRankingTiers(make(8), 4, 17);
    expect(tiers[0].label).toBe('17~20위');
    expect(tiers[1].label).toBe('21~24위');
  });

  it('tierSize=2 (페어 매칭)', () => {
    const tiers = splitIntoRankingTiers(make(6), 2, 9);
    expect(tiers).toHaveLength(3);
    expect(tiers.map(t => t.label)).toEqual(['9~10위', '11~12위', '13~14위']);
  });

  it('tierSize<2 → 빈 결과 (방어)', () => {
    expect(splitIntoRankingTiers(make(10), 1, 9)).toEqual([]);
    expect(splitIntoRankingTiers(make(10), 0, 9)).toEqual([]);
  });

  it('멤버 객체는 입력 순서 보존', () => {
    const members = [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
      { id: 'c', name: 'Carol' },
      { id: 'd', name: 'David' },
    ];
    const tiers = splitIntoRankingTiers(members, 4, 9);
    expect(tiers[0].members.map(m => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('PlayerStats 같은 확장 타입도 처리 (제네릭)', () => {
    const stats: Array<{ id: string; name: string; wins: number }> = [
      { id: 'a', name: 'A', wins: 3 },
      { id: 'b', name: 'B', wins: 2 },
      { id: 'c', name: 'C', wins: 1 },
      { id: 'd', name: 'D', wins: 0 },
    ];
    const tiers = splitIntoRankingTiers(stats, 4, 9);
    expect(tiers[0].members[0].wins).toBe(3); // 추가 필드 보존
  });
});
