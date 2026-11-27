import { describe, it, expect } from 'vitest';
import {
  buildFirstRoundSlots,
  buildSingleEliminationSkeleton,
  fifthToEighthMatchCount,
  fifthToEighthStageId,
  hasUndecidedParticipant,
  nextPowerOfTwo,
  thirdPlaceStageId,
  type SkeletonEntrant,
} from './bracketSkeleton';
import { createEmptySet } from './scoring';
import type { SetScore } from '../types';
import type { FifthToEighthFormat } from '../rules/competitionRules';

function build(n: number, opts: { thirdPlace?: boolean; fifthToEighth?: FifthToEighthFormat; entrants?: SkeletonEntrant[]; team?: boolean; byeSets?: (side: 1 | 2, id: string) => SetScore[] } = {}) {
  let seq = 0;
  return buildSingleEliminationSkeleton({
    tournamentId: 't1',
    stageId: 'stage_finals_1',
    matchType: opts.team ? 'team' : 'individual',
    slots: buildFirstRoundSlots(n, opts.entrants),
    thirdPlace: opts.thirdPlace ?? true,
    fifthToEighth: opts.fifthToEighth,
    makeKey: () => `k${seq++}`,
    now: 1000,
    labels: { undecided: '미정', bye: '부전승' },
    byeSets: opts.byeSets,
  });
}

const entrants = (n: number): SkeletonEntrant[] => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

