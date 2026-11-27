import { describe, it, expect } from 'vitest';
import {
  applyGoldenPoint,
  clockElapsedMs,
  clockForNextSet,
  clockForUndoneSet,
  clockFrom,
  clockRemainingMs,
  clockRemainingSeconds,
  crossedMilestones,
  decideTimeExpiry,
  expireClock,
  isClockRunning,
  isGoldenPointDecisive,
  matchDecidedBy,
  newClock,
  pauseClockManually,
  reconcileClock,
  resumeClockManually,
  startClock,
  startGoldenPlay,
  stripTimeDecision,
  timeLimitOf,
  type ClockContext,
  type MatchClock,
  type TimedSet,
} from './timeLimit';
import {
  DEFAULT_INDIVIDUAL_SCORING,
  DEFAULT_TEAM_SCORING,
  matchWinnerByRules,
  resolveCompetitionRules,
  resolveMatchScoring,
  setWinnerOf,
  setWinsByRules,
} from './competitionRules';
import { normalizeResults, resultContextFor } from './standings';
import { buildRetirementSets } from './walkover';

const MIN = 60_000;
const play: ClockContext = { autoPause: null, inProgress: true };
const sideChange: ClockContext = { autoPause: 'side_change', inProgress: true };
const timeout: ClockContext = { autoPause: 'timeout', inProgress: true };
const set = (p1: number, p2: number, extra: Partial<TimedSet> = {}): TimedSet => ({ player1Score: p1, player2Score: p2, ...extra });
const R = DEFAULT_INDIVIDUAL_SCORING; // 11점 3세트 2선승

function started(limitMin = 10, now = 1_000): MatchClock {
  return startClock(newClock({ limitMs: limitMin * MIN, unit: 'per_match' }), play, now);
}

describe('timeLimitOf (rules → clock config)', () => {
  it('defaults: off, per_match, next_point (IBSA)', () => {
    expect(timeLimitOf(R)).toEqual({ enabled: false, limitMs: 0, unit: 'per_match', goldenGoalMode: 'next_point' });
    expect(timeLimitOf({ timeLimitSeconds: 1800, timeLimitUnit: 'per_set', goldenGoalMode: 'goal_only' }))
      .toEqual({ enabled: true, limitMs: 1_800_000, unit: 'per_set', goldenGoalMode: 'goal_only' });
    expect(timeLimitOf({ timeLimitSeconds: -5 }).enabled).toBe(false);
  });
});

