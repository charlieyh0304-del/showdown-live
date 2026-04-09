import { describe, it, expect } from 'vitest';
import {
  seedBracket,
  getBracketPairs,
  applyAvoidSameGroup,
  computeBracketSize,
  buildFirstRoundPairs,
  getRoundName,
  type SeedEntry,
} from './bracket-seeding';

const e = (id: string, gid: string, rank: number): SeedEntry => ({
  id, name: id.toUpperCase(), gid, rank,
});

describe('seedBracket', () => {
  it('빈 배열', () => {
    expect(seedBracket([])).toEqual([]);
  });

  it('1위만: 정순 그대로', () => {
    const advanced = [e('a', 'A', 1), e('b', 'B', 1), e('c', 'C', 1)];
    expect(seedBracket(advanced).map(p => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('1위 + 2위: 2위는 역순으로 뒤에', () => {
    const advanced = [
      e('a1', 'A', 1), e('b1', 'B', 1),
      e('a2', 'A', 2), e('b2', 'B', 2),
    ];
    expect(seedBracket(advanced).map(p => p.id)).toEqual(['a1', 'b1', 'b2', 'a2']);
  });

  it('1위 + 2위 + 와일드카드: WC는 끝에 그대로', () => {
    const advanced = [
      e('a1', 'A', 1), e('b1', 'B', 1),
      e('a2', 'A', 2), e('b2', 'B', 2),
      e('w1', 'A', 3), e('w2', 'B', 3),
    ];
    expect(seedBracket(advanced).map(p => p.id)).toEqual(['a1', 'b1', 'b2', 'a2', 'w1', 'w2']);
  });
});

describe('getBracketPairs', () => {
  it('bracketSize=2', () => {
    expect(getBracketPairs(2)).toEqual([[0, 1]]);
  });
  it('bracketSize=4', () => {
    expect(getBracketPairs(4)).toEqual([[0, 3], [1, 2]]);
  });
  it('bracketSize=8', () => {
    expect(getBracketPairs(8)).toEqual([[0, 7], [1, 6], [2, 5], [3, 4]]);
  });
  it('bracketSize=16', () => {
    const pairs = getBracketPairs(16);
    expect(pairs).toHaveLength(8);
    expect(pairs[0]).toEqual([0, 15]);
    expect(pairs[7]).toEqual([7, 8]);
  });
});

describe('computeBracketSize', () => {
  it('2명 → 2', () => expect(computeBracketSize(2)).toBe(2));
  it('3명 → 4', () => expect(computeBracketSize(3)).toBe(4));
  it('5명 → 8', () => expect(computeBracketSize(5)).toBe(8));
  it('8명 → 8', () => expect(computeBracketSize(8)).toBe(8));
  it('14명 → 16', () => expect(computeBracketSize(14)).toBe(16));
  it('17명 → 32', () => expect(computeBracketSize(17)).toBe(32));
  it('1명 미만 → 최소 2', () => expect(computeBracketSize(1)).toBe(2));
  it('0명 → 최소 2', () => expect(computeBracketSize(0)).toBe(2));
});

describe('applyAvoidSameGroup', () => {
  it('충돌 없음 → 변경 없음', () => {
    const seeded = [e('a1', 'A', 1), e('b1', 'B', 1), e('c1', 'C', 1), e('d1', 'D', 1)];
    const before = seeded.map(p => p.id);
    applyAvoidSameGroup(seeded, 4);
    expect(seeded.map(p => p.id)).toEqual(before);
  });

  it('단일 충돌 해결 (스왑)', () => {
    // bracketSize=4, pairs: [0,3], [1,2]
    // [a1, b1, a2, b2] → pair0: a1 vs b2 (다른 조), pair1: b1 vs a2 (다른 조) → 충돌 없음
    // 충돌 케이스: [a1, b1, b2, a2]일 때 pair0: a1 vs a2 충돌
    const seeded = [e('a1', 'A', 1), e('b1', 'B', 1), e('b2', 'B', 2), e('a2', 'A', 2)];
    applyAvoidSameGroup(seeded, 4);
    // pair0(0,3)=a1 vs a2 충돌 → pair1(1,2)의 idx2(=b2)와 스왑
    // 스왑 후: [a1, b1, a2, b2] → pair0: a1 vs b2, pair1: b1 vs a2 (모두 다른 조) ✓
    expect(seeded.map(p => p.id)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('스왑 후 새 충돌 발생하면 시도 중단 (안전)', () => {
    // 모두 같은 조 → 어떤 스왑도 의미 없음 → 변경 없음
    const seeded = [e('a1', 'A', 1), e('a2', 'A', 2), e('a3', 'A', 3), e('a4', 'A', 4)];
    applyAvoidSameGroup(seeded, 4);
    expect(seeded.map(p => p.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('BYE(슬롯 부족)는 스킵', () => {
    // bracketSize=8, 5명만 → 일부는 null
    const seeded = [e('a1', 'A', 1), e('b1', 'B', 1), e('c1', 'C', 1), e('a2', 'A', 2), e('b2', 'B', 2)];
    applyAvoidSameGroup(seeded, 8);
    // 충돌 없는 슬롯들은 그대로
    expect(seeded).toHaveLength(5);
  });

  it('원본 배열 mutate', () => {
    const seeded = [e('a1', 'A', 1), e('b1', 'B', 1), e('b2', 'B', 2), e('a2', 'A', 2)];
    const ret = applyAvoidSameGroup(seeded, 4);
    expect(ret).toBe(seeded); // 같은 참조
  });
});

describe('buildFirstRoundPairs', () => {
  it('bracketSize=4, 4명 모두 채워짐', () => {
    const seeded = [e('a', 'A', 1), e('b', 'B', 1), e('c', 'C', 1), e('d', 'D', 1)];
    const pairs = buildFirstRoundPairs(seeded, 4);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ position: 0, isBye: false });
    expect(pairs[0].p1?.id).toBe('a');
    expect(pairs[0].p2?.id).toBe('d');
    expect(pairs[1]).toMatchObject({ position: 1, isBye: false });
    expect(pairs[1].p1?.id).toBe('b');
    expect(pairs[1].p2?.id).toBe('c');
  });

  it('bracketSize=8, 5명 → 3 BYE', () => {
    const seeded = [e('a', 'A', 1), e('b', 'B', 1), e('c', 'C', 1), e('d', 'D', 1), e('e', 'E', 1)];
    const pairs = buildFirstRoundPairs(seeded, 8);
    expect(pairs).toHaveLength(4);
    // 슬롯: [a,b,c,d,e,null,null,null]
    // pairs: (0,7) (1,6) (2,5) (3,4)
    expect(pairs[0].isBye).toBe(true); // a vs null
    expect(pairs[0].p1?.id).toBe('a');
    expect(pairs[0].p2).toBe(null);
    expect(pairs[1].isBye).toBe(true);
    expect(pairs[2].isBye).toBe(true);
    expect(pairs[3].isBye).toBe(false); // d vs e
    expect(pairs[3].p1?.id).toBe('d');
    expect(pairs[3].p2?.id).toBe('e');
  });

  it('bracketSize=4, 빈 배열 → 모두 BYE', () => {
    const pairs = buildFirstRoundPairs([], 4);
    expect(pairs.every(p => p.isBye)).toBe(true);
    expect(pairs.every(p => p.p1 === null && p.p2 === null)).toBe(true);
  });
});

describe('getRoundName', () => {
  it('표준 라운드', () => {
    expect(getRoundName(32)).toBe('32강');
    expect(getRoundName(16)).toBe('16강');
    expect(getRoundName(8)).toBe('8강');
    expect(getRoundName(4)).toBe('4강');
    expect(getRoundName(2)).toBe('결승');
  });
  it('비표준 라운드 fallback', () => {
    expect(getRoundName(64)).toBe('64강');
    expect(getRoundName(7)).toBe('7강');
  });
});
