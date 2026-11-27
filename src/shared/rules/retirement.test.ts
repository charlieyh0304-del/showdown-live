import { describe, it, expect } from 'vitest';
import { buildRetirementSets, retirementMatchFlags } from './walkover';
import { aggregateStandings, normalizeResult, resultContextFor, type MatchLike } from './standings';
import { DEFAULT_COMPETITION_RULES, matchWinnerByRules, resolveCompetitionRules, type ScoringRuleSet } from './competitionRules';

const bo3: ScoringRuleSet = { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2 };
const bo5: ScoringRuleSet = { winScore: 11, setsToWin: 3, maxSets: 5, minLead: 2 };
const scores = (sets: { player1Score: number; player2Score: number }[]) => sets.map(s => `${s.player1Score}:${s.player2Score}`);

describe('buildRetirementSets (IBSA 경기 포기)', () => {
  it('IBSA example: 11:5, 7:2 then player 1 retires → 11:5, 7:11, 0:11', () => {
    const sets = buildRetirementSets(
      [{ player1Score: 11, player2Score: 5 }, { player1Score: 7, player2Score: 2 }],
      1, bo3, DEFAULT_COMPETITION_RULES, 'p2', 'p1',
    );
    expect(scores(sets)).toEqual(['11:5', '7:11', '0:11']);
    expect(sets.map(s => s.winnerId)).toEqual(['p1', 'p2', 'p2']);
    expect(matchWinnerByRules(sets, bo3)).toBe(2);
  });
  it('best of 5: the opponent needs three sets', () => {
    const sets = buildRetirementSets([{ player1Score: 11, player2Score: 5 }, { player1Score: 7, player2Score: 2 }], 1, bo5, DEFAULT_COMPETITION_RULES, 'p2', 'p1');
    expect(scores(sets)).toEqual(['11:5', '7:11', '0:11', '0:11']);
    expect(matchWinnerByRules(sets, bo5)).toBe(2);
  });
  it('best of 3: retiring in the first set', () => {
    const sets = buildRetirementSets([{ player1Score: 3, player2Score: 6 }], 2, bo3, DEFAULT_COMPETITION_RULES, 'p1');
    expect(scores(sets)).toEqual(['11:6', '11:0']);
    expect(matchWinnerByRules(sets, bo3)).toBe(1);
  });
  it('keeps the retiring side score and keeps a 2-point margin (10:9 → 10:12)', () => {
    const sets = buildRetirementSets([{ player1Score: 10, player2Score: 9 }], 1, bo3, DEFAULT_COMPETITION_RULES, 'p2');
    expect(scores(sets)).toEqual(['10:12', '0:11']);
  });
  it('between sets (no set in progress) the remaining sets are 0:11', () => {
    const sets = buildRetirementSets([{ player1Score: 11, player2Score: 4 }, { player1Score: 0, player2Score: 0 }], 1, bo3, DEFAULT_COMPETITION_RULES, 'p2');
    expect(scores(sets)).toEqual(['11:4', '0:11', '0:11']);
    expect(matchWinnerByRules(sets, bo3)).toBe(2);
  });
  it('ignores sets after the decisive one and keeps faults', () => {
    const sets = buildRetirementSets([{ player1Score: 5, player2Score: 1, player1Faults: 2 }, { player1Score: 4, player2Score: 4 }], 2, bo3, DEFAULT_COMPETITION_RULES, 'p1');
    expect(scores(sets)).toEqual(['11:1', '11:0']);
    expect(sets[0].player1Faults).toBe(2);
  });
  it('team 31-point one game', () => {
    const team: ScoringRuleSet = { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2 };
    expect(scores(buildRetirementSets([{ player1Score: 20, player2Score: 25 }], 2, team, DEFAULT_COMPETITION_RULES, 't1'))).toEqual(['31:25']);
  });
  it('as_recorded mode keeps the recorded scores as they are', () => {
    const rules = resolveCompetitionRules({ rules: { retirement: { mode: 'as_recorded' } } });
    const sets = buildRetirementSets([{ player1Score: 11, player2Score: 5 }, { player1Score: 7, player2Score: 2 }], 1, bo3, rules, 'p2', 'p1');
    expect(scores(sets)).toEqual(['11:5', '7:2']);
    expect(sets.map(s => s.winnerId)).toEqual(['p1', null]);
  });
  it('as_walkover mode voids earned points (규정 불이행 패처럼)', () => {
    const rules = resolveCompetitionRules({ rules: { retirement: { mode: 'as_walkover' } } });
    const sets = buildRetirementSets([{ player1Score: 11, player2Score: 5 }, { player1Score: 7, player2Score: 2 }], 1, bo3, rules, 'p2');
    expect(scores(sets)).toEqual(['0:11', '0:11']);
  });
});

