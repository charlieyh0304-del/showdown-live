import { describe, it, expect } from 'vitest';
import { computeFinalPlacements, knockoutParticipants, pairPlacementRange } from './finalRanking';
import { resultContextFor, type MatchLike } from './standings';

const ko = (label: string, a: string, b: string, winner: string | null, extra: Partial<MatchLike> = {}): MatchLike => ({
  status: winner ? 'completed' : 'pending', type: 'individual', stageId: 'fin', roundLabel: label, bracketRound: label,
  player1Id: a, player2Id: b, player1Name: a.toUpperCase(), player2Name: b.toUpperCase(), winnerId: winner,
  sets: winner ? (winner === a ? [{ player1Score: 11, player2Score: 3 }, { player1Score: 11, player2Score: 3 }] : [{ player1Score: 3, player2Score: 11 }, { player1Score: 3, player2Score: 11 }]) : [],
  ...extra,
});

// 8강: a>h, d>e, b>g, c>f / 4강: a>d, b>c / 결승: b>a / 3/4위: c>d
// 총 승수로는 a(2승) = b(2승)지만 우승은 b다 (B4 회귀).
const bracket = (thirdWinner: string | null = 'c'): MatchLike[] => [
  ko('8강', 'a', 'h', 'a'), ko('8강', 'd', 'e', 'd'), ko('8강', 'b', 'g', 'b'), ko('8강', 'c', 'f', 'c'),
  ko('4강', 'a', 'd', 'a'), ko('4강', 'b', 'c', 'b'),
  ko('결승', 'a', 'b', 'b'),
  ko('3/4위 결정전', 'd', 'c', thirdWinner, { stageId: 'fin_3rd', bracketRound: undefined }),
];
const placeOf = (p: ReturnType<typeof computeFinalPlacements>) => Object.fromEntries(p.map(x => [x.id, x.place]));

