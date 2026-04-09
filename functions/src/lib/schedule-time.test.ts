import { describe, it, expect } from 'vitest';
import {
  parseTimeToMinutes,
  formatMinutesToTime,
  addDays,
  shiftTime,
  skipBreak,
} from './schedule-time';

describe('parseTimeToMinutes', () => {
  it('파싱 기본', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });
});

describe('formatMinutesToTime', () => {
  it('포맷 기본 (0-padded)', () => {
    expect(formatMinutesToTime(0)).toBe('00:00');
    expect(formatMinutesToTime(570)).toBe('09:30');
    expect(formatMinutesToTime(1439)).toBe('23:59');
  });
});

describe('addDays', () => {
  it('양수/음수/0', () => {
    expect(addDays('2026-04-09', 1)).toBe('2026-04-10');
    expect(addDays('2026-04-09', -1)).toBe('2026-04-08');
    expect(addDays('2026-04-09', 0)).toBe('2026-04-09');
  });
  it('월 경계 넘기', () => {
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-05-01', -1)).toBe('2026-04-30');
  });
});

describe('shiftTime', () => {
  it('당일 양수 이동', () => {
    const r = shiftTime('09:30', '2026-04-09', 60);
    expect(r.time).toBe('10:30');
    expect(r.date).toBe('2026-04-09');
    expect(r.dateShift).toBe(0);
  });

  it('당일 음수 이동', () => {
    const r = shiftTime('09:30', '2026-04-09', -90);
    expect(r.time).toBe('08:00');
    expect(r.dateShift).toBe(0);
  });

  it('자정 넘김 (다음날로)', () => {
    const r = shiftTime('23:30', '2026-04-09', 60);
    expect(r.time).toBe('00:30');
    expect(r.date).toBe('2026-04-10');
    expect(r.dateShift).toBe(1);
  });

  it('자정 이전으로 (전날로)', () => {
    const r = shiftTime('00:30', '2026-04-09', -60);
    expect(r.time).toBe('23:30');
    expect(r.date).toBe('2026-04-08');
    expect(r.dateShift).toBe(-1);
  });

  it('date 없으면 dateShift만 계산', () => {
    const r = shiftTime('23:30', undefined, 60);
    expect(r.time).toBe('00:30');
    expect(r.date).toBeUndefined();
    expect(r.dateShift).toBe(1);
  });

  it('여러 날 점프', () => {
    const r = shiftTime('09:00', '2026-04-09', 24 * 60 * 2 + 30);
    expect(r.time).toBe('09:30');
    expect(r.dateShift).toBe(2);
    expect(r.date).toBe('2026-04-11');
  });
});

describe('skipBreak', () => {
  it('휴식 시간대 안: end로 점프', () => {
    expect(skipBreak(720, 720, 780)).toBe(780); // 12:00, break 12:00-13:00 → 13:00
    expect(skipBreak(750, 720, 780)).toBe(780); // 12:30 → 13:00
  });
  it('휴식 시간대 밖: 그대로', () => {
    expect(skipBreak(700, 720, 780)).toBe(700);
    expect(skipBreak(780, 720, 780)).toBe(780); // 경계: end는 포함 안 됨
    expect(skipBreak(900, 720, 780)).toBe(900);
  });
  it('휴식 정의 없음(-1): no-op', () => {
    expect(skipBreak(720, -1, -1)).toBe(720);
    expect(skipBreak(720, -1, 780)).toBe(720);
    expect(skipBreak(720, 720, -1)).toBe(720);
  });
});