describe('retired matches in standings (each retirement mode)', () => {
  // p1이 1세트를 이기고 2세트 7:2에서 기권 → 승자 p2
  const recorded = [{ player1Score: 11, player2Score: 5 }, { player1Score: 7, player2Score: 2 }];
  const retiredMatch = (rulesInput: Record<string, unknown>): { t: Record<string, unknown>; m: MatchLike } => {
    const t = { rules: rulesInput };
    const rules = resolveCompetitionRules(t);
    const sets = buildRetirementSets(recorded, 1, bo3, rules, 'p2', 'p1');
    const m: MatchLike = {
      status: 'completed', type: 'individual', player1Id: 'p1', player2Id: 'p2', player1Name: 'P1', player2Name: 'P2',
      winnerId: 'p2', sets, ...retirementMatchFlags(rules, '부상'),
    };
    return { t, m };
  };

  it('keep_played: a normal result with the points actually earned', () => {
    const { t, m } = retiredMatch({ retirement: { mode: 'keep_played' }, standingsPoints: { win: 2, walkoverWin: 5 } });
    expect(m.walkover).toBeNull();
    const ctx = resultContextFor(t);
    const r = normalizeResult(m, ctx)!;
    expect(r).toMatchObject({ winner: 'p2', walkover: null, setsA: 1, setsB: 2, ptsA: 18, ptsB: 27 });
    const rows = aggregateStandings([r], ctx.rules);
    expect(rows.get('p2')).toMatchObject({ wins: 1, walkoverWins: 0, points: 2 });
  });

  it('as_walkover: counted as a walkover (walkoverWin/forfeitLoss points and the countIn* options)', () => {
    const base = { retirement: { mode: 'as_walkover' }, standingsPoints: { win: 2, loss: 0, walkoverWin: 3, forfeitLoss: -1 } };
    const { t, m } = retiredMatch(base);
    expect(m).toMatchObject({ walkover: true, walkoverReason: '부상', retired: true, retiredReason: '부상' });
    const ctx = resultContextFor(t);
    const r = normalizeResult(m, ctx)!;
    expect(r).toMatchObject({ winner: 'p2', walkover: 'forfeit', ptsA: 0, ptsB: 22 });
    const rows = aggregateStandings([r], ctx.rules);
    expect(rows.get('p2')).toMatchObject({ walkoverWins: 1, points: 3 });
    expect(rows.get('p1')).toMatchObject({ walkoverLosses: 1, points: -1 });

    const excluded = retiredMatch({ ...base, walkover: { countInStandings: false, countInPlayerStats: false } });
    expect(normalizeResult(excluded.m, resultContextFor(excluded.t))).toBeNull();
    expect(normalizeResult(excluded.m, resultContextFor(excluded.t, 'stats'))).toBeNull();
    const statsOnly = retiredMatch({ ...base, walkover: { countInStandings: false, countInPlayerStats: true } });
    expect(normalizeResult(statsOnly.m, resultContextFor(statsOnly.t))).toBeNull();
    expect(normalizeResult(statsOnly.m, resultContextFor(statsOnly.t, 'stats'))).not.toBeNull();
  });

  it('as_recorded: the winner comes from winnerId even when the recorded sets give no winner', () => {
    const { t, m } = retiredMatch({ retirement: { mode: 'as_recorded' } });
    expect(m.walkover).toBeNull();
    expect(matchWinnerByRules(m.sets as { player1Score: number; player2Score: number }[], bo3)).toBeNull();
    const ctx = resultContextFor(t);
    const r = normalizeResult(m, ctx)!;
    expect(r).toMatchObject({ winner: 'p2', walkover: null, setsA: 1, setsB: 0, ptsA: 18, ptsB: 7 });
    expect(aggregateStandings([r], ctx.rules).get('p2')).toMatchObject({ wins: 1, points: 1 });
  });
});