describe('computeFinalPlacements', () => {
  it('labels', () => {
    expect(knockoutParticipants('결승')).toBe(2);
    expect(knockoutParticipants('16강')).toBe(16);
    expect(knockoutParticipants('3/4위 결정전')).toBe(0);
    expect(pairPlacementRange('5/6위 결정전')).toEqual([5, 6]);
  });
  it('champion is the final winner, not the most wins; 3rd/4th from the third-place match', () => {
    const p = computeFinalPlacements({ matches: bracket(), ctx: resultContextFor({}) });
    expect(placeOf(p)).toMatchObject({ b: 1, a: 2, c: 3, d: 4 });
    expect(p.find(x => x.id === 'e')).toMatchObject({ place: 5, joint: true, basis: 'round' });
    expect(p.filter(x => x.place === 5)).toHaveLength(4);
  });
  it('third-place match pending → 3rd/4th undecided', () => {
    const p = computeFinalPlacements({ matches: bracket(null), ctx: resultContextFor({}) });
    expect(p.some(x => x.id === 'c' || x.id === 'd')).toBe(false);
  });
  it('joint 3rd policy ignores the match', () => {
    const t = { rules: { finalRanking: { thirdPlace: 'joint' } } };
    const p = computeFinalPlacements({ matches: bracket(), ctx: resultContextFor(t) });
    expect(p.filter(x => x.place === 3).map(x => x.id).sort()).toEqual(['c', 'd']);
    expect(p.find(x => x.id === 'c')?.joint).toBe(true);
  });
  it('no third-place match → joint 3rd', () => {
    const p = computeFinalPlacements({ matches: bracket().slice(0, 7), ctx: resultContextFor({}) });
    expect(p.filter(x => x.place === 3)).toHaveLength(2);
  });
  it('5-8 by qualifying record', () => {
    const t = { rules: { finalRanking: { fifthToEighth: 'qualifying_record' } } };
    const p = computeFinalPlacements({ matches: bracket(), ctx: resultContextFor(t), qualifyingOrder: ['a', 'b', 'f', 'g', 'e', 'h'] });
    expect(placeOf(p)).toMatchObject({ f: 5, g: 6, e: 7, h: 8 });
  });
  it('5-8 by placement matches when present', () => {
    const extra = [
      ko('5-8위 결정전', 'e', 'h', 'e', { stageId: 'fin_class_5to8' }), ko('5-8위 결정전', 'f', 'g', 'g', { stageId: 'fin_class_5to8' }),
      ko('5/6위 결정전', 'e', 'g', 'g', { stageId: 'fin_class_5to8' }),
      ko('7/8위 결정전', 'h', 'f', null, { stageId: 'fin_class_5to8' }),
    ];
    const p = computeFinalPlacements({ matches: [...bracket(), ...extra], ctx: resultContextFor({}) });
    expect(placeOf(p)).toMatchObject({ g: 5, e: 6 });
    expect(p.some(x => x.id === 'h' || x.id === 'f')).toBe(false); // 7/8위전 진행 전
  });
  it('final not played → no champion yet', () => {
    const ms = bracket().map(m => (m.roundLabel === '결승' ? { ...m, status: 'pending', winnerId: null } : m));
    const p = computeFinalPlacements({ matches: ms, ctx: resultContextFor({}) });
    expect(p.some(x => x.place === 1 || x.place === 2)).toBe(false);
  });
  it('BYE in round 1 gives no loser', () => {
    const ms: MatchLike[] = [
      ko('4강', 'a', '', 'a', { isBye: true }), ko('4강', 'b', 'c', 'b'), ko('결승', 'a', 'b', 'a'),
    ];
    const p = computeFinalPlacements({ matches: ms, ctx: resultContextFor({}) });
    expect(placeOf(p)).toEqual({ a: 1, b: 2, c: 3 });
  });
  it('league without bracket ranks by standings + tiebreak, and rankingUpTo caps', () => {
    const lg = (a: string, b: string, w: string): MatchLike => ({ ...ko('', a, b, w), roundLabel: undefined, bracketRound: undefined, stageId: undefined });
    const ms = [lg('a', 'b', 'a'), lg('a', 'c', 'a'), lg('b', 'c', 'b')];
    expect(placeOf(computeFinalPlacements({ matches: ms, ctx: resultContextFor({}) }))).toEqual({ a: 1, b: 2, c: 3 });
    expect(computeFinalPlacements({ matches: ms, ctx: resultContextFor({ rules: { finalRanking: { rankingUpTo: 2 } } }) })).toHaveLength(2);
  });
  it('walkover final still decides champion even when walkovers are excluded from standings', () => {
    const ms = [ko('결승', 'a', 'b', 'a', { walkover: true })];
    const p = computeFinalPlacements({ matches: ms, ctx: resultContextFor({ rules: { walkover: { countInStandings: false } } }) });
    expect(placeOf(p)).toEqual({ a: 1, b: 2 });
  });
});

describe('5-8 placement formats (M0g)', () => {
  const p58 = (label: string, a: string, b: string, winner: string) => ko(label, a, b, winner, { stageId: 'fin_5to8', bracketRound: undefined });
  it('simple: cross matches only → winners joint 5th, losers joint 7th', () => {
    const ms = [...bracket(), p58('5-8위 결정전', 'h', 'e', 'h'), p58('5-8위 결정전', 'g', 'f', 'f')];
    const places = placeOf(computeFinalPlacements({ matches: ms, ctx: resultContextFor({}) }));
    expect([places.h, places.f, places.e, places.g]).toEqual([5, 5, 7, 7]);
  });
  it('full: 5/6 and 7/8 matches decide the order', () => {
    const ms = [...bracket(), p58('5-8위 결정전', 'h', 'e', 'h'), p58('5-8위 결정전', 'g', 'f', 'f'), p58('5/6위 결정전', 'h', 'f', 'f'), p58('7/8위 결정전', 'e', 'g', 'g')];
    const places = placeOf(computeFinalPlacements({ matches: ms, ctx: resultContextFor({}) }));
    expect([places.f, places.h, places.g, places.e]).toEqual([5, 6, 7, 8]);
  });
});
