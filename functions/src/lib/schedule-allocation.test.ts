import { describe, it, expect } from 'vitest';
import {
  allocateSchedule,
  getNextScheduleDate,
  type ScheduleMatch,
  type ScheduleCourt,
  type ScheduleSettings,
} from './schedule-allocation';

const COURTS: ScheduleCourt[] = [
  { id: 'c1', name: 'Court 1' },
  { id: 'c2', name: 'Court 2' },
];

function baseSettings(overrides: Partial<ScheduleSettings> = {}): ScheduleSettings {
  return {
    dayStart: 9 * 60,        // 09:00
    dayEnd: 19 * 60,         // 19:00
    nextDayStartMin: 9 * 60, // 09:00
    breakStart: -1,
    breakEnd: -1,
    interval: 30,
    playerRest: 60,
    scheduleDates: [],
    effectiveStartDate: '2026-04-09',
    ...overrides,
  };
}

const m = (id: string, p1: string, p2: string): ScheduleMatch => ({
  id, player1Id: p1, player2Id: p2, player1Name: p1.toUpperCase(), player2Name: p2.toUpperCase(),
});

describe('getNextScheduleDate', () => {
  it('scheduleDates 비어있으면 +1일', () => {
    expect(getNextScheduleDate('2026-04-09', [])).toBe('2026-04-10');
  });
  it('scheduleDates에서 다음 항목 선택', () => {
    expect(getNextScheduleDate('2026-04-09', ['2026-04-09', '2026-04-12', '2026-04-15'])).toBe('2026-04-12');
  });
  it('scheduleDates에 다음이 없으면 +1일 폴백', () => {
    expect(getNextScheduleDate('2026-04-15', ['2026-04-09', '2026-04-15'])).toBe('2026-04-16');
  });
});

describe('allocateSchedule', () => {
  it('빈 매치 → 빈 결과', () => {
    const r = allocateSchedule([], COURTS, baseSettings());
    expect(r.slots).toHaveLength(0);
    expect(r.skippedCount).toBe(0);
  });

  it('서로 다른 선수 → 두 코트에 동시 배정 (가장 이른 시각)', () => {
    const matches = [m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')];
    const r = allocateSchedule(matches, COURTS, baseSettings());
    expect(r.slots).toHaveLength(2);
    expect(r.slots[0].scheduledTime).toBe('09:00');
    expect(r.slots[1].scheduledTime).toBe('09:00');
    expect(r.slots[0].courtId).not.toBe(r.slots[1].courtId);
  });

  it('같은 선수의 연속 경기 → playerRest만큼 휴식', () => {
    const matches = [m('m1', 'p1', 'p2'), m('m2', 'p1', 'p3')];
    const r = allocateSchedule(matches, COURTS, baseSettings({ playerRest: 60 }));
    expect(r.slots[0].scheduledTime).toBe('09:00');
    // p1이 09:00 시작 → 60분 휴식 → 다음 슬롯은 10:00 이후
    expect(r.slots[1].scheduledTime).toBe('10:00');
  });

  it('단일 코트 → interval 만큼 떨어져 배정', () => {
    const matches = [m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')];
    const r = allocateSchedule(matches, [COURTS[0]], baseSettings({ interval: 30 }));
    expect(r.slots[0].scheduledTime).toBe('09:00');
    expect(r.slots[1].scheduledTime).toBe('09:30');
    expect(r.slots[0].courtId).toBe('c1');
    expect(r.slots[1].courtId).toBe('c1');
  });

  it('휴식 시간대(점심) 자동 점프', () => {
    // 단일 코트, 12:00~13:00 점심
    const settings = baseSettings({
      interval: 60,
      breakStart: 12 * 60,
      breakEnd: 13 * 60,
      dayStart: 11 * 60,
    });
    const matches = [
      m('m1', 'p1', 'p2'), // 11:00
      m('m2', 'p3', 'p4'), // 12:00 → 점심으로 13:00 점프
    ];
    const r = allocateSchedule(matches, [COURTS[0]], settings);
    expect(r.slots[0].scheduledTime).toBe('11:00');
    expect(r.slots[1].scheduledTime).toBe('13:00');
  });

  it('일 종료 도달 시 다음 날로 롤오버', () => {
    const settings = baseSettings({
      dayStart: 18 * 60 + 30,  // 18:30
      dayEnd: 19 * 60,         // 19:00
      interval: 60,
    });
    const matches = [m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')];
    const r = allocateSchedule(matches, [COURTS[0]], settings);
    expect(r.slots[0].scheduledDate).toBe('2026-04-09');
    expect(r.slots[0].scheduledTime).toBe('18:30');
    expect(r.slots[1].scheduledDate).toBe('2026-04-10');
    expect(r.slots[1].scheduledTime).toBe('09:00');
  });

  it('scheduleDates 사용 시 다음 사용 가능 날짜로 롤오버', () => {
    const settings = baseSettings({
      dayStart: 18 * 60 + 30,
      dayEnd: 19 * 60,
      interval: 60,
      scheduleDates: ['2026-04-09', '2026-04-12'],
      effectiveStartDate: '2026-04-09',
    });
    const matches = [m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')];
    const r = allocateSchedule(matches, [COURTS[0]], settings);
    expect(r.slots[1].scheduledDate).toBe('2026-04-12');
  });

  it('팀 매치도 동일하게 처리 (team1Id/team2Id)', () => {
    const matches: ScheduleMatch[] = [
      { id: 'm1', team1Id: 't1', team2Id: 't2', team1Name: 'Alpha', team2Name: 'Beta' },
      { id: 'm2', team1Id: 't1', team2Id: 't3', team1Name: 'Alpha', team2Name: 'Gamma' },
    ];
    const r = allocateSchedule(matches, [COURTS[0]], baseSettings({ playerRest: 60 }));
    expect(r.slots[0].label).toBe('Alpha vs Beta');
    // t1 충돌 → 휴식 적용
    expect(r.slots[1].scheduledTime).toBe('10:00');
  });

  it('label은 player 이름 우선, 없으면 team 이름', () => {
    const matches: ScheduleMatch[] = [
      { id: 'm1', player1Id: 'p1', player2Id: 'p2', player1Name: 'Alice', player2Name: 'Bob' },
    ];
    const r = allocateSchedule(matches, COURTS, baseSettings());
    expect(r.slots[0].label).toBe('Alice vs Bob');
  });

  it('status 없으면 pending 기본값', () => {
    const matches: ScheduleMatch[] = [
      { id: 'm1', player1Id: 'p1', player2Id: 'p2' },
    ];
    const r = allocateSchedule(matches, COURTS, baseSettings());
    expect(r.slots[0].status).toBe('pending');
  });

  it('status 보존', () => {
    const matches: ScheduleMatch[] = [
      { id: 'm1', player1Id: 'p1', player2Id: 'p2', status: 'in_progress' },
    ];
    const r = allocateSchedule(matches, COURTS, baseSettings());
    expect(r.slots[0].status).toBe('in_progress');
  });
});
