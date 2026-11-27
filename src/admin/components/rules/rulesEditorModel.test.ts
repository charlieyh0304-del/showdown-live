import { describe, it, expect } from 'vitest';
import {
  TOURNAMENT_SCOPE,
  applyPreset,
  addCriterion,
  availableCriteria,
  buildRulesWritePayload,
  deletePath,
  displayValue,
  draftFromTournament,
  effectiveRules,
  emptyDraft,
  fieldUsedAtStage,
  isDraftDirty,
  mergeDrafts,
  moveItem,
  savedChangedSince,
  overriddenPaths,
  removeItem,
  resetStagePaths,
  rulesChangeImpact,
  setFieldValue,
  setFieldValues,
  setPath,
  validateDraft,
  withDraft,
} from './rulesEditorModel';
import { resolveCompetitionRules, resolveMatchScoring } from '@shared/rules/competitionRules';

const base = {
  type: 'individual',
  stages: [
    { id: 'q', type: 'qualifying', scoringRules: { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2 } },
    { id: 'f', type: 'finals' },
  ],
  rules: { presetId: 'ibsa', tiebreakDecisions: { k: { ids: ['a', 'b'] } } },
};

describe('reorder helpers', () => {
  it('moveItem moves up/down and ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
  it('add/remove criteria without duplicates', () => {
    expect(addCriterion(['points'], 'points')).toEqual(['points']);
    expect(addCriterion(['points'], 'lot')).toEqual(['points', 'lot']);
    expect(removeItem(['points', 'lot'], 0)).toEqual(['lot']);
    expect(availableCriteria(['points', 'head_to_head'])).not.toContain('points');
  });
});

describe('path helpers', () => {
  it('setPath / deletePath are immutable and prune empty objects', () => {
    const a = {};
    const b = setPath(a, 'x.y.z', 1);
    expect(a).toEqual({});
    expect(b).toEqual({ x: { y: { z: 1 } } });
    expect(deletePath(b, 'x.y.z')).toEqual({});
    expect(deletePath({ x: { y: 1, z: 2 } }, 'x.y')).toEqual({ x: { z: 2 } });
  });
});

describe('draft <-> tournament', () => {
  it('draftFromTournament leaves tie decisions out; withDraft keeps them', () => {
    const d = draftFromTournament(base);
    expect(d.tournament).toEqual({ presetId: 'ibsa' });
    const t = withDraft(base, setFieldValue(d, TOURNAMENT_SCOPE, 'standingsPoints.win', 2));
    expect((t.rules as Record<string, unknown>).tiebreakDecisions).toEqual(base.rules.tiebreakDecisions);
    expect(resolveCompetitionRules(t).standingsPoints.win).toBe(2);
  });
  it('display value shows the raw (even invalid) input, else the effective value', () => {
    let d = draftFromTournament(base);
    expect(displayValue(base, d, TOURNAMENT_SCOPE, 'scoring.individual.winScore')).toBe(11);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'scoring.individual.winScore', Number.NaN);
    expect(displayValue(base, d, TOURNAMENT_SCOPE, 'scoring.individual.winScore')).toBeNaN();
  });
  it('null values are stored as Firebase-safe markers', () => {
    let d = setFieldValue(emptyDraft(), 'f', 'walkover.setScore', null);
    expect(d.stages.f).toEqual({ walkover: { setScore: 0 } });
    d = setFieldValue(d, 'f', 'roundScoring', null);
    expect(d.stages.f.roundScoring).toEqual({ fromRound: 0 });
    const t = { ...base, rules: { walkover: { setScore: 5 }, roundScoring: { fromRound: 4, individual: { setsToWin: 3 } } } };
    expect(effectiveRules(t, d, 'f').walkover.setScore).toBeNull();
    expect(effectiveRules(t, d, 'f').roundScoring).toBeNull();
    expect(displayValue(t, d, 'f', 'walkover.setScore')).toBeNull();
  });
});