describe('clock model: start / pause / resume', () => {
  it('does not run before the referee starts play (warm-up excluded)', () => {
    const c = newClock({ limitMs: 10 * MIN, unit: 'per_match' });
    expect(reconcileClock(c, play, 5_000)).toBeNull();
    expect(clockRemainingMs(c, 999_999)).toBe(10 * MIN);
  });

  it('counts rally time while running', () => {
    const c = started(10, 1_000);
    expect(isClockRunning(c)).toBe(true);
    expect(clockElapsedMs(c, 1_000 + 90_000)).toBe(90_000);
    expect(clockRemainingSeconds(c, 1_000 + 90_000)).toBe(510);
  });

  it('stops for a side change and resumes when it ends (side change time excluded)', () => {
    let c = started(10, 0);
    c = reconcileClock(c, sideChange, 120_000)!; // 2분 플레이 후 사이드 체인지
    expect(isClockRunning(c)).toBe(false);
    expect(c.autoPause).toBe('side_change');
    expect(c.elapsedMs).toBe(120_000);
    expect(reconcileClock(c, sideChange, 150_000)).toBeNull(); // 계속 멈춤 → 쓰기 없음
    c = reconcileClock(c, play, 180_000)!; // 60초 뒤 재개
    expect(isClockRunning(c)).toBe(true);
    expect(c.autoPause).toBeUndefined();
    expect(clockElapsedMs(c, 240_000)).toBe(180_000); // 2분 + 1분 (사이드 체인지 60초 제외)
    expect(c.pauses).toEqual([{ reason: 'side_change', at: 120_000, until: 180_000 }]);
  });

  it('stops for player, referee and medical time-outs', () => {
    let c = started(10, 0);
    c = reconcileClock(c, timeout, 60_000)!;
    c = reconcileClock(c, play, 360_000)!; // 의료 타임아웃 5분
    expect(clockElapsedMs(c, 420_000)).toBe(120_000);
  });

  it('switching pause reason while stopped only updates the display reason', () => {
    let c = started(10, 0);
    c = reconcileClock(c, sideChange, 10_000)!;
    const next = reconcileClock(c, timeout, 20_000)!;
    expect(next.autoPause).toBe('timeout');
    expect(next.elapsedMs).toBe(10_000);
    expect(isClockRunning(next)).toBe(false);
  });

  it('manual pause with reason, resume continues; resume during an auto pause waits for it to end', () => {
    let c = started(10, 0);
    c = pauseClockManually(c, 30_000, 'wet table');
    expect(isClockRunning(c)).toBe(false);
    expect(c.manualPause).toEqual({ at: 30_000, note: 'wet table' });
    expect(reconcileClock(c, play, 40_000)).toBeNull(); // 수동 정지는 자동으로 풀리지 않는다
    c = resumeClockManually(c, play, 90_000);
    expect(isClockRunning(c)).toBe(true);
    expect(clockElapsedMs(c, 100_000)).toBe(40_000);
    // 자동 정지 중 수동 재개
    c = pauseClockManually(c, 100_000);
    c = resumeClockManually(c, timeout, 110_000);
    expect(isClockRunning(c)).toBe(false);
    expect(c.manualPause).toBeUndefined();
    c = reconcileClock(c, play, 170_000)!;
    expect(isClockRunning(c)).toBe(true);
    expect(clockElapsedMs(c, 170_000)).toBe(40_000);
  });

  it('stops when the match is no longer in progress', () => {
    const c = reconcileClock(started(10, 0), { autoPause: null, inProgress: false }, 5_000)!;
    expect(isClockRunning(c)).toBe(false);
    expect(c.elapsedMs).toBe(5_000);
  });
});

describe('clock persistence / rehydration / skew', () => {
  it('survives a JSON round trip (Firebase) and recomputes the same remaining time on another device', () => {
    let c = started(10, 0);
    c = reconcileClock(c, sideChange, 120_000)!;
    c = reconcileClock(c, play, 180_000)!;
    const stored = JSON.parse(JSON.stringify(c));
    // Firebase는 배열을 숫자 키 객체로 돌려줄 수 있다
    stored.pauses = { 0: stored.pauses[0] };
    const back = clockFrom(stored)!;
    expect(back).toEqual(c);
    expect(clockRemainingMs(back, 300_000)).toBe(clockRemainingMs(c, 300_000));
  });

  it('rejects malformed values', () => {
    expect(clockFrom(null)).toBeNull();
    expect(clockFrom({ elapsedMs: 5 })).toBeNull();
    expect(clockFrom({ limitMs: 600_000, elapsedMs: -50 })!.elapsedMs).toBe(0);
  });

  it('a device whose clock is behind runningSince never sees negative or extra time', () => {
    const c = started(10, 100_000);
    expect(clockElapsedMs(c, 40_000)).toBe(0);
    expect(clockRemainingMs(c, 40_000)).toBe(10 * MIN);
    // 그 기기가 멈추면 흐른 시간은 그대로 (줄지 않는다)
    const paused = reconcileClock({ ...c, elapsedMs: 30_000 }, sideChange, 40_000)!;
    expect(paused.elapsedMs).toBe(30_000);
  });

  it('elapsed never exceeds the limit when frozen late (offline device)', () => {
    const c = reconcileClock(started(1, 0), sideChange, 10 * MIN)!;
    expect(c.elapsedMs).toBe(MIN);
    expect(clockRemainingMs(c, 10 * MIN)).toBe(0);
  });
});

