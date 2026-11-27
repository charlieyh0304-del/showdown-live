import { describe, it, expect } from 'vitest';
import {
  allocateSchedule,
  getNextScheduleDate,
  type RawMatch,
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
    matchDuration: 30,
    scheduleDates: [],
    effectiveStartDate: '2026-04-09',
    ...overrides,
  };
}

const m = (id: string, p1: string, p2: string, extra: Record<string, unknown> = {}): RawMatch => ({
  id, player1Id: p1, player2Id: p2, player1Name: p1.toUpperCase(), player2Name: p2.toUpperCase(), ...extra,
});

/** 대회 규칙: 최소 휴식 30분(기본) */
const TOUR = {};

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
    const r = allocateSchedule([], COURTS, baseSettings(), TOUR);
    expect(r.slots).toHaveLength(0);
    expect(r.skippedCount).toBe(0);
  });

  it('서로 다른 선수 → 두 코트에 동시 배정 (가장 이른 시각)', () => {
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')], COURTS, baseSettings(), TOUR);
    expect(r.slots.map(s => s.scheduledTime)).toEqual(['09:00', '09:00']);
    expect(r.slots[0].courtId).not.toBe(r.slots[1].courtId);
  });

  it('휴식은 앞 경기 종료부터 잰다 (종료→시작, 기본 30분)', () => {
    // p1: 09:00 시작, 30분 경기 → 09:30 종료 → 30분 휴식 → 10:00 이후
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p1', 'p3')], COURTS, baseSettings({ matchDuration: 30 }), TOUR);
    expect(r.slots[0].scheduledTime).toBe('09:00');
    expect(r.slots[1].scheduledTime).toBe('10:00');
  });

  it('경기 시간이 길면 휴식 시작도 늦어진다 (시작→시작 모델 아님)', () => {
    // 45분 경기: 09:45 종료 + 30분 = 10:15 (시작~시작 30분이면 09:30이 나왔을 것)
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p1', 'p3')], COURTS, baseSettings({ matchDuration: 45 }), TOUR);
    expect(r.slots[1].scheduledTime).toBe('10:15');
  });

  it('최소 휴식은 스테이지 규칙(schedule.minRestMinutes)을 쓴다', () => {
    const tour = { rules: { schedule: { minRestMinutes: 60 } }, stages: [{ id: 'fin', rules: { schedule: { minRestMinutes: 15 } } }] };
    const r1 = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p1', 'p3')], COURTS, baseSettings(), tour);
    expect(r1.slots[1].scheduledTime).toBe('10:30');
    const r2 = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p1', 'p3', { stageId: 'fin' })], COURTS, baseSettings(), tour);
    expect(r2.slots[1].scheduledTime).toBe('09:45');
  });

  it('이번 배정에만 쓰는 최소 휴식 지정값', () => {
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p1', 'p3')], COURTS, baseSettings(), TOUR, { minRestOverride: 0 });
    expect(r.slots[1].scheduledTime).toBe('09:30');
  });

  it('단일 코트 → 경기 시간만큼 떨어져 배정', () => {
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')], [COURTS[0]], baseSettings({ matchDuration: 30 }), TOUR);
    expect(r.slots.map(s => s.scheduledTime)).toEqual(['09:00', '09:30']);
  });

  it('휴식 시간대(점심) 자동 점프', () => {
    const settings = baseSettings({ matchDuration: 60, breakStart: 12 * 60, breakEnd: 13 * 60, dayStart: 11 * 60 });
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')], [COURTS[0]], settings, TOUR);
    expect(r.slots.map(s => s.scheduledTime)).toEqual(['11:00', '13:00']);
  });

  it('일 종료 도달 시 다음 날로 롤오버', () => {
    const settings = baseSettings({ dayStart: 18 * 60 + 30, dayEnd: 19 * 60, matchDuration: 60 });
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')], [COURTS[0]], settings, TOUR);
    expect(r.slots[0]).toMatchObject({ scheduledDate: '2026-04-09', scheduledTime: '18:30' });
    expect(r.slots[1]).toMatchObject({ scheduledDate: '2026-04-10', scheduledTime: '09:00' });
  });

  it('scheduleDates 사용 시 다음 사용 가능 날짜로 롤오버', () => {
    const settings = baseSettings({ dayStart: 18 * 60 + 30, dayEnd: 19 * 60, matchDuration: 60, scheduleDates: ['2026-04-09', '2026-04-12'] });
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p3', 'p4')], [COURTS[0]], settings, TOUR);
    expect(r.slots[1].scheduledDate).toBe('2026-04-12');
  });

  it('휴식이 다음 날로 넘어가면 다음 날 시작 시각', () => {
    const settings = baseSettings({ dayStart: 18 * 60, dayEnd: 19 * 60, matchDuration: 30 });
    const r = allocateSchedule([m('m1', 'p1', 'p2'), m('m2', 'p1', 'p3')], COURTS, settings, TOUR);
    // 18:30 종료 + 30분 = 19:00 → 마감 → 다음 날 09:00
    expect(r.slots[1]).toMatchObject({ scheduledDate: '2026-04-10', scheduledTime: '09:00' });
  });

  it('단체전 휴식은 팀 ID와 팀원 전원에 적용된다', () => {
    const matches: RawMatch[] = [
      { id: 'm1', type: 'team', team1Id: 't1', team2Id: 't2', team1Name: 'Alpha', team2Name: 'Beta', team1: { memberIds: ['a', 'b'] }, team2: { memberIds: ['c', 'd'] } },
      // 다른 팀(t3)이지만 선수 a가 겹친다 (랜덤팀 등)
      { id: 'm2', type: 'team', team1Id: 't3', team2Id: 't4', team1Name: 'Gamma', team2Name: 'Delta', team1: { memberIds: ['a', 'e'] }, team2: { memberIds: ['f', 'g'] } },
      { id: 'm3', type: 'team', team1Id: 't5', team2Id: 't6', team1Name: 'E', team2Name: 'F', team1: { memberIds: ['h'] }, team2: { memberIds: ['i'] } },
    ];
    const r = allocateSchedule(matches, COURTS, baseSettings({ matchDuration: 60 }), TOUR);
    const at = Object.fromEntries(r.slots.map(s => [s.matchId, s.scheduledTime]));
    expect(at.m1).toBe('09:00');
    expect(at.m2).toBe('10:30'); // 10:00 종료 + 30분
    expect(at.m3).toBe('09:00');
    expect(r.slots[0].label).toBe('Alpha vs Beta');
  });

  it('대진 선후관계: 4강은 두 8강의 종료 + 휴식 이후 (선수 미정이어도)', () => {
    const qf1 = m('qf1', 'a', 'b');
    const qf2 = m('qf2', 'c', 'd');
    const qf3 = m('qf3', 'e', 'f');
    const qf4 = m('qf4', 'g', 'h');
    const sf1: RawMatch = { id: 'sf1', player1Id: '', player2Id: '', player1Name: '미정', player2Name: '미정', sourceMatch1: 'qf1', sourceMatch2: 'qf2', sourceType: 'winner' };
    // 입력 순서가 뒤바뀌어 있어도 원천 경기를 먼저 배정한다
    const r = allocateSchedule([sf1, qf1, qf2, qf3, qf4], COURTS, baseSettings({ matchDuration: 30 }), TOUR);
    const at = Object.fromEntries(r.slots.map(s => [s.matchId, s.scheduledTime]));
    expect(at.qf1).toBe('09:00');
    expect(at.qf2).toBe('09:00');
    expect(at.qf3).toBe('09:30');
    expect(at.qf4).toBe('09:30');
    // qf1·qf2 09:30 종료 + 30분 → 10:00 (코트는 10:00에 빈다)
    expect(at.sf1).toBe('10:00');
    expect(r.slots.findIndex(s => s.matchId === 'sf1')).toBeGreaterThan(r.slots.findIndex(s => s.matchId === 'qf2'));
  });

  it('대진 선후관계: 같은 배정에서 막 배정된 원천 경기의 종료 + 휴식을 지킨다 (코트가 먼저 비어도)', () => {
    const FOUR: ScheduleCourt[] = [1, 2, 3, 4].map(i => ({ id: `c${i}`, name: `Court ${i}` }));
    const qf = [m('qf1', 'a', 'b'), m('qf2', 'c', 'd'), m('qf3', 'e', 'f'), m('qf4', 'g', 'h')];
    const sf1: RawMatch = { id: 'sf1', player1Id: '', player2Id: '', sourceMatch1: 'qf1', sourceMatch2: 'qf2', sourceType: 'winner' };
    const sf2: RawMatch = { id: 'sf2', player1Id: '', player2Id: '', sourceMatch1: 'qf3', sourceMatch2: 'qf4', sourceType: 'winner' };
    const f: RawMatch = { id: 'f', player1Id: '', player2Id: '', sourceMatch1: 'sf1', sourceMatch2: 'sf2', sourceType: 'winner' };
    // 입력 순서가 뒤섞여 있어도 깊이 순(8강 → 4강 → 결승)으로 배정
    const r = allocateSchedule([f, sf2, sf1, ...qf], FOUR, baseSettings({ matchDuration: 30 }), TOUR);
    const at = Object.fromEntries(r.slots.map(s => [s.matchId, s.scheduledTime]));
    expect([at.qf1, at.qf2, at.qf3, at.qf4]).toEqual(['09:00', '09:00', '09:00', '09:00']);
    // 코트는 09:30에 비지만 8강 09:30 종료 + 30분 휴식 → 10:00
    expect(at.sf1).toBe('10:00');
    expect(at.sf2).toBe('10:00');
    // 4강 10:30 종료 + 30분 → 결승 11:00
    expect(at.f).toBe('11:00');
    expect(r.slots.map(s => s.matchId).slice(-1)).toEqual(['f']);
  });

  it('이미 끝난 원천 경기도 선후관계·휴식에 넣는다', () => {
    const qf1 = m('qf1', 'a', 'b', { scheduledDate: '2026-04-09', scheduledTime: '11:00', status: 'completed', winnerId: 'a' });
    const qf2 = m('qf2', 'c', 'd', { scheduledDate: '2026-04-09', scheduledTime: '10:00', status: 'completed', winnerId: 'c' });
    const sf1: RawMatch = { id: 'sf1', player1Id: 'a', player2Id: 'c', sourceMatch1: 'qf1', sourceMatch2: 'qf2' };
    const r = allocateSchedule([sf1], COURTS, baseSettings(), TOUR, { allMatches: [qf1, qf2, sf1] });
    expect(r.slots[0].scheduledTime).toBe('12:00'); // qf1 11:30 종료 + 30분 (09:00 아님)
  });

  it('이미 일정이 있는 원천 경기도 선후관계에 넣는다 (미배정만 배정)', () => {
    const qf1 = m('qf1', 'a', 'b', { scheduledDate: '2026-04-09', scheduledTime: '11:00', status: 'pending' });
    const sf1: RawMatch = { id: 'sf1', player1Id: '', player2Id: '', sourceMatch1: 'qf1', sourceMatch2: 'qf2' };
    const r = allocateSchedule([sf1], COURTS, baseSettings(), TOUR, { allMatches: [qf1, sf1] });
    expect(r.slots[0].scheduledTime).toBe('12:00'); // 11:30 종료 + 30분
  });

  it('label은 player 이름 우선, 없으면 team 이름 / status 보존', () => {
    const r = allocateSchedule([
      { id: 'm1', player1Id: 'p1', player2Id: 'p2', player1Name: 'Alice', player2Name: 'Bob' },
      { id: 'm2', player1Id: 'p3', player2Id: 'p4', status: 'in_progress' },
    ], COURTS, baseSettings(), TOUR);
    expect(r.slots[0].label).toBe('Alice vs Bob');
    expect(r.slots[0].status).toBe('pending');
    expect(r.slots[1].status).toBe('in_progress');
  });
});
