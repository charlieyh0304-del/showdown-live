import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, normalizeNotificationSettings, shouldNotify } from './useNotificationSettings';

describe('normalizeNotificationSettings (기본 꺼짐 + 예전 푸시 구독 기기 유지)', () => {
  it('no stored settings and no push token: off', () => {
    const s = normalizeNotificationSettings(null, false);
    expect(s.enabled).toBe(false);
    expect(s.types.matchStart).toBe(false);
    expect(shouldNotify(s, 'p1', 'preMatch')).toBe(false);
  });

  it('no stored settings but an existing push token (older version opted in): on', () => {
    const s = normalizeNotificationSettings(null, true);
    expect(s.enabled).toBe(true);
    expect(s.types).toEqual({ preMatch: true, matchStart: true, matchComplete: true });
  });

  it("old stored settings keep the user's choices and fill new fields with defaults", () => {
    const old = { enabled: true, types: { preMatch: false, matchStart: true, matchComplete: true }, quietHours: { enabled: true, start: '23:00', end: '07:00' }, perPlayer: { p1: { enabled: false, types: { preMatch: true, matchStart: true, matchComplete: true } } } };
    const s = normalizeNotificationSettings(old, false);
    expect(s.enabled).toBe(true);
    expect(s.types).toEqual(old.types);
    expect(s.quietHours).toEqual(old.quietHours);
    expect(s.perPlayer).toEqual(old.perPlayer);
    expect(s.resultSound).toBe(false);
    expect(s.resultSoundFavoritesOnly).toBe(true);
    // 사용자가 끈 값은 토큰이 있어도 켜지 않는다
    expect(normalizeNotificationSettings({ enabled: false }, true).enabled).toBe(false);
  });

  it('garbage values give the defaults', () => {
    expect(normalizeNotificationSettings('garbage', false)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeNotificationSettings(42, false)).toEqual(DEFAULT_SETTINGS);
    const s = normalizeNotificationSettings({ enabled: 'yes', types: null, quietHours: null }, false);
    expect(s.enabled).toBe(false);
    expect(s.types).toEqual(DEFAULT_SETTINGS.types);
    expect(s.quietHours).toEqual(DEFAULT_SETTINGS.quietHours);
  });
});
