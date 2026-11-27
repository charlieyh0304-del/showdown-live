import { describe, it, expect } from 'vitest';
import { nextClockAnnouncement, type ClockAnnounceState } from './matchClockFormat';

const MIN = 60_000;
const run = (remainingMs: number) => ({ remainingMs, running: true, expired: false, golden: null });

/** 관찰을 차례로 넣고 알림만 모은다 */
function feed(obs: Array<Parameters<typeof nextClockAnnouncement>[1]>) {
  let prev: ClockAnnounceState | null = null;
  const out: Array<string | null> = [];
  for (const o of obs) {
    const r = nextClockAnnouncement(prev, o);
    prev = r.state;
    out.push(r.announce);
  }
  return out;
}

describe('nextClockAnnouncement (spectator aria-live)', () => {
  it('says nothing on the first observation, even when already expired or in golden goal', () => {
    expect(feed([run(10_000)])).toEqual([null]);
    expect(feed([{ remainingMs: 0, running: false, expired: true, golden: null }])).toEqual([null]);
    expect(feed([{ remainingMs: 0, running: false, expired: true, golden: 'coin_toss' }])).toEqual([null]);
  });

  it('announces each milestone once', () => {
    expect(feed([run(5 * MIN + 500), run(5 * MIN - 100), run(5 * MIN - 600), run(61_000), run(59_000), run(31_000), run(29_000), run(20_000)]))
      .toEqual([null, 'alert5min', null, null, 'alert1min', null, 'alert30s', null]);
  });

  it('announces the end when the referee expiry arrives before this screen saw 0', () => {
    expect(feed([run(1_200), { remainingMs: 0, running: false, expired: true, golden: null }])).toEqual([null, 'expired']);
  });

  it('does not announce the end twice (tick at 0, then the expired write)', () => {
    expect(feed([run(400), run(0), { remainingMs: 0, running: false, expired: true, golden: null }])).toEqual([null, 'expired', null]);
  });

  it('a tie at expiry announces golden goal instead of the end', () => {
    expect(feed([run(400), { remainingMs: 0, running: false, expired: true, golden: 'coin_toss' }, { remainingMs: 0, running: false, expired: true, golden: 'playing' }]))
      .toEqual([null, 'golden', 'golden']);
  });

  it('a fresh per_set clock can announce its own end again', () => {
    expect(feed([
      run(400), { remainingMs: 0, running: false, expired: true, golden: null },
      { remainingMs: 10 * MIN, running: false, expired: false, golden: null }, run(300),
      { remainingMs: 0, running: false, expired: true, golden: null },
    ])).toEqual([null, 'expired', null, null, 'expired']);
  });
});
