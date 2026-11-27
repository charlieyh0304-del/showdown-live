import { describe, it, expect } from 'vitest';
import type { Match, ScoreHistoryEntry, SetScore } from '@shared/types';
import { DEFAULT_INDIVIDUAL_SCORING, DEFAULT_TEAM_SCORING, type ScoringRuleSet } from '@shared/rules/competitionRules';
import { clockFrom, newClock, startClock, timeLimitOf, type MatchClock } from '@shared/rules/timeLimit';
import { clockAutoPauseReason, goldenPhaseOf, nextSetClockPatch, pendingTimeExpirySetEnd, planGoldenCoinToss, planTimeExpiry, syncClockToRules, undoneSetClockPatch } from './timeLimitModel';
import { undoSetTransition } from './teamScoringModel';
import { setEndOutcome } from './teamScoringModel';

const set = (a: number, b: number, extra: Partial<SetScore> = {}): SetScore => ({
  player1Score: a, player2Score: b, player1Faults: 0, player2Faults: 0, player1Violations: 0, player2Violations: 0, winnerId: null, ...extra,
});
const entry = (p: Partial<ScoreHistoryEntry>): ScoreHistoryEntry => ({
  time: '10:00', scoringPlayer: '', actionPlayer: '', actionType: 'goal', actionLabel: '', points: 0,
  set: 1, server: '', serveNumber: 1, scoreBefore: { player1: 0, player2: 0 }, scoreAfter: { player1: 0, player2: 0 }, ...p,
});
const MIN = 60_000;
const opts = { sideIds: ['A', 'B'] as [string, string], time: '10:00', label: 'time up', serverName: 'A' };
const endOpts = { sideIds: ['A', 'B'] as [string, string], serverName: () => 'x', time: '10:00', sideChangeLabel: 'side change' };

function runningClock(rules: ScoringRuleSet, setIndex = 0): MatchClock {
  return startClock(newClock(timeLimitOf(rules), setIndex), { autoPause: null, inProgress: true }, 0);
}

type M = Pick<Match, 'currentSet' | 'sets' | 'currentServe' | 'serveCount' | 'scoreHistory' | 'clock'>;

describe('auto pause reasons', () => {
  it('time-outs, warm-up, side change and the set-end dialog stop the clock', () => {
    expect(clockAutoPauseReason({ activeTimeout: { type: 'medical' } })).toBe('timeout');
    expect(clockAutoPauseReason({ warmup: true })).toBe('warmup');
    expect(clockAutoPauseReason({ sideChange: true })).toBe('side_change');
    expect(clockAutoPauseReason({ setBreak: true })).toBe('set_break');
    expect(clockAutoPauseReason({})).toBeNull();
  });
});

describe('syncClockToRules', () => {
  const rules = { ...DEFAULT_INDIVIDUAL_SCORING, timeLimitSeconds: 600, timeLimitUnit: 'per_set' as const };
  const cfg = timeLimitOf(rules);
  it('creates a not-yet-started clock when missing; nothing when the limit is off', () => {
    expect(syncClockToRules(undefined, cfg, 0)).toMatchObject({ limitMs: 600_000, unit: 'per_set', elapsedMs: 0 });
    expect(syncClockToRules(undefined, timeLimitOf(DEFAULT_INDIVIDUAL_SCORING), 0)).toBeNull();
  });
  it('follows a changed limit before expiry, and starts a fresh clock when the set moved (per_set)', () => {
    const c = runningClock(rules);
    expect(syncClockToRules(c, cfg, 0)).toBeNull();
    expect(syncClockToRules(c, timeLimitOf({ ...rules, timeLimitSeconds: 900 }), 0)!.limitMs).toBe(900_000);
    expect(syncClockToRules(c, cfg, 1)).toMatchObject({ setIndex: 1, elapsedMs: 0, started: true });
  });
});