describe('alerts at 5 min, 1 min, 30 s and end', () => {
  it('announces each milestone once when crossed', () => {
    expect(crossedMilestones(5 * MIN + 200, 5 * MIN - 50)).toEqual([5 * MIN]);
    expect(crossedMilestones(61_000, 59_000)).toEqual([MIN]);
    expect(crossedMilestones(30_100, 29_900)).toEqual([30_000]);
    expect(crossedMilestones(400, 0)).toEqual([0]);
    expect(crossedMilestones(59_000, 58_000)).toEqual([]);
  });
  it('a jump (device asleep) reports every crossed milestone; first observation reports none', () => {
    expect(crossedMilestones(6 * MIN, 10_000)).toEqual([5 * MIN, MIN, 30_000]);
    expect(crossedMilestones(undefined, 10_000)).toEqual([]);
    expect(crossedMilestones(10_000, 12_000)).toEqual([]);
  });
});

describe('expiry decision', () => {
  it('per_set: leader wins the set, match continues', () => {
    const out = decideTimeExpiry([set(5, 3)], 0, R, 'per_set');
    expect(out.kind).toBe('decided');
    if (out.kind !== 'decided') return;
    expect(out.setWinner).toBe(1);
    expect(out.matchWinner).toBeNull();
    expect(out.sets[0]).toMatchObject({ decidedBy: 'time_limit' });
    expect(out.sets[0].matchTimeUp).toBeUndefined();
    expect(setWinsByRules(out.sets, R)).toEqual({ player1: 1, player2: 0 });
  });

  it('per_set: deciding set by time ends the match', () => {
    const out = decideTimeExpiry([set(11, 4), set(7, 9)], 1, R, 'per_set');
    expect(out.kind === 'decided' && out.matchWinner).toBeNull();
    const out2 = decideTimeExpiry([set(11, 4), set(9, 7)], 1, R, 'per_set');
    expect(out2.kind === 'decided' && out2.matchWinner).toBe(1);
  });

  it('per_set / per_match: tie → golden goal', () => {
    expect(decideTimeExpiry([set(6, 6)], 0, R, 'per_set').kind).toBe('golden_goal');
    expect(decideTimeExpiry([set(11, 5), set(5, 11), set(4, 4)], 2, R, 'per_match').kind).toBe('golden_goal');
  });

  it('per_match: current set leader takes the set; more sets wins', () => {
    const out = decideTimeExpiry([set(11, 5), set(6, 2)], 1, R, 'per_match');
    expect(out.kind === 'decided' && out.matchWinner).toBe(1);
  });

  it('per_match: equal sets after the current set → the current set leader (points) wins', () => {
    // 1세트 p1, 2세트 3:5에서 시간 만료 → 세트 1:1 → 2세트 점수가 앞선 p2
    const out = decideTimeExpiry([set(11, 5), set(3, 5)], 1, R, 'per_match');
    expect(out.kind).toBe('decided');
    if (out.kind !== 'decided') return;
    expect(out.matchWinner).toBe(2);
    expect(out.sets[1]).toMatchObject({ decidedBy: 'time_limit', matchTimeUp: true });
    expect(matchWinnerByRules(out.sets, R)).toBe(2);
  });

  it('per_match: tied current set but more sets → that side wins, set recorded as a tie', () => {
    const out = decideTimeExpiry([set(11, 5), set(4, 4)], 1, R, 'per_match');
    expect(out.kind === 'decided' && out.matchWinner).toBe(1);
    expect(out.kind === 'decided' && out.setWinner).toBeNull();
  });
});

