import { describe, it, expect } from 'vitest';
import {
  WIZARD_STAGE_KEYS,
  WIZARD_STEP,
  buildTournamentFromWizard,
  createDefaultState,
  effectiveOverrideFromRound,
  localDateString,
  nearestBracketRoundKey,
  validStartRounds,
  wizardReducer,
  type Action,
  type WizardState,
} from './wizardModel';
import { TOURNAMENT_SCOPE, applyPreset, effectiveRules, setFieldValue } from '../rules/rulesEditorModel';
import { resolveCompetitionRules, resolveMatchScoring } from '@shared/rules/competitionRules';
import { calculateMatchCount } from '@shared/utils/tournament';

const NOW = 1_700_000_000_000;

function run(actions: Action[], start: WizardState = createDefaultState('2026-11-27')): WizardState {
  return actions.reduce(wizardReducer, { ...start, name: '테스트 대회' });
}
const set = (field: string, value: unknown): Action => ({ type: 'SET_FIELD', field, value });
const build = (s: WizardState) => buildTournamentFromWizard(s, { now: NOW });
const stageId = (doc: ReturnType<typeof build>, type: string) => doc.stages!.find(s => s.type === type)!.id;

describe('wizard → saved tournament (B15)', () => {
  it('untouched default (direct tournament shown selected) saves a single-elimination finals stage', () => {
    const doc = build(run([]));
    expect(doc.formatType).toBe('single_elimination');
    expect(doc.stages!.map(st => st.type)).toEqual(['finals']);
    expect(doc.finalsConfig).toMatchObject({ startingRound: 8, advanceCount: 8 });
  });

  it('direct tournament: finals best-of chosen in the format step is saved and used (was discarded)', () => {
    const s = run([
      set('tournamentMode', 'direct_tournament'),
      set('finalsScoringRules', { winScore: 11, setsToWin: 3, maxSets: 5, minLead: 2, deuceEnabled: true }),
    ]);
    const doc = build(s);
    expect(doc.finalsConfig!.scoringRules).toMatchObject({ setsToWin: 3, maxSets: 5 });
    expect(doc.gameConfig).toEqual({ winScore: 11, setsToWin: 3 });
    expect(resolveMatchScoring({ type: 'individual', stageId: stageId(doc, 'finals'), roundLabel: '8강' }, doc)).toMatchObject({ setsToWin: 3, maxSets: 5 });
  });

  it('group + finals: groups best-of-3, finals best-of-5 → per-stage scoring', () => {
    const s = run([
      set('tournamentMode', 'group_tournament'),
      set('participantCount', 16),
      set('groupCount', 4),
      set('finalsScoringRules', { winScore: 11, setsToWin: 3, maxSets: 5, minLead: 2, deuceEnabled: true }),
    ]);
    expect(s.sameRulesAsQualifying).toBe(false);
    const doc = build(s);
    expect(resolveMatchScoring({ type: 'individual', stageId: stageId(doc, 'qualifying') }, doc).setsToWin).toBe(2);
    expect(resolveMatchScoring({ type: 'individual', stageId: stageId(doc, 'finals'), roundLabel: '8강' }, doc).setsToWin).toBe(3);
  });

  it('qualifying change follows into finals only while they are the same', () => {
    let s = run([set('tournamentMode', 'group_tournament')]);
    s = wizardReducer(s, set('qualifyingScoringRules', { winScore: 11, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: true }));
    expect(s.finalsScoringRules.setsToWin).toBe(1);
    s = wizardReducer(s, set('finalsScoringRules', { ...s.finalsScoringRules, setsToWin: 3, maxSets: 5 }));
    s = wizardReducer(s, set('qualifyingScoringRules', { ...s.qualifyingScoringRules, setsToWin: 2, maxSets: 3 }));
    expect(s.finalsScoringRules.setsToWin).toBe(3);
  });

  it('avoid-same-group toggle is saved (was hard-coded true)', () => {
    const s = run([set('tournamentMode', 'group_tournament'), set('avoidSameGroup', false)]);
    const doc = build(s);
    expect(doc.finalsConfig!.avoidSameGroup).toBe(false);
    expect(resolveCompetitionRules(doc, stageId(doc, 'finals')).qualification.avoidSameGroupFirstRound).toBe(false);
  });

  it('wildcards: start round 16 with 6 groups × 2 → 4 wildcards, advanceCount 16', () => {
    const s = run([
      set('tournamentMode', 'group_tournament'),
      set('participantCount', 30),
      set('groupCount', 6),
      set('advancePerGroup', 2),
      set('finalsStartRound', 16),
    ]);
    const doc = build(s);
    expect(doc.finalsConfig).toMatchObject({ wildcardCount: 4, advanceCount: 16, startingRound: 16, advancePerGroup: 2 });
    expect(resolveCompetitionRules(doc, stageId(doc, 'finals')).qualification).toMatchObject({ perGroup: 2, wildcards: 4 });
  });

  it('impossible start round is corrected (4 groups × 2 cannot start at the semifinal)', () => {
    let s = run([set('tournamentMode', 'group_tournament'), set('participantCount', 16), set('groupCount', 4)]);
    expect(validStartRounds(s)).not.toContain(4);
    s = wizardReducer(s, set('finalsStartRound', 4));
    expect(s.finalsStartRound).toBe(8);
    expect(build(s).finalsConfig!.startingRound).toBe(8);
  });

  it('direct tournament start round options follow the participant count (stale advanceCount)', () => {
    const s = run([set('tournamentMode', 'direct_tournament'), set('participantCount', 32), set('finalsStartRound', 32)]);
    expect(validStartRounds(s)).toContain(32);
    expect(s.finalsStartRound).toBe(32);
    expect(build(s).finalsConfig!.advanceCount).toBe(32);
  });

  it('hidden ranking-match sub-options are not saved when ranking matches are off', () => {
    const s = run([
      set('tournamentMode', 'direct_tournament'),
      set('hasRankingMatch', true),
      set('fifthToEighth', true),
      set('rankingUpTo', 8),
      set('hasRankingMatch', false),
    ]);
    const doc = build(s);
    expect(doc.rankingMatchConfig).toMatchObject({ enabled: false, fifthToEighth: false, classificationGroups: false });
    expect(doc.rankingMatchConfig!.rankingUpTo).toBeUndefined();
    expect(doc.stages!.some(st => st.type === 'ranking_match')).toBe(false);
  });

  it('third place match on/off is saved and counted', () => {
    const off = build(run([set('thirdPlaceMatch', false)]));
    expect(off.rankingMatchConfig!.thirdPlace).toBe(false);
    expect(resolveCompetitionRules(off).finalRanking.thirdPlace).toBe('joint');
    const on = build(run([]));
    expect(resolveCompetitionRules(on).finalRanking.thirdPlace).toBe('match');
    expect(calculateMatchCount(8, false, 1, true, 8, on.rankingMatchConfig!, 8).ranking).toBe(1);
  });

  it('round override: from-round outside the bracket is normalized and the resolver uses it', () => {
    // 4강 시작이면 "4강부터"는 고를 수 없다 → 결승부터
    const s = run([set('participantCount', 4), set('finalsStartRound', 4), set('hasRoundScoringOverride', true), set('roundOverrideFromRound', 4)]);
    expect(effectiveOverrideFromRound(s)).toBe(2);
    const doc = build(s);
    expect(doc.finalsConfig!.roundScoringOverride!.fromRound).toBe(2);
    const fid = stageId(doc, 'finals');
    expect(resolveMatchScoring({ type: 'individual', stageId: fid, roundLabel: '4강' }, doc).setsToWin).toBe(2);
    expect(resolveMatchScoring({ type: 'individual', stageId: fid, roundLabel: '결승' }, doc).setsToWin).toBe(3);
  });

  it('team size change keeps the gender ratio consistent', () => {
    const s = run([set('type', 'team'), set('teamSize', 4), set('teamSize', 2)]);
    expect(s.teamRules.genderRatio).toEqual({ male: 2, female: 0 });
    expect(s.teamRules.teamSize).toBe(2);
    const s2 = run([set('type', 'team'), set('teamRules', { ...createDefaultState().teamRules, genderRatio: { male: 1, female: 2 } }), set('teamSize', 5)]);
    expect(build(s2).teamRules!.genderRatio).toEqual({ male: 1, female: 4 });
  });

  it('team tournament saves 31-point team settings', () => {
    const doc = build(run([set('type', 'team')]));
    expect(doc.teamMatchSettings).toEqual({ winScore: 31, setsToWin: 1, minLead: 2 });
    expect(resolveMatchScoring({ type: 'team' }, doc).winScore).toBe(31);
  });

  it('manual mode without stages saves no stages and keeps the rules', () => {
    const doc = build(run([set('tournamentMode', 'manual')]));
    expect(doc.stages).toBeUndefined();
    expect(doc.formatType).toBe('manual');
    expect(doc.finalsConfig).toBeUndefined();
  });

  it('full league: no finals config, league rules at tournament level', () => {
    const doc = build(run([set('tournamentMode', 'full_league_all')]));
    expect(doc.formatType).toBe('round_robin');
    expect(doc.finalsConfig).toBeUndefined();
    expect(doc.format).toBe('full_league');
  });

  it('team preset goes to full league mode (not a stale direct-tournament mode)', () => {
    const s = wizardReducer(run([set('type', 'team')]), { type: 'APPLY_PRESET', presetId: 'ibsa_team' });
    expect(s.tournamentMode).toBe('full_league_all');
    expect(s.hasFinalsStage).toBe(false);
  });

  it('default date is the local date, not UTC', () => {
    expect(localDateString(new Date(2026, 0, 2, 0, 30))).toBe('2026-01-02');
  });

  it('nearestBracketRoundKey', () => {
    expect(nearestBracketRoundKey(9)).toBe('admin.tournamentCreate.finals.round8');
    expect(nearestBracketRoundKey(2)).toBe('admin.tournamentCreate.finals.final');
  });
});