describe('planTimeExpiry → setEndOutcome', () => {
  it('per_set lead: set goes to the leader, next set gets a fresh clock', () => {
    const rules = { ...DEFAULT_INDIVIDUAL_SCORING, timeLimitSeconds: 600, timeLimitUnit: 'per_set' as const };
    const match: M = { currentSet: 0, sets: [set(5, 3)], clock: runningClock(rules), scoreHistory: [entry({ actionType: 'match_start', serverSide: 'player1' })] };
    const plan = planTimeExpiry(match, rules, timeLimitOf(rules), 10 * MIN, opts)!;
    expect(plan.kind).toBe('decided');
    if (plan.kind !== 'decided') return;
    expect(plan.sets[0]).toMatchObject({ winnerId: 'A', decidedBy: 'time_limit' });
    expect(plan.clock).toMatchObject({ expired: true, elapsedMs: 600_000 });
    expect(plan.entry.actionType).toBe('time_expired');
    const end = setEndOutcome(match, plan.sets, 0, rules, endOpts)!;
    expect(end.kind).toBe('next_set');
    const patch = nextSetClockPatch(plan.clock, 1, 11 * MIN);
    expect(clockFrom(patch.clock)).toMatchObject({ setIndex: 1, elapsedMs: 0, started: true });
    expect(clockFrom(patch.clock)!.expired).toBeUndefined();
  });

  it('per_match: tied current set with more sets → match completed, tie set kept', () => {
    const rules = { ...DEFAULT_INDIVIDUAL_SCORING, timeLimitSeconds: 600 };
    const match: M = { currentSet: 1, sets: [set(11, 2, { winnerId: 'A' }), set(4, 4)], clock: runningClock(rules) };
    const plan = planTimeExpiry(match, rules, timeLimitOf(rules), 10 * MIN, opts)!;
    expect(plan.kind === 'decided' && plan.matchWinner).toBe(1);
    if (plan.kind !== 'decided') return;
    const end = setEndOutcome(match, plan.sets, 1, rules, endOpts)!;
    expect(end).toMatchObject({ kind: 'completed', winnerId: 'A', setWinner: null });
  });

  it('tie → golden goal coin toss, then the chosen side serves and golden play starts', () => {
    const rules = { ...DEFAULT_TEAM_SCORING, timeLimitSeconds: 1800 };
    const match: M = { currentSet: 0, sets: [set(20, 20)], clock: runningClock(rules), currentServe: 'player1', serveCount: 2, scoreHistory: [] };
    const plan = planTimeExpiry(match, rules, timeLimitOf(rules), 30 * MIN, opts)!;
    expect(plan.kind).toBe('golden_goal');
    if (plan.kind !== 'golden_goal') return;
    expect(plan.update).toMatchObject({ goldenGoalActive: true });
    expect(goldenPhaseOf(plan.update.clock)).toBe('coin_toss');
    const afterToss = planGoldenCoinToss({ ...match, clock: plan.update.clock as MatchClock }, 'player2', { time: '10:30', label: 'B serves', serverName: 'B' })!;
    expect(afterToss).toMatchObject({ currentServe: 'player2', serveCount: 0 });
    expect(goldenPhaseOf(afterToss.clock)).toBe('playing');
    expect((afterToss.scoreHistory as ScoreHistoryEntry[])[0]).toMatchObject({ actionType: 'coin_toss', serverSide: 'player2' });
  });

  it('does nothing when the clock already expired (another device handled it)', () => {
    const rules = { ...DEFAULT_TEAM_SCORING, timeLimitSeconds: 1800 };
    const c = { ...runningClock(rules), expired: true };
    expect(planTimeExpiry({ currentSet: 0, sets: [set(3, 1)], clock: c }, rules, timeLimitOf(rules), 0, opts)).toBeNull();
  });
});

describe('setEndOutcome with a golden-goal set (goal_only 9:9, goal scorer wins)', () => {
  it('per_set team best of 3: golden set 1 → next set, decided winner counted', () => {
    const rules: ScoringRuleSet = { winScore: 21, setsToWin: 2, maxSets: 3, minLead: 2, timeLimitSeconds: 600, timeLimitUnit: 'per_set', goldenGoalMode: 'goal_only' };
    const r = setEndOutcome({ scoreHistory: [] }, [set(9, 9, { decidedBy: 'golden_goal', decidedWinner: 2 })], 0, rules, endOpts)!;
    expect(r.kind).toBe('next_set');
    expect(r.sets[0].winnerId).toBe('B');
    expect(r.wins).toEqual({ player1: 0, player2: 1 });
  });
});