describe('golden goal', () => {
  const nextPoint = { goldenGoalMode: 'next_point' as const, unit: 'per_set' as const };
  const goalOnly = { goldenGoalMode: 'goal_only' as const, unit: 'per_set' as const };

  it('next_point: any point decides, including a foul (recorded 7:6)', () => {
    const r = applyGoldenPoint([set(6, 6)], 0, { actionType: 'foul', scorer: 1, points: 1, toOpponent: true }, nextPoint, R);
    expect(r.decisive).toBe(true);
    expect(r.sets[0]).toMatchObject({ player1Score: 7, player2Score: 6, decidedBy: 'golden_goal', decidedWinner: 1 });
    expect(setWinnerOf(r.sets[0], R)).toBe(1);
  });

  it('next_point: a warning (0 points) does not decide', () => {
    expect(isGoldenPointDecisive('next_point', { actionType: 'penalty_talking', scorer: 2, points: 0, toOpponent: true })).toBe(false);
  });

  it('goal_only: fouls award points but do not end; the next goal decides (9:7)', () => {
    let sets = [set(7, 7)];
    const foul = applyGoldenPoint(sets, 0, { actionType: 'foul', scorer: 2, points: 1, toOpponent: true }, goalOnly, R);
    expect(foul.decisive).toBe(false);
    expect(foul.sets[0]).toMatchObject({ player1Score: 7, player2Score: 8 });
    expect(foul.sets[0].decidedBy).toBeUndefined();
    sets = [set(7, 7)];
    const goal = applyGoldenPoint(sets, 0, { actionType: 'goal', scorer: 1, points: 2, toOpponent: false }, goalOnly, R);
    expect(goal.decisive).toBe(true);
    expect(goal.sets[0]).toMatchObject({ player1Score: 9, player2Score: 7, decidedWinner: 1 });
  });

  it('goal_only: the goal scorer wins even when fouls put them level or behind', () => {
    // 7:7 → p1 반칙 2번 (7:9) → p1 골 (9:9): 골을 넣은 p1 승
    const r = applyGoldenPoint([set(7, 9)], 0, { actionType: 'goal', scorer: 1, points: 2, toOpponent: false }, goalOnly, R);
    expect(r.sets[0]).toMatchObject({ player1Score: 9, player2Score: 9, decidedWinner: 1 });
    expect(setWinnerOf(r.sets[0], R)).toBe(1);
    expect(isGoldenPointDecisive('goal_only', { actionType: 'mask_touch', scorer: 1, points: 2, toOpponent: true })).toBe(false);
  });

  it('per_match golden point ends the match', () => {
    const r = applyGoldenPoint([set(11, 5), set(5, 11), set(4, 4)], 2, { actionType: 'goal', scorer: 2, points: 2, toOpponent: false }, { goldenGoalMode: 'next_point', unit: 'per_match' }, R);
    expect(r.matchWinner).toBe(2);
    expect(matchDecidedBy(r.sets)).toBe('golden_goal');
  });

  it('per_set golden point in set 1 of 3 does not end the match', () => {
    const r = applyGoldenPoint([set(6, 6)], 0, { actionType: 'goal', scorer: 2, points: 2, toOpponent: false }, nextPoint, R);
    expect(r.matchWinner).toBeNull();
  });

  it('team 1-set match: golden point ends the match', () => {
    const r = applyGoldenPoint([set(20, 20)], 0, { actionType: 'foul', scorer: 1, points: 1, toOpponent: true }, nextPoint, DEFAULT_TEAM_SCORING);
    expect(r.matchWinner).toBe(1);
  });

  it('clock: expiry with tie enters coin toss then playing', () => {
    let c = started(1, 0);
    c = expireClock(c, MIN + 300, true);
    expect(c).toMatchObject({ expired: true, goldenGoal: 'coin_toss', elapsedMs: MIN });
    expect(isClockRunning(c)).toBe(false);
    c = startGoldenPlay(c);
    expect(c.goldenGoal).toBe('playing');
    expect(reconcileClock(c, play, 2 * MIN)).toBeNull(); // 골든골 중에는 시계가 흐르지 않는다
  });

  it('undo strips the time decision marks', () => {
    const s = stripTimeDecision(set(7, 6, { decidedBy: 'golden_goal', decidedWinner: 1, matchTimeUp: true }));
    expect(s).toEqual(set(7, 6));
    expect(setWinnerOf(s, R)).toBeNull();
  });
});

