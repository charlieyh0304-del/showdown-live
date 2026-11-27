import { describe, it, expect } from 'vitest';
import {
  resolveCompetitionRules,
  resolveMatchScoring,
  DEFAULT_COMPETITION_RULES,
  setWinnerByRules,
  matchWinnerByRules,
  tiebreakDecisionKey,
  criteriaFromLegacy,
} from './competitionRules';

describe('resolveMatchScoring precedence', () => {
  const tour = {
    type: 'individual',
    gameConfig: { winScore: 15, setsToWin: 3 },
    stages: [{ id: 's1', scoringRules: { winScore: 21, setsToWin: 2, maxSets: 3, minLead: 2 } }],
  };
  it('defaults to 11 points, best of 3', () => {
    expect(resolveMatchScoring({ type: 'individual' }, {})).toEqual({ winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2 });
  });
  it('team defaults to 31 points, 1 game', () => {
    expect(resolveMatchScoring({ type: 'team' }, {})).toMatchObject({ winScore: 31, setsToWin: 1 });
    expect(resolveMatchScoring({ type: 'randomTeamLeague' }, {})).toMatchObject({ winScore: 31 });
  });
  it('gameConfig applies to individual matches only', () => {
    expect(resolveMatchScoring({ type: 'individual' }, tour)).toMatchObject({ winScore: 15, setsToWin: 3, maxSets: 5 });
    expect(resolveMatchScoring({ type: 'team' }, tour)).toMatchObject({ winScore: 31 });
  });
  it('teamMatchSettings applies to team matches', () => {
    expect(resolveMatchScoring({ type: 'team' }, { teamMatchSettings: { winScore: 21, setsToWin: 1, minLead: 2 } })).toMatchObject({ winScore: 21 });
  });
  it('tournament.scoringRules beats gameConfig and team default', () => {
    const t = { ...tour, scoringRules: { winScore: 7, setsToWin: 1, maxSets: 1, minLead: 1 } };
    expect(resolveMatchScoring({ type: 'individual' }, t).winScore).toBe(7);
    expect(resolveMatchScoring({ type: 'team' }, t).winScore).toBe(7);
  });
  it('tournament.rules.scoring beats legacy tournament fields', () => {
    const t = { ...tour, scoringRules: { winScore: 7, setsToWin: 1 }, rules: { scoring: { individual: { winScore: 9 } } } };
    expect(resolveMatchScoring({ type: 'individual' }, t)).toMatchObject({ winScore: 9, setsToWin: 1 });
  });
  it('stage beats tournament, stage.rules beats stage.scoringRules', () => {
    expect(resolveMatchScoring({ type: 'individual', stageId: 's1' }, tour).winScore).toBe(21);
    const t = { ...tour, stages: [{ id: 's1', scoringRules: { winScore: 21, setsToWin: 2 }, rules: { scoring: { individual: { setsToWin: 3 } } } }] };
    expect(resolveMatchScoring({ type: 'individual', stageId: 's1' }, t)).toMatchObject({ winScore: 21, setsToWin: 3, maxSets: 5 });
  });
  it('sub-stage ids (third place) inherit the parent stage', () => {
    expect(resolveMatchScoring({ type: 'individual', stageId: 's1_3rd' }, tour).winScore).toBe(21);
  });
  it('match.appliedScoringRules wins over everything', () => {
    expect(resolveMatchScoring({ type: 'individual', stageId: 's1', appliedScoringRules: { winScore: 11, setsToWin: 3, minLead: 2 } }, tour).setsToWin).toBe(3);
  });
  it('Firebase object-shaped stages are read', () => {
    const t = { stages: { 0: { id: 's1', scoringRules: { winScore: 21, setsToWin: 1 } } } };
    expect(resolveMatchScoring({ type: 'individual', stageId: 's1' }, t).winScore).toBe(21);
  });
});