describe('pendingTimeExpirySetEnd (re-open the set-end dialog after reload / on a second device)', () => {
  const rules = { ...DEFAULT_INDIVIDUAL_SCORING, timeLimitSeconds: 600 };
  const cfg = timeLimitOf(rules);
  type PM = NonNullable<Parameters<typeof pendingTimeExpirySetEnd>[0]>;
  const decided = (): PM => {
    const match: M = { currentSet: 1, sets: [set(11, 2, { winnerId: 'A' }), set(5, 3)], clock: runningClock(rules), scoreHistory: [entry({ actionType: 'goal' })] };
    const plan = planTimeExpiry(match, rules, cfg, 10 * MIN, opts)!;
    if (plan.kind !== 'decided') throw new Error('expected decided');
    return { ...match, status: 'in_progress', sets: plan.sets, clock: plan.clock, scoreHistory: [plan.entry, ...(match.scoreHistory ?? [])] };
  };
  it('pending after a time-decided write that was not confirmed yet (rebuilds winners from the stored sets)', () => {
    expect(pendingTimeExpirySetEnd(decided(), rules)).toMatchObject({ setIndex: 1, setWinner: 1, matchWinner: 1 });
  });
  it('per_match tie set decided on set count: no set winner, match winner from sets', () => {
    const match: M = { currentSet: 1, sets: [set(11, 2, { winnerId: 'A' }), set(4, 4)], clock: runningClock(rules), scoreHistory: [] };
    const plan = planTimeExpiry(match, rules, cfg, 10 * MIN, opts)!;
    if (plan.kind !== 'decided') throw new Error('expected decided');
    const m: PM = { ...match, status: 'in_progress', sets: plan.sets, clock: plan.clock, scoreHistory: [plan.entry] };
    expect(pendingTimeExpirySetEnd(m, rules)).toMatchObject({ setWinner: null, matchWinner: 1 });
  });
  it('not pending once confirmed (next-set entry on top / completed), in golden goal, or before expiry', () => {
    const m = decided();
    expect(pendingTimeExpirySetEnd({ ...m, scoreHistory: [entry({ actionType: 'side_change' }), ...(m.scoreHistory ?? [])] }, rules)).toBeNull();
    expect(pendingTimeExpirySetEnd({ ...m, status: 'completed' }, rules)).toBeNull();
    expect(pendingTimeExpirySetEnd({ ...m, clock: { ...(m.clock as MatchClock), goldenGoal: 'coin_toss' } }, rules)).toBeNull();
    expect(pendingTimeExpirySetEnd({ ...m, clock: runningClock(rules) }, rules)).toBeNull();
    expect(pendingTimeExpirySetEnd(null, rules)).toBeNull();
  });
});

describe('undoneSetClockPatch (team set-transition undo under per_set)', () => {
  it('the reopened set keeps its used play time, and the sync effect leaves it alone', () => {
    const rules = { ...DEFAULT_TEAM_SCORING, timeLimitSeconds: 600, timeLimitUnit: 'per_set' as const };
    const c0 = runningClock(rules, 0);
    const next = nextSetClockPatch(c0, 1, 4 * MIN).clock;
    const sets = [set(31, 20, { winnerId: 'A' }), set(0, 0)];
    const history = [entry({ actionType: 'side_change', set: 2 }), entry({ actionType: 'goal', set: 1, scoreBefore: { player1: 29, player2: 20 } })];
    const tr = undoSetTransition(sets, 1, history)!;
    const patch = undoneSetClockPatch(next, 0);
    expect(clockFrom(patch.clock)).toMatchObject({ setIndex: 0, elapsedMs: 4 * MIN });
    expect(syncClockToRules(patch.clock, timeLimitOf(rules), tr.update.currentSet as number)).toBeNull();
  });
  it('no clock → no patch', () => {
    expect(undoneSetClockPatch(undefined, 0)).toEqual({});
  });
});
