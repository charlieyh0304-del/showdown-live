import { describe, it, expect } from 'vitest';
import { resolveCompetitionRules, resolveMatchScoring } from './competitionRules';
import { buildWalkoverSets, buildByeSets, walkoverKind, isByeMatch } from './walkover';
import { aggregateStandings, normalizeResults, resultContextFor, type MatchLike } from './standings';

const D = resolveCompetitionRules(null);

describe('walkover score (부전승 11:0)', () => {
  it('best of 3 → two sets of 11:0', () => {
    const sets = buildWalkoverSets(resolveMatchScoring({ type: 'individual' }, {}), D.walkover, 1, 'a');
    expect(sets.map(s => [s.player1Score, s.player2Score])).toEqual([[11, 0], [11, 0]]);
    expect(sets.every(s => s.winnerId === 'a')).toBe(true);
  });
  it('best of 5 → three sets of 11:0 (player 2 wins)', () => {
    const scoring = resolveMatchScoring({ type: 'individual' }, { gameConfig: { winScore: 11, setsToWin: 3 } });
    expect(buildWalkoverSets(scoring, D.walkover, 2, 'b').map(s => [s.player1Score, s.player2Score])).toEqual([[0, 11], [0, 11], [0, 11]]);
  });
  it('team 31 points → 31:0', () => {
    expect(buildWalkoverSets(resolveMatchScoring({ type: 'team' }, {}), D.walkover, 1, 't1').map(s => s.player1Score)).toEqual([31]);
  });
  it('configured walkover set score', () => {
    const r = resolveCompetitionRules({ rules: { walkover: { setScore: 6 } } });
    expect(buildWalkoverSets(resolveMatchScoring({ type: 'individual' }, {}), r.walkover, 1, 'a').map(s => s.player1Score)).toEqual([6, 6]);
  });
  it('BYE gets walkover sets unless BYE is not a walkover', () => {
    const scoring = resolveMatchScoring({ type: 'individual' }, {});
    expect(buildByeSets(scoring, D, 1, 'a')).toHaveLength(2);
    expect(buildByeSets(scoring, resolveCompetitionRules({ rules: { walkover: { byeCountsAsWalkover: false } } }), 1, 'a')).toEqual([]);
    expect(buildByeSets(scoring, D, 1, null)).toEqual([]);
  });
  it('reads bye and isBye', () => {
    expect(isByeMatch({ bye: true })).toBe(true);
    expect(isByeMatch({ isBye: true })).toBe(true);
    expect(walkoverKind({ walkover: true })).toBe('forfeit');
    expect(walkoverKind({ isBye: true, walkover: true })).toBe('bye');
    expect(walkoverKind({})).toBeNull();
  });
});

const done = (a: string, b: string, sets: Array<[number, number]>, extra: Partial<MatchLike> = {}): MatchLike => ({
  status: 'completed', type: 'individual', player1Id: a, player2Id: b, player1Name: a.toUpperCase(), player2Name: b.toUpperCase(),
  sets: sets.map(([p1, p2]) => ({ player1Score: p1, player2Score: p2 })), ...extra,
});

describe('standings with walkovers', () => {
  const forfeit = done('a', 'b', [[11, 0], [11, 0]], { walkover: true, walkoverReason: '불참', winnerId: 'a' });
  const bye = done('c', '', [[11, 0], [11, 0]], { isBye: true, walkoverReason: 'bye', winnerId: 'c', player2Name: '부전승' });
  const byeVsBye: MatchLike = { status: 'completed', isBye: true, player1Id: '', player2Id: 'BYE', winnerId: null, sets: [] };
  const normal = done('a', 'c', [[11, 7], [9, 11], [12, 10]], { winnerId: 'a' });

  it('counts walkovers like normal wins with 11:0 scores by default', () => {
    const t = {};
    const ctx = resultContextFor(t);
    const rows = aggregateStandings(normalizeResults([forfeit, bye, byeVsBye, normal], ctx), ctx.rules);
    expect(rows.get('a')).toMatchObject({ played: 2, wins: 2, walkoverWins: 1, setsWon: 4, setsLost: 1, pointsFor: 54, points: 2 });
    expect(rows.get('b')).toMatchObject({ played: 1, losses: 1, walkoverLosses: 1, pointsAgainst: 22 });
    expect(rows.get('c')).toMatchObject({ played: 2, wins: 1, losses: 1, walkoverWins: 1 });
    expect(rows.has('')).toBe(false);
    expect(rows.has('BYE')).toBe(false);
  });
  it('countWalkoverInStandings=false excludes them', () => {
    const t = { rules: { walkover: { countInStandings: false } } };
    const ctx = resultContextFor(t);
    const rows = aggregateStandings(normalizeResults([forfeit, bye, normal], ctx), ctx.rules);
    expect(rows.get('a')).toMatchObject({ played: 1, wins: 1 });
    expect(rows.has('b')).toBe(false);
    // 통계는 따로 켜고 끈다
    const sctx = resultContextFor(t, 'stats');
    expect(aggregateStandings(normalizeResults([forfeit], sctx), sctx.rules).get('a')?.played).toBe(1);
  });
  it('byeCountsAsWalkover=false excludes BYEs only', () => {
    const ctx = resultContextFor({ rules: { walkover: { byeCountsAsWalkover: false } } });
    const rows = aggregateStandings(normalizeResults([forfeit, bye], ctx), ctx.rules);
    expect(rows.has('c')).toBe(false);
    expect(rows.get('a')?.played).toBe(1);
  });
  it('walkover set score below the set target still counts as setsToWin sets won', () => {
    const t = { rules: { walkover: { setScore: 6 } } };
    const ctx = resultContextFor(t);
    const sets = buildWalkoverSets(resolveMatchScoring({ type: 'individual' }, t), ctx.rules.walkover, 1, 'a');
    const m = done('a', 'b', sets.map(s => [s.player1Score, s.player2Score] as [number, number]), { walkover: true, walkoverReason: '불참', winnerId: 'a' });
    const rows = aggregateStandings(normalizeResults([m], ctx), ctx.rules);
    expect(rows.get('a')).toMatchObject({ wins: 1, setsWon: 2, setsLost: 0, pointsFor: 12 });
    expect(rows.get('b')).toMatchObject({ losses: 1, setsWon: 0, setsLost: 2 });
    expect(rows.get('a')!.setsWon - rows.get('a')!.setsLost).toBe(2);
  });
  it('custom standings points (walkover win / forfeit loss)', () => {
    const ctx = resultContextFor({ rules: { standingsPoints: { win: 3, loss: 1, walkoverWin: 2, forfeitLoss: -1 } } });
    const rows = aggregateStandings(normalizeResults([forfeit, normal], ctx), ctx.rules);
    expect(rows.get('a')?.points).toBe(5);
    expect(rows.get('b')?.points).toBe(-1);
    expect(rows.get('c')?.points).toBe(1);
  });
  it('set winner uses the match rules (team 31, no 0:0 set awarded)', () => {
    const team = { status: 'completed', type: 'team', team1Id: 't1', team2Id: 't2', winnerId: 't2', sets: [{ player1Score: 29, player2Score: 31 }] };
    const zero = done('x', 'y', [[11, 3], [11, 4], [0, 0]], { winnerId: 'x' });
    const ctx = resultContextFor({});
    const rows = aggregateStandings(normalizeResults([team, zero], ctx), ctx.rules);
    expect(rows.get('t2')).toMatchObject({ wins: 1, setsWon: 1 });
    expect(rows.get('y')).toMatchObject({ setsWon: 0, setsLost: 2 });
  });
});