describe('resolveCompetitionRules', () => {
  it('returns defaults', () => {
    expect(resolveCompetitionRules(null)).toEqual(DEFAULT_COMPETITION_RULES);
    expect(DEFAULT_COMPETITION_RULES.walkover).toEqual({ setScore: null, byeCountsAsWalkover: true, countInStandings: true, countInPlayerStats: true });
    expect(DEFAULT_COMPETITION_RULES.tiebreak.criteria).toEqual(['points', 'head_to_head', 'set_difference', 'point_difference', 'points_scored']);
  });
  it('applies the simple preset', () => {
    const r = resolveCompetitionRules({ rules: { presetId: 'simple' } });
    expect(r.presetId).toBe('simple');
    expect(r.tiebreak.criteria).toEqual(['points', 'set_difference', 'point_difference']);
    expect(r.tiebreak.headToHeadMode).toBe('single_pass');
    expect(r.finalRanking.thirdPlace).toBe('joint');
  });
  it('custom tournament rules override preset, stage rules override tournament', () => {
    const t = {
      rules: { presetId: 'simple', tiebreak: { criteria: ['points', 'lot'], lotSeed: 'x' }, walkover: { countInStandings: false } },
      stages: [{ id: 'g', rules: { standingsPoints: { win: 3 }, walkover: { setScore: 5 } } }],
    };
    const r = resolveCompetitionRules(t);
    expect(r.tiebreak.criteria).toEqual(['points', 'lot']);
    expect(r.tiebreak.lotSeed).toBe('x');
    expect(r.walkover.countInStandings).toBe(false);
    expect(r.standingsPoints.win).toBe(1);
    const s = resolveCompetitionRules(t, 'g');
    expect(s.standingsPoints.win).toBe(3);
    expect(s.walkover.setScore).toBe(5);
    expect(s.walkover.countInStandings).toBe(false);
  });
  it('maps legacy fields (rankingMatchConfig, finalsConfig, tiebreakerRules)', () => {
    const r = resolveCompetitionRules({
      rankingMatchConfig: { thirdPlace: false, rankingUpTo: 8 },
      finalsConfig: { advancePerGroup: 3, wildcardCount: 2, avoidSameGroup: false },
      tiebreakerRules: ['set_difference', 'points_for'],
    });
    expect(r.finalRanking).toMatchObject({ thirdPlace: 'joint', rankingUpTo: 8 });
    expect(r.qualification).toEqual({ perGroup: 3, wildcards: 2, avoidSameGroupFirstRound: false });
    expect(r.tiebreak.criteria).toEqual(['points', 'set_difference', 'points_scored']);
    expect(criteriaFromLegacy([])).toBeNull();
  });
  it('ignores invalid values', () => {
    const r = resolveCompetitionRules({ rules: { tiebreak: { criteria: ['bogus'], unresolved: 'coin' }, qualification: { perGroup: -1 } } });
    expect(r.tiebreak.criteria).toEqual(DEFAULT_COMPETITION_RULES.tiebreak.criteria);
    expect(r.tiebreak.unresolved).toBe('admin_decision');
    expect(r.qualification.perGroup).toBe(2);
  });
  it('reads recorded tiebreak decisions', () => {
    const key = tiebreakDecisionKey('A', ['b', 'a']);
    expect(key).toBe('A__a_b');
    const r = resolveCompetitionRules({ rules: { tiebreakDecisions: { [key]: { ids: { 0: 'b', 1: 'a' }, scope: 'A' } } } });
    expect(r.tiebreakDecisions[key]).toEqual({ ids: ['b', 'a'], scope: 'A' });
  });
});

describe('set/match winner by rules', () => {
  it('uses target and win-by', () => {
    const r = { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2 };
    expect(setWinnerByRules(11, 9, r)).toBe(1);
    expect(setWinnerByRules(11, 10, r)).toBeNull();
    expect(setWinnerByRules(0, 0, r)).toBeNull();
    expect(setWinnerByRules(31, 29, { ...r, winScore: 31 })).toBe(1);
    expect(setWinnerByRules(11, 10, { ...r, minLead: 1 })).toBe(1);
    expect(setWinnerByRules(15, 14, { ...r, deuceCap: 15 })).toBe(1);
  });
  it('team 31 match winner', () => {
    expect(matchWinnerByRules([{ player1Score: 29, player2Score: 31 }], { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2 })).toBe(2);
    expect(matchWinnerByRules([{ player1Score: 11, player2Score: 5 }], { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2 })).toBeNull();
  });
});