describe('preset apply', () => {
  it('replaces tournament-level edits with the preset and keeps stage overrides', () => {
    let d = setFieldValue(emptyDraft('ibsa'), TOURNAMENT_SCOPE, 'tiebreak.criteria', ['points', 'lot']);
    d = setFieldValue(d, 'f', 'standingsPoints.win', 3);
    const p = applyPreset(d, 'simple');
    expect(p.tournament).toMatchObject({ presetId: 'simple', finalRanking: { thirdPlace: 'joint', placementMatches: false } });
    expect(p.tournament.tiebreak!.criteria).toEqual(['points', 'set_difference', 'point_difference']);
    expect(p.stages.f).toEqual({ standingsPoints: { win: 3 } });
    expect(effectiveRules({}, p, TOURNAMENT_SCOPE).tiebreak.criteria).toEqual(['points', 'set_difference', 'point_difference']);
    expect(applyPreset(d, 'nope')).toBe(d);
  });
  it('preset values beat the legacy structure fields (simple → joint 3rd place even with rankingMatchConfig.thirdPlace)', () => {
    const t = { ...base, rankingMatchConfig: { thirdPlace: true, fifthToEighth: true } };
    const simple = applyPreset(draftFromTournament(t), 'simple');
    expect(effectiveRules(t, simple, TOURNAMENT_SCOPE).finalRanking).toMatchObject({ thirdPlace: 'joint', placementMatches: false });
    // 다른 프리셋으로 바꾸면 이전 프리셋 값이 남지 않는다 (ibsa = 기본값)
    const ibsa = applyPreset(simple, 'ibsa');
    expect(effectiveRules(t, ibsa, TOURNAMENT_SCOPE).finalRanking).toMatchObject({ thirdPlace: 'match', placementMatches: true });
    expect(effectiveRules(t, ibsa, TOURNAMENT_SCOPE).tiebreak.headToHeadMode).toBe('recursive');
  });
});

describe('which stage uses which field', () => {
  it('qualification counts on the qualifying stage, same-group avoidance on finals, final ranking tournament-wide', () => {
    expect(fieldUsedAtStage('qualification.perGroup', 'qualifying')).toBe(true);
    expect(fieldUsedAtStage('qualification.perGroup', 'finals')).toBe(false);
    expect(fieldUsedAtStage('qualification.wildcards', 'finals')).toBe(false);
    expect(fieldUsedAtStage('qualification.avoidSameGroupFirstRound', 'finals')).toBe(true);
    expect(fieldUsedAtStage('qualification.avoidSameGroupFirstRound', 'qualifying')).toBe(false);
    expect(fieldUsedAtStage('tiebreak.criteria', 'finals')).toBe(false);
    expect(fieldUsedAtStage('tiebreak.criteria', 'qualifying')).toBe(true);
    expect(fieldUsedAtStage('standingsPoints.win', 'ranking_match')).toBe(true);
    expect(fieldUsedAtStage('finalRanking.thirdPlace', 'finals')).toBe(false);
    expect(fieldUsedAtStage('scoring.individual.winScore', 'finals')).toBe(true);
    expect(fieldUsedAtStage('walkover.setScore', 'finals')).toBe(true);
    expect(fieldUsedAtStage('qualification.perGroup', undefined)).toBe(true);
  });
});

describe('stage overrides', () => {
  it('lists values that differ from the tournament value', () => {
    let d = draftFromTournament(base);
    d = setFieldValues(d, 'f', { 'scoring.individual.setsToWin': 3, 'scoring.individual.maxSets': 5 });
    expect(overriddenPaths(base, d, 'f')).toEqual(['scoring.individual.setsToWin', 'scoring.individual.maxSets']);
    expect(overriddenPaths(base, d, TOURNAMENT_SCOPE)).toEqual([]);
  });
  it('reset deletes the stage value', () => {
    let d = setFieldValues(draftFromTournament(base), 'f', { 'scoring.individual.setsToWin': 3, 'scoring.individual.maxSets': 5, 'standingsPoints.win': 2 });
    d = resetStagePaths(base, d, 'f', ['scoring.individual.setsToWin', 'scoring.individual.maxSets']);
    expect(d.stages.f).toEqual({ standingsPoints: { win: 2 } });
    d = resetStagePaths(base, d, 'f', ['standingsPoints.win']);
    expect(d.stages.f).toBeUndefined();
  });
  it('reset writes the tournament value when a legacy stage.scoringRules still differs', () => {
    const t = { ...base, stages: [{ id: 'q', type: 'qualifying', scoringRules: { winScore: 21, setsToWin: 1, maxSets: 1, minLead: 2 } }] };
    const d0 = draftFromTournament(t);
    expect(overriddenPaths(t, d0, 'q')).toContain('scoring.individual.winScore');
    const d = resetStagePaths(t, d0, 'q', ['scoring.individual.winScore', 'scoring.individual.setsToWin', 'scoring.individual.maxSets']);
    expect(effectiveRules(t, d, 'q').scoring.individual).toMatchObject({ winScore: 11, setsToWin: 2, maxSets: 3 });
    expect(resolveMatchScoring({ type: 'individual', stageId: 'q' }, withDraft(t, d))).toMatchObject({ winScore: 11, setsToWin: 2 });
  });
});

