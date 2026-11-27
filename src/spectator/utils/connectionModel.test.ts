import { describe, it, expect } from 'vitest';
import { tFor, RAW_KEY } from '@shared/i18n/testing';
import { connectionModel, describeConnection, formatAgo, STALE_AFTER_MS } from './connectionModel';

const ko = tFor('ko');
const en = tFor('en');

describe('connectionModel (연결 상태 줄)', () => {
  const now = new Date('2026-11-28T10:30:00').getTime();

  it('formats N분 전 and marks data stale exactly at the boundary', () => {
    expect(formatAgo(0, ko)).toBe('방금');
    expect(formatAgo(5, ko)).toBe('5분 전');
    expect(formatAgo(60, ko)).toBe('1시간 전');
    expect(formatAgo(75, ko)).toBe('1시간 15분 전');
    const just = connectionModel({ connected: false, lastUpdateAt: now - STALE_AFTER_MS + 1, usingCache: false, now });
    const stale = connectionModel({ connected: false, lastUpdateAt: now - STALE_AFTER_MS, usingCache: false, now });
    expect(just.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.kind).toBe('reconnecting');
    expect(stale.minutesAgo).toBe(2);
    expect(describeConnection(stale, ko)).toContain('2분 전');
  });

  it('live is never stale; cached data names its time; nothing reads as a raw key', () => {
    const live = connectionModel({ connected: true, lastUpdateAt: now - 10 * 60_000, usingCache: false, now });
    expect(live.stale).toBe(false);
    const cached = connectionModel({ connected: null, lastUpdateAt: null, usingCache: true, cacheSavedAt: now - 30 * 60_000, now });
    expect(cached.kind).toBe('cached');
    expect(describeConnection(cached, ko)).toContain('10:00');
    expect(describeConnection(cached, ko)).toContain('30분 전');
    const models = [
      live, cached,
      connectionModel({ connected: null, lastUpdateAt: null, usingCache: false, now }),
      connectionModel({ connected: false, lastUpdateAt: now - 60_000, usingCache: false, now }),
      connectionModel({ connected: null, lastUpdateAt: null, usingCache: true, cacheSavedAt: null, now }),
    ];
    for (const t of [ko, en]) for (const m of models) expect(describeConnection(m, t)).not.toMatch(RAW_KEY);
  });
});