describe('wizard rules step → saved rules', () => {
  it('rules edited in the wizard are saved on the tournament and on the real stage IDs', () => {
    let s = run([set('tournamentMode', 'group_tournament'), set('participantCount', 16), set('groupCount', 4)]);
    let d = setFieldValue(s.rulesDraft, TOURNAMENT_SCOPE, 'tiebreak.criteria', ['points', 'set_difference', 'point_difference', 'head_to_head']);
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'schedule.minRestMinutes', 25);
    d = setFieldValue(d, WIZARD_STAGE_KEYS.finals, 'schedule.minRestMinutes', 5);
    s = wizardReducer(s, { type: 'SET_RULES_DRAFT', draft: d });
    const doc = build(s);
    expect(doc.rules).toMatchObject({ presetId: 'ibsa', schedule: { minRestMinutes: 25 } });
    const fid = stageId(doc, 'finals');
    expect(fid).not.toBe('finals');
    expect(resolveCompetitionRules(doc, fid).schedule.minRestMinutes).toBe(5);
    expect(resolveCompetitionRules(doc).tiebreak.criteria).toEqual(['points', 'set_difference', 'point_difference', 'head_to_head']);
  });

  it('what the rules editor shows equals what is saved (round trip, every scope)', () => {
    let s = run([set('tournamentMode', 'group_tournament'), set('participantCount', 16), set('groupCount', 4), set('thirdPlaceMatch', true)]);
    let d = setFieldValue(s.rulesDraft, TOURNAMENT_SCOPE, 'finalRanking.thirdPlace', 'joint');
    d = setFieldValue(d, TOURNAMENT_SCOPE, 'qualification.perGroup', 3);
    d = setFieldValue(d, WIZARD_STAGE_KEYS.finals, 'scoring.individual.setsToWin', 3);
    d = setFieldValue(d, WIZARD_STAGE_KEYS.finals, 'scoring.individual.maxSets', 5);
    s = wizardReducer(s, { type: 'SET_RULES_DRAFT', draft: d });
    const base = buildTournamentFromWizard(s, { now: NOW, stageIds: WIZARD_STAGE_KEYS, includeRules: false });
    const saved = buildTournamentFromWizard(s, { now: NOW, stageIds: WIZARD_STAGE_KEYS });
    for (const scope of [TOURNAMENT_SCOPE, 'qualifying', 'finals']) {
      // 개인전이므로 팀 점수 규칙은 쓰지 않는다
      const shown = { ...effectiveRules(base, s.rulesDraft, scope), scoring: undefined };
      const shownScoring = effectiveRules(base, s.rulesDraft, scope).scoring.individual;
      const got = resolveCompetitionRules(saved, scope === TOURNAMENT_SCOPE ? undefined : scope);
      expect({ ...got, scoring: undefined }).toEqual(shown);
      expect(got.scoring.individual).toEqual(shownScoring);
    }
    // 레거시 필드도 같은 값으로 맞춘다
    expect(saved.rankingMatchConfig!.thirdPlace).toBe(false);
    expect(saved.finalsConfig).toMatchObject({ advancePerGroup: 3, advanceCount: 12, startingRound: 16 });
    expect(saved.finalsConfig!.scoringRules).toMatchObject({ setsToWin: 3, maxSets: 5 });
  });

  it('qualifiers per group set on the qualifying scope drive finalsConfig, stage.advanceCount and the bracket size', () => {
    let s = run([set('tournamentMode', 'group_tournament'), set('participantCount', 12), set('groupCount', 2), set('finalsStartRound', 4)]);
    expect(build(s).finalsConfig).toMatchObject({ advancePerGroup: 2, advanceCount: 4, startingRound: 4 });
    s = wizardReducer(s, { type: 'SET_RULES_DRAFT', draft: setFieldValue(s.rulesDraft, WIZARD_STAGE_KEYS.qualifying, 'qualification.perGroup', 3) });
    const doc = build(s);
    expect(doc.finalsConfig).toMatchObject({ advancePerGroup: 3, advanceCount: 6, startingRound: 8 });
    expect(doc.stages!.find(x => x.type === 'finals')!.advanceCount).toBe(6);
    // 생성기와 같은 곳(예선 스테이지)에서 읽은 값
    expect(resolveCompetitionRules(doc, stageId(doc, 'qualifying')).qualification.perGroup).toBe(3);
  });

  it('5th–8th placement: the simple preset (no placement matches) turns off the 5–8 matches chosen in the format step', () => {
    let s = run([set('participantCount', 16), set('finalsStartRound', 16), set('hasRankingMatch', true), set('fifthToEighth', true)]);
    let doc = build(s);
    expect(doc.rankingMatchConfig).toMatchObject({ enabled: true, fifthToEighth: true });
    expect(resolveCompetitionRules(doc).finalRanking.placementMatches).toBe(true);
    s = wizardReducer(s, { type: 'SET_RULES_DRAFT', draft: applyPreset(s.rulesDraft, 'simple') });
    doc = build(s);
    expect(doc.rankingMatchConfig).toMatchObject({ enabled: false, fifthToEighth: false, thirdPlace: false });
    expect(doc.stages!.some(x => x.type === 'ranking_match')).toBe(false);
    expect(resolveCompetitionRules(doc).finalRanking).toMatchObject({ placementMatches: false, thirdPlace: 'joint' });
    // 형식 단계에서 5~8위 결정전을 다시 켜면 규칙 단계의 결정 방식은 지워지고 다시 확인해야 한다
    s = wizardReducer({ ...s, rulesConfirmed: true }, set('fifthToEighth', true));
    expect(s.rulesConfirmed).toBe(false);
    doc = build(s);
    expect(doc.rankingMatchConfig!.fifthToEighth).toBe(true);
    expect(resolveCompetitionRules(doc).finalRanking.placementMatches).toBe(true);
  });

  it('the simple preset applies joint third place to a wizard tournament with finals', () => {
    let s = run([set('thirdPlaceMatch', true)]);
    expect(build(s).rankingMatchConfig!.thirdPlace).toBe(true);
    s = wizardReducer(s, { type: 'SET_RULES_DRAFT', draft: applyPreset(s.rulesDraft, 'simple') });
    const doc = build(s);
    expect(resolveCompetitionRules(doc).finalRanking.thirdPlace).toBe('joint');
    expect(resolveCompetitionRules(doc, stageId(doc, 'finals')).finalRanking.thirdPlace).toBe('joint');
    expect(doc.rankingMatchConfig!.thirdPlace).toBe(false);
  });

  it('changing an earlier-step setting again clears the conflicting rules-step edit', () => {
    let s = run([]);
    s = wizardReducer(s, { type: 'SET_RULES_DRAFT', draft: setFieldValue(s.rulesDraft, TOURNAMENT_SCOPE, 'finalRanking.thirdPlace', 'joint') });
    expect(resolveCompetitionRules(build(s)).finalRanking.thirdPlace).toBe('joint');
    s = wizardReducer(s, set('thirdPlaceMatch', true));
    expect(resolveCompetitionRules(build(s)).finalRanking.thirdPlace).toBe('match');
  });

  it('editing rules requires confirming again; steps skip the format step for leagues', () => {
    let s = run([set('tournamentMode', 'full_league_all'), set('rulesConfirmed', true)]);
    s = wizardReducer(s, { type: 'SET_RULES_DRAFT', draft: s.rulesDraft });
    expect(s.rulesConfirmed).toBe(false);
    s = wizardReducer({ ...s, step: WIZARD_STEP.participants }, { type: 'NEXT_STEP' });
    expect(s.step).toBe(WIZARD_STEP.rules);
    s = wizardReducer(s, { type: 'PREV_STEP' });
    expect(s.step).toBe(WIZARD_STEP.participants);
  });
});