describe('validation', () => {
  it('valid defaults have no issues', () => {
    expect(validateDraft(base, draftFromTournament(base))).toEqual([]);
  });
  it('reports empty/invalid numbers, even-number best-of, empty tiebreak, bad round', () => {
    let d = draftFromTournament(base);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'scoring.individual.winScore', Number.NaN);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'qualification.wildcards', -1);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'schedule.minRestMinutes', 1.5);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'tiebreak.criteria', []);
    d = setFieldValue(d, 'f', 'roundScoring', { fromRound: 3, individual: { setsToWin: 3 } });
    const issues = validateDraft(base, d);
    expect(issues).toEqual(expect.arrayContaining([
      { scope: TOURNAMENT_SCOPE, path: 'scoring.individual.winScore', code: 'required' },
      { scope: TOURNAMENT_SCOPE, path: 'qualification.wildcards', code: 'min', params: { min: 0 } },
      { scope: TOURNAMENT_SCOPE, path: 'schedule.minRestMinutes', code: 'integer' },
      { scope: TOURNAMENT_SCOPE, path: 'tiebreak.criteria', code: 'tiebreakEmpty' },
      { scope: 'f', path: 'roundScoring', code: 'roundFrom' },
    ]));
  });
  it('best-of must be odd (sets to win = (best of + 1) / 2)', () => {
    const d = setFieldValues(draftFromTournament(base), 'f', { 'scoring.individual.setsToWin': 2, 'scoring.individual.maxSets': 4 });
    expect(validateDraft(base, d)).toEqual([{ scope: 'f', path: 'scoring.individual.maxSets', code: 'bestOfOdd' }]);
  });
});

describe('change impact', () => {
  it('none / started / finals', () => {
    expect(rulesChangeImpact(base, [{ status: 'pending', stageId: 'q' }])).toBe('none');
    expect(rulesChangeImpact(base, [{ status: 'completed', stageId: 'q', isBye: true }])).toBe('none');
    expect(rulesChangeImpact(base, [{ status: 'completed', stageId: 'q' }])).toBe('started');
    expect(rulesChangeImpact(base, [{ status: 'pending', stageId: 'f' }])).toBe('finals');
    expect(rulesChangeImpact(base, [{ status: 'pending', stageId: 'f_3rd' }])).toBe('finals');
  });
});

describe('write payload', () => {
  it('writes only changed rules sections and stage layers, never tie decisions', () => {
    let d = draftFromTournament(base);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'schedule.minRestMinutes', 20);
    d = setFieldValue(d, 'f', 'standingsPoints.win', 3);
    const p = buildRulesWritePayload(base, d);
    expect(p['rules/schedule']).toEqual({ minRestMinutes: 20 });
    expect('rules/presetId' in p).toBe(false);
    expect('rules/tiebreak' in p).toBe(false);
    expect(p['stages/1/rules']).toEqual({ standingsPoints: { win: 3 } });
    expect('stages/0/rules' in p).toBe(false);
    expect(Object.keys(p).some(k => k.includes('tiebreakDecisions'))).toBe(false);
    // 지운 섹션은 null
    const t2 = { ...base, rules: { ...base.rules, schedule: { minRestMinutes: 15 } } };
    const cleared = buildRulesWritePayload(t2, { ...draftFromTournament(t2), tournament: { presetId: 'ibsa' } });
    expect(cleared['rules/schedule']).toBeNull();
    expect(buildRulesWritePayload(base, draftFromTournament(base))).toEqual({});
  });
  it('three-way: a concurrent remote change to another section is not reverted (base → remote tiebreak → local scoring)', () => {
    const editBase = draftFromTournament(base);
    const local = setFieldValue(editBase, TOURNAMENT_SCOPE, 'scoring.individual.winScore', 7);
    // 다른 관리자가 동률 기준과 예선 덮어쓰기를 바꿨다 (실시간 구독으로 tournament가 바뀜)
    const remote = {
      ...base,
      rules: { ...base.rules, tiebreak: { criteria: ['points', 'lot'] } },
      stages: [{ ...base.stages[0], rules: { standingsPoints: { win: 3 } } }, base.stages[1]],
    };
    const p = buildRulesWritePayload(remote, local, editBase);
    expect('rules/tiebreak' in p).toBe(false);
    expect('stages/0/rules' in p).toBe(false);
    expect(p['rules/scoring']).toEqual({ individual: { winScore: 7 } });
    expect(isDraftDirty(remote, local, editBase)).toBe(true);
    expect(isDraftDirty(remote, editBase, editBase)).toBe(false);
    // 화면에는 병합한 값(원격 변경 + 내 변경)이 보인다
    const shown = mergeDrafts(draftFromTournament(remote), editBase, local);
    expect(shown.tournament.tiebreak).toEqual({ criteria: ['points', 'lot'] });
    expect(shown.tournament.scoring).toEqual({ individual: { winScore: 7 } });
    expect(shown.stages.q).toEqual({ standingsPoints: { win: 3 } });
    expect(savedChangedSince(remote, editBase)).toBe(true);
    expect(savedChangedSince(base, editBase)).toBe(false);
  });
  it('syncs legacy fields read directly by spectator/simulation code (gameConfig, finalsConfig, stage advanceCount)', () => {
    const t = {
      type: 'individual',
      gameConfig: { winScore: 11, setsToWin: 2 },
      scoringRules: { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2, deuceEnabled: true },
      qualifyingConfig: { groupCount: 2 },
      finalsConfig: { advancePerGroup: 2, advanceCount: 4, startingRound: 4, avoidSameGroup: true, scoringRules: { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2 } },
      rankingMatchConfig: { enabled: false, thirdPlace: true },
      stages: [{ id: 'q', type: 'qualifying', groupCount: 2 }, { id: 'f', type: 'finals', advanceCount: 4 }],
      rules: { presetId: 'ibsa' },
    };
    let d = draftFromTournament(t);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'scoring.individual.winScore', 7);
    d = setFieldValue(d, 'q', 'qualification.perGroup', 3);
    d = setFieldValue(d, 'f', 'qualification.avoidSameGroupFirstRound', false);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'finalRanking.thirdPlace', 'joint');
    const p = buildRulesWritePayload(t, d);
    expect(p).toMatchObject({
      'gameConfig/winScore': 7,
      'scoringRules/winScore': 7,
      'finalsConfig/scoringRules/winScore': 7,
      'finalsConfig/advancePerGroup': 3,
      'finalsConfig/advanceCount': 6,
      'finalsConfig/startingRound': 8,
      'finalsConfig/avoidSameGroup': false,
      'stages/1/advanceCount': 6,
      'rankingMatchConfig/thirdPlace': false,
    });
    expect('gameConfig/setsToWin' in p).toBe(false);
    expect('scoringRules/deuceEnabled' in p).toBe(false);
  });
  it('object-keyed stages and removal of a stage layer', () => {
    const t = { stages: { 0: { id: 'a', rules: { standingsPoints: { win: 2 } } } } };
    const p = buildRulesWritePayload(t, { tournament: {}, stages: {} });
    expect(p['stages/0/rules']).toBeNull();
  });
  it('dirty check', () => {
    const d = draftFromTournament(base);
    expect(isDraftDirty(base, d)).toBe(false);
    expect(isDraftDirty(base, setFieldValue(d, TOURNAMENT_SCOPE, 'standingsPoints.win', 2))).toBe(true);
    expect(isDraftDirty(base, setFieldValue(d, 'f', 'standingsPoints.win', 2))).toBe(true);
  });
});

