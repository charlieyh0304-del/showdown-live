import { describe, it, expect } from 'vitest';
import {
  resolveCompetitionRules,
  resolveMatchScoring,
  DEFAULT_COMPETITION_RULES,
  setWinnerByRules,
  matchWinnerByRules,
  tiebreakDecisionKey,
  criteriaFromLegacy,
  matchRoundSize,
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

describe('minRestMinutes (M0b)', () => {
  it('defaults to 30 minutes (end of previous match to start of next)', () => {
    expect(resolveCompetitionRules(null).schedule.minRestMinutes).toBe(30);
  });
  it('tournament and stage overrides', () => {
    const t = { rules: { schedule: { minRestMinutes: 20 } }, stages: [{ id: 'f', rules: { schedule: { minRestMinutes: 5 } } }] };
    expect(resolveCompetitionRules(t).schedule.minRestMinutes).toBe(20);
    expect(resolveCompetitionRules(t, 'f').schedule.minRestMinutes).toBe(5);
    expect(resolveCompetitionRules(t, 'other').schedule.minRestMinutes).toBe(20);
  });
  it('accepts 0, ignores negative or non-numbers', () => {
    expect(resolveCompetitionRules({ rules: { schedule: { minRestMinutes: 0 } } }).schedule.minRestMinutes).toBe(0);
    expect(resolveCompetitionRules({ rules: { schedule: { minRestMinutes: -5 } } }).schedule.minRestMinutes).toBe(30);
    expect(resolveCompetitionRules({ rules: { schedule: { minRestMinutes: '10' } } }).schedule.minRestMinutes).toBe(30);
  });
});

describe('retirement rules (M0b)', () => {
  it('defaults to IBSA "giving up": keep earned points', () => {
    expect(resolveCompetitionRules(null).retirement.mode).toBe('keep_played');
  });
  it('can be set per tournament / stage', () => {
    const t = { rules: { retirement: { mode: 'as_walkover' } }, stages: [{ id: 'g', rules: { retirement: { mode: 'keep_played' } } }] };
    expect(resolveCompetitionRules(t).retirement.mode).toBe('as_walkover');
    expect(resolveCompetitionRules(t, 'g').retirement.mode).toBe('keep_played');
    expect(resolveCompetitionRules({ rules: { retirement: { mode: 'bogus' } } }).retirement.mode).toBe('keep_played');
  });
});

describe('custom preset (M0b)', () => {
  it('"start from blank" preset keeps defaults but records the choice', () => {
    const r = resolveCompetitionRules({ rules: { presetId: 'custom' } });
    expect(r.presetId).toBe('custom');
    expect(r.tiebreak).toEqual(DEFAULT_COMPETITION_RULES.tiebreak);
  });
});

describe('round scoring override (M0b, B15: wizard round override was ignored by real scoring)', () => {
  const finalsStage = { id: 'fin', type: 'finals' };
  it('legacy finalsConfig.roundScoringOverride applies from the given round (semis best-of-5)', () => {
    const t = {
      type: 'individual',
      stages: [finalsStage],
      finalsConfig: { roundScoringOverride: { fromRound: 4, scoringRules: { winScore: 11, setsToWin: 3, maxSets: 5, minLead: 2 } } },
    };
    expect(resolveMatchScoring({ type: 'individual', stageId: 'fin', roundLabel: '8강', bracketRound: '8강' }, t)).toMatchObject({ setsToWin: 2, maxSets: 3 });
    expect(resolveMatchScoring({ type: 'individual', stageId: 'fin', roundLabel: '4강', bracketRound: '4강' }, t)).toMatchObject({ setsToWin: 3, maxSets: 5, winScore: 11 });
    expect(resolveMatchScoring({ type: 'individual', stageId: 'fin', roundLabel: '결승' }, t)).toMatchObject({ setsToWin: 3 });
    expect(resolveMatchScoring({ type: 'individual', stageId: 'fin_3rd', roundLabel: '3/4위 결정전', bracketRound: '3/4위' }, t)).toMatchObject({ setsToWin: 3 });
    // 조별 리그 경기(라운드 이름 없음)에는 적용하지 않는다
    expect(resolveMatchScoring({ type: 'individual', stageId: 'q' }, t)).toMatchObject({ setsToWin: 2 });
    // 5/6위 결정전은 토너먼트 라운드가 아니다
    expect(resolveMatchScoring({ type: 'individual', stageId: 'fin', roundLabel: '5/6위 결정전' }, t)).toMatchObject({ setsToWin: 2 });
  });
  it('rules.roundScoring beats legacy and stage can switch it off with fromRound 0', () => {
    const t = {
      stages: [{ id: 'fin', rules: { roundScoring: { fromRound: 0 } } }, { id: 'fin2' }],
      finalsConfig: { roundScoringOverride: { fromRound: 4, scoringRules: { setsToWin: 3, winScore: 11 } } },
      rules: { roundScoring: { fromRound: 2, individual: { setsToWin: 4 } } },
    };
    expect(resolveMatchScoring({ type: 'individual', stageId: 'fin2', roundLabel: '4강' }, t).setsToWin).toBe(2);
    expect(resolveMatchScoring({ type: 'individual', stageId: 'fin2', roundLabel: '결승' }, t)).toMatchObject({ setsToWin: 4, maxSets: 7 });
    expect(resolveMatchScoring({ type: 'individual', stageId: 'fin', roundLabel: '결승' }, t).setsToWin).toBe(2);
  });
  it('appliedScoringRules still wins; invalid fromRound ignored', () => {
    const t = { rules: { roundScoring: { fromRound: 3, individual: { setsToWin: 3 } } } };
    expect(resolveCompetitionRules(t).roundScoring).toBeNull();
    const t2 = { rules: { roundScoring: { fromRound: 4, individual: { setsToWin: 3 } } } };
    expect(resolveMatchScoring({ type: 'individual', roundLabel: '4강', appliedScoringRules: { winScore: 11, setsToWin: 1 } }, t2).setsToWin).toBe(1);
  });
  it('matchRoundSize', () => {
    expect(matchRoundSize({ roundLabel: '16강' })).toBe(16);
    expect(matchRoundSize({ bracketRound: '결승' })).toBe(2);
    expect(matchRoundSize({ roundLabel: '9~16위 순위 결정전' })).toBeNull();
    expect(matchRoundSize({})).toBeNull();
  });
});

describe('M0g resolver fields', () => {
  it('a stage clears tournament time limit / deuce cap with 0 or null (legacy stage.scoringRules too)', () => {
    const t = {
      scoringRules: { winScore: 11, setsToWin: 2, timeLimitSeconds: 600, deuceCap: 15 },
      stages: [
        { id: 'a', scoringRules: { winScore: 11, setsToWin: 2, timeLimitSeconds: 0, deuceCap: 0 } },
        { id: 'b', rules: { scoring: { individual: { timeLimitSeconds: null, deuceCap: null } } } },
      ],
    };
    expect(resolveMatchScoring({ type: 'individual' }, t)).toMatchObject({ timeLimitSeconds: 600, deuceCap: 15 });
    for (const stageId of ['a', 'b']) {
      const r = resolveMatchScoring({ type: 'individual', stageId }, t);
      expect(r.timeLimitSeconds).toBeUndefined();
      expect(r.deuceCap).toBeUndefined();
    }
  });
  it('deuceEnabled: false means no win-by-2 (minLead 1) unless minLead is given', () => {
    expect(resolveMatchScoring({ type: 'individual' }, { scoringRules: { winScore: 11, setsToWin: 2, deuceEnabled: false } }).minLead).toBe(1);
    expect(resolveMatchScoring({ type: 'individual' }, { scoringRules: { winScore: 11, setsToWin: 2, minLead: 2, deuceEnabled: false } }).minLead).toBe(2);
    expect(setWinnerByRules(11, 10, resolveMatchScoring({ type: 'individual' }, { scoringRules: { winScore: 11, setsToWin: 2, deuceEnabled: false } }))).toBe(1);
  });
  it('serve / side change / players on court / rotation fields resolve per kind; legacy teamRules.teamSize maps to playersOnCourt', () => {
    const t = { type: 'team', teamRules: { teamSize: 2 }, rules: { scoring: { team: { winScore: 21, servesPerTurn: 2, sideChangeAt: 10, serveRotation: ['a1', 'b1', 'A2', 'B2', 'x9'] } } } };
    expect(resolveMatchScoring({ type: 'team' }, t)).toMatchObject({ winScore: 21, servesPerTurn: 2, sideChangeAt: 10, playersOnCourt: 2, serveRotation: ['A1', 'B1', 'A2', 'B2'] });
    const t2 = { ...t, stages: [{ id: 's', rules: { scoring: { team: { servesPerTurn: 0, serveRotation: '' } } } }] };
    const r = resolveMatchScoring({ type: 'team', stageId: 's' }, t2);
    expect(r.servesPerTurn).toBeUndefined();
    expect(r.serveRotation).toBeUndefined();
  });
  it('placement scoring applies to placement matches (not the third-place match); legacy rankingSetsToWin maps', () => {
    const t = { rankingMatchConfig: { rankingSetsToWin: 1 }, stages: [{ id: 'f', type: 'finals' }] };
    expect(resolveMatchScoring({ type: 'individual', stageId: 'f_5to8', roundLabel: '5/6위 결정전' }, t).setsToWin).toBe(1);
    expect(resolveMatchScoring({ type: 'individual', stageId: 'f_class_0', roundLabel: '9~12위 순위 결정전' }, t).setsToWin).toBe(1);
    expect(resolveMatchScoring({ type: 'individual', stageId: 'f_3rd', roundLabel: '3/4위 결정전' }, t).setsToWin).toBe(2);
    expect(resolveMatchScoring({ type: 'individual', stageId: 'f', roundLabel: '8강' }, t).setsToWin).toBe(2);
  });
  it('finalRanking placement generation fields: defaults and legacy rankingMatchConfig mapping', () => {
    expect(DEFAULT_COMPETITION_RULES.finalRanking).toMatchObject({ fifthToEighthMatches: 'none', classificationGroups: false, classificationGroupSize: 4 });
    const r = resolveCompetitionRules({ rankingMatchConfig: { fifthToEighth: true, fifthToEighthFormat: 'round_robin', classificationGroups: true, classificationGroupSize: 8, rankingUpTo: 12 } });
    expect(r.finalRanking).toMatchObject({ fifthToEighthMatches: 'round_robin', classificationGroups: true, classificationGroupSize: 8, rankingUpTo: 12, placementMatches: true });
    expect(resolveCompetitionRules({ rankingMatchConfig: { fifthToEighth: true }, rules: { finalRanking: { fifthToEighthMatches: 'none' } } }).finalRanking.fifthToEighthMatches).toBe('none');
  });
  it('criteriaFromLegacy accepts rule criterion names and keeps points first once', () => {
    expect(criteriaFromLegacy(['points', 'wins', 'points_for', 'lot', 'bogus'])).toEqual(['points', 'wins', 'points_scored', 'lot']);
  });
});