describe('next set clock', () => {
  it('per_set: fresh clock per set (already started, waits for the set break)', () => {
    const c = expireClock(started(5, 0), 5 * MIN, false);
    const n = clockForNextSet({ ...c, unit: 'per_set' }, 1, 5 * MIN);
    expect(n).toMatchObject({ setIndex: 1, elapsedMs: 0, started: true });
    expect(isClockRunning(n)).toBe(false);
    expect(reconcileClock(n, play, 6 * MIN)!.runningSince).toBe(6 * MIN);
  });
  it('per_match: keeps the elapsed time', () => {
    const c = started(10, 0);
    const n = clockForNextSet(c, 1, 3 * MIN);
    expect(n.elapsedMs).toBe(3 * MIN);
    expect(isClockRunning(n)).toBe(false);
  });  it('undoing a per_set transition restores the elapsed time of the reopened set (not a fresh clock)', () => {
    const c = { ...started(10, 0), unit: 'per_set' as const };
    const n = clockForNextSet(c, 1, 4 * MIN);
    expect(clockFrom(JSON.parse(JSON.stringify(n)))!.prevSetElapsedMs).toBe(4 * MIN);
    const back = clockForUndoneSet(clockFrom(n)!, 0);
    expect(back).toMatchObject({ setIndex: 0, elapsedMs: 4 * MIN, started: true });
    expect(clockRemainingMs(back, 0)).toBe(6 * MIN);
  });
  it('undoing a per_match transition keeps the same clock and only moves the set index back', () => {
    const n = clockForNextSet(started(10, 0), 1, 3 * MIN);
    expect(clockForUndoneSet(n, 0)).toMatchObject({ setIndex: 0, elapsedMs: 3 * MIN });
  });
});

describe('time-decided sets count everywhere results are read', () => {
  it('standings count a 5:3 time-limit set and the match winner', () => {
    const t = { type: 'individual', rules: { scoring: { individual: { timeLimitSeconds: 600 } } } };
    const m = {
      status: 'completed', type: 'individual', player1Id: 'a', player2Id: 'b',
      sets: [set(11, 4), set(3, 5, { decidedBy: 'time_limit', matchTimeUp: true })],
    };
    const [r] = normalizeResults([m], resultContextFor(t));
    expect(r).toMatchObject({ setsA: 1, setsB: 1, winner: 'b' });
  });

  it('retirement keeps a time-decided set', () => {
    const out = buildRetirementSets([set(5, 3, { decidedBy: 'time_limit' }), set(2, 1)], 1, R, resolveCompetitionRules({}), 'b', 'a');
    expect(out[0]).toMatchObject({ player1Score: 5, player2Score: 3, decidedBy: 'time_limit', winnerId: 'a' });
  });
});

describe('resolver fields', () => {
  it('timeLimitUnit / goldenGoalMode layer through tournament → stage → round and can be cleared', () => {
    const t = {
      type: 'individual',
      rules: { ibsaSanctioned: true, scoring: { individual: { timeLimitSeconds: 1800, timeLimitUnit: 'per_set', goldenGoalMode: 'goal_only' } }, roundScoring: { fromRound: 4, individual: { timeLimitSeconds: 0 } } },
      stages: [
        { id: 'q', type: 'qualifying' },
        { id: 'f', type: 'finals', rules: { scoring: { individual: { goldenGoalMode: '', timeLimitUnit: 'per_match' } } } },
      ],
    };
    expect(resolveCompetitionRules(t).ibsaSanctioned).toBe(true);
    expect(resolveCompetitionRules({}).ibsaSanctioned).toBe(false);
    expect(resolveMatchScoring({ type: 'individual', stageId: 'q' }, t)).toMatchObject({ timeLimitSeconds: 1800, timeLimitUnit: 'per_set', goldenGoalMode: 'goal_only' });
    const f8 = resolveMatchScoring({ type: 'individual', stageId: 'f', roundLabel: '8강' }, t);
    expect(f8).toMatchObject({ timeLimitSeconds: 1800, timeLimitUnit: 'per_match' });
    expect(f8.goldenGoalMode).toBeUndefined(); // "" = 기본값(next_point)
    // 4강부터 시간 제한 없음 (라운드별 규칙)
    expect(resolveMatchScoring({ type: 'individual', stageId: 'f', roundLabel: '4강' }, t).timeLimitSeconds).toBeUndefined();
    // 잘못된 값은 무시
    expect(resolveMatchScoring({ type: 'individual' }, { rules: { scoring: { individual: { timeLimitUnit: 'weird' } } } }).timeLimitUnit).toBeUndefined();
  });
});