describe('serve / side change fields (M0g)', () => {
  const team = { type: 'team', stages: [{ id: 'q', type: 'qualifying' }, { id: 'f', type: 'finals' }] };
  it('empty value means automatic (0 marker) and resolves to the default', () => {
    let d = setFieldValue(emptyDraft(), TOURNAMENT_SCOPE, 'scoring.team.servesPerTurn', 2);
    expect(resolveMatchScoring({ type: 'team' }, withDraft(team, d)).servesPerTurn).toBe(2);
    d = setFieldValue(d, 'f', 'scoring.team.servesPerTurn', null);
    expect(d.stages.f).toEqual({ scoring: { team: { servesPerTurn: 0 } } });
    expect(displayValue(team, d, 'f', 'scoring.team.servesPerTurn')).toBe(null);
    expect(resolveMatchScoring({ type: 'team', stageId: 'f' }, withDraft(team, d)).servesPerTurn).toBeUndefined();
    expect(validateDraft(team, d)).toEqual([]);
  });
  it('side change score must be lower than the target score', () => {
    const d = setFieldValue(emptyDraft(), TOURNAMENT_SCOPE, 'scoring.team.sideChangeAt', 31);
    expect(validateDraft(team, d)).toEqual([{ scope: TOURNAMENT_SCOPE, path: 'scoring.team.sideChangeAt', code: 'sideChangeRange', params: { max: 30 } }]);
  });
  it('serve rotation must alternate teams within the players on court', () => {
    const ok = setFieldValue(emptyDraft(), TOURNAMENT_SCOPE, 'scoring.team.serveRotation', ['A1', 'B2', 'A2', 'B1']);
    expect(validateDraft(team, setFieldValue(ok, TOURNAMENT_SCOPE, 'scoring.team.playersOnCourt', 2))).toEqual([]);
    const bad = setFieldValue(emptyDraft(), TOURNAMENT_SCOPE, 'scoring.team.serveRotation', ['A1', 'A2', 'B1']);
    expect(validateDraft(team, bad).map(i => i.code)).toEqual(['rotationInvalid']);
    const tooMany = setFieldValue(emptyDraft(), TOURNAMENT_SCOPE, 'scoring.team.serveRotation', ['A1', 'B4']);
    expect(validateDraft(team, tooMany).map(i => i.code)).toEqual(['rotationInvalid']);
  });
});