describe('buildSingleEliminationSkeleton', () => {
  for (let n = 2; n <= 32; n++) {
    it(`${n}명: 라운드 수·링크·BYE 수가 올바르다`, () => {
      const entries = build(n);
      const size = nextPowerOfTwo(n);
      const totalRounds = Math.log2(size);
      const main = entries.filter(e => e.match.stageId === 'stage_finals_1');
      const keys = new Set(entries.map(e => e.key));
      expect(keys.size).toBe(entries.length); // 키 중복 없음

      // 라운드별 경기 수: size/2, size/4, ..., 1
      for (let r = 1; r <= totalRounds; r++) {
        expect(main.filter(e => e.match.round === r)).toHaveLength(size / Math.pow(2, r));
      }
      expect(main).toHaveLength(size - 1);
      expect(main.filter(e => e.match.roundLabel === '결승')).toHaveLength(1);

      // BYE 경기 수 = size - n, 실제 1라운드 경기 = n - size/2
      const r1 = main.filter(e => e.match.round === 1);
      expect(r1.filter(e => e.match.isBye)).toHaveLength(size - n);

      const byKey = new Map(entries.map(e => [e.key, e.match]));
      const usedAsWinnerSource = new Map<string, number>();
      for (const e of entries) {
        const m = e.match;
        // 자기 참조 없음
        expect(m.sourceMatch1).not.toBe(e.key);
        expect(m.sourceMatch2).not.toBe(e.key);
        if (m.round === 1) {
          expect(m.sourceMatch1).toBeUndefined();
          continue;
        }
        // 1라운드 이후 경기는 존재하는 서로 다른 두 경기를 가리킨다
        expect(m.sourceMatch1).toBeTruthy();
        expect(m.sourceMatch2).toBeTruthy();
        expect(m.sourceMatch1).not.toBe(m.sourceMatch2);
        expect(keys.has(m.sourceMatch1!)).toBe(true);
        expect(keys.has(m.sourceMatch2!)).toBe(true);
        if (m.sourceType === 'winner') {
          expect(byKey.get(m.sourceMatch1!)!.round).toBe(m.round! - 1);
          expect(byKey.get(m.sourceMatch2!)!.round).toBe(m.round! - 1);
          for (const s of [m.sourceMatch1!, m.sourceMatch2!]) usedAsWinnerSource.set(s, (usedAsWinnerSource.get(s) || 0) + 1);
        }
        // 2라운드 이후는 미정 상태로 생성
        expect(m.status).toBe('pending');
        expect(m.player1Id).toBe('');
        expect(m.player2Id).toBe('');
      }
      // 결승 외 모든 본선 경기의 승자는 정확히 한 곳으로 간다
      for (const e of main) {
        expect(usedAsWinnerSource.get(e.key) || 0).toBe(e.match.roundLabel === '결승' ? 0 : 1);
      }

      // 3/4위전: 4강 두 경기의 패자
      const third = entries.filter(e => e.match.stageId === thirdPlaceStageId('stage_finals_1'));
      if (size >= 4) {
        expect(third).toHaveLength(1);
        const m = third[0].match;
        expect(m.sourceType).toBe('loser');
        expect(m.roundLabel).toBe('3/4위 결정전');
        const sf = main.filter(e => e.match.roundLabel === '4강').map(e => e.key);
        expect(sf).toHaveLength(2);
        expect([m.sourceMatch1, m.sourceMatch2]).toEqual(sf);
      } else {
        expect(third).toHaveLength(0);
      }
    });
  }

  it('3/4위전 설정이 꺼져 있으면 만들지 않는다', () => {
    expect(build(8, { thirdPlace: false }).some(e => e.match.sourceType === 'loser')).toBe(false);
  });

  it('참가자를 주면 BYE 경기는 실제 선수의 부전승 완료 경기가 되고 가짜 상대 ID를 만들지 않는다', () => {
    const entries = build(5, { entrants: entrants(5) });
    const r1 = entries.filter(e => e.match.round === 1);
    // 8강 크기: 실제 1경기(p1 vs p2), BYE 3경기(p3, p4, p5)
    expect(r1[0].match).toMatchObject({ player1Id: 'p1', player2Id: 'p2', status: 'pending' });
    const byes = r1.filter(e => e.match.isBye);
    expect(byes.map(e => e.match.player1Id)).toEqual(['p3', 'p4', 'p5']);
    for (const b of byes) {
      expect(b.match).toMatchObject({ status: 'completed', isBye: true, walkover: true, walkoverReason: 'bye', player2Id: '', player2Name: '부전승', sets: [] });
      expect(b.match.bye).toBeUndefined();
      expect(b.match.winnerId).toBe(b.match.player1Id);
    }
    // 같은 선수가 두 번 배치되지 않음 (자기 자신과의 대전 없음)
    const ids = r1.flatMap(e => [e.match.player1Id, e.match.player2Id]).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('BYE 경기는 대회 규칙의 부전승 점수(11:0)를 기록한다', () => {
    const entries = build(3, {
      entrants: entrants(3),
      byeSets: (side: 1 | 2, id: string) => [1, 2].map(() => ({ ...createEmptySet(), player1Score: side === 1 ? 11 : 0, player2Score: side === 2 ? 11 : 0, winnerId: id })),
    });
    const bye = entries.find(e => e.match.isBye)!;
    expect(bye.match.sets?.map(s => [s.player1Score, s.player2Score])).toEqual([[11, 0], [11, 0]]);
  });

  it('참가자 없이 만들면 1라운드는 모두 미정, BYE 경기는 실제 쪽이 배정될 때까지 pending', () => {
    const entries = build(6);
    const r1 = entries.filter(e => e.match.round === 1);
    expect(r1.every(e => e.match.player1Id === '')).toBe(true);
    expect(r1.filter(e => e.match.isBye).every(e => e.match.status === 'pending')).toBe(true);
  });

  it('팀전은 team 필드도 채운다', () => {
    const entries = build(4, { team: true, entrants: entrants(4) });
    expect(entries[0].match).toMatchObject({ type: 'team', team1Id: 'p1', team2Id: 'p2', team1Name: 'P1' });
    const final = entries.find(e => e.match.roundLabel === '결승')!;
    expect(final.match).toMatchObject({ team1Id: '', team2Id: '' });
  });

  it('bracketPosition과 round가 라운드 안에서 0부터 순서대로다', () => {
    const entries = build(16);
    for (let r = 1; r <= 4; r++) {
      const positions = entries.filter(e => e.match.round === r && e.match.stageId === 'stage_finals_1').map(e => e.match.bracketPosition);
      expect(positions).toEqual(positions.map((_, i) => i));
    }
  });
});

describe('hasUndecidedParticipant', () => {
  it('빈 슬롯이나 BYE가 있으면 true', () => {
    expect(hasUndecidedParticipant({ player1Id: '', player2Id: 'b' })).toBe(true);
    expect(hasUndecidedParticipant({ player1Id: 'a', player2Id: 'BYE' })).toBe(true);
    expect(hasUndecidedParticipant({})).toBe(true);
    expect(hasUndecidedParticipant({ team1Id: 'x', team2Id: '' })).toBe(true);
  });
  it('양쪽이 정해지면 false', () => {
    expect(hasUndecidedParticipant({ player1Id: 'a', player2Id: 'b' })).toBe(false);
    expect(hasUndecidedParticipant({ team1Id: 'x', team2Id: 'y' })).toBe(false);
  });
});

describe('buildSingleEliminationSkeleton 5~8위 결정전 (서버 finals-plan과 같은 구조)', () => {
  const quarterKeys = (entries: ReturnType<typeof build>) => entries.filter(e => e.match.roundLabel === '8강').map(e => e.key);
  const placements = (entries: ReturnType<typeof build>) => entries.filter(e => e.match.stageId === fifthToEighthStageId('stage_finals_1'));
  it('simple: 8강 패자 교차전 2경기', () => {
    const e = build(8, { fifthToEighth: 'simple' });
    const qf = quarterKeys(e);
    const p = placements(e);
    expect(p.map(x => [x.match.roundLabel, x.match.sourceMatch1, x.match.sourceMatch2, x.match.sourceType])).toEqual([
      ['5-8위 결정전', qf[0], qf[1], 'loser'],
      ['5-8위 결정전', qf[2], qf[3], 'loser'],
    ]);
    expect(p.every(x => x.match.bracketRound === undefined)).toBe(true);
    expect(fifthToEighthMatchCount('simple', 8)).toBe(p.length);
  });
  it('full: 교차전 + 5/6위전(승자) + 7/8위전(패자)', () => {
    const e = build(16, { fifthToEighth: 'full' });
    const p = placements(e);
    expect(p.map(x => x.match.roundLabel)).toEqual(['5-8위 결정전', '5-8위 결정전', '5/6위 결정전', '7/8위 결정전']);
    expect(p[2].match).toMatchObject({ sourceMatch1: p[0].key, sourceMatch2: p[1].key, sourceType: 'winner' });
    expect(p[3].match).toMatchObject({ sourceMatch1: p[0].key, sourceMatch2: p[1].key, sourceType: 'loser' });
    expect(fifthToEighthMatchCount('full', 16)).toBe(4);
  });
  it('round_robin: 8강 패자 4명 풀리그 6경기', () => {
    const p = placements(build(8, { fifthToEighth: 'round_robin' }));
    expect(p).toHaveLength(6);
    expect(p.every(x => x.match.sourceType === 'loser' && x.match.roundLabel === '5~8위 순위 결정전')).toBe(true);
  });
  it('8강이 없으면(4강 이하) 만들지 않고, none이면 만들지 않는다', () => {
    expect(placements(build(4, { fifthToEighth: 'full' }))).toHaveLength(0);
    expect(fifthToEighthMatchCount('full', 4)).toBe(0);
    expect(placements(build(8))).toHaveLength(0);
  });
});
