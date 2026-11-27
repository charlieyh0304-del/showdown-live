import { describe, it, expect } from 'vitest';
import type { Match, ScheduleSlot } from '@shared/types';
import {
  buildScheduleRows, courtBoard, EMPTY_SCHEDULE_FILTER, filterFromParams, filterScheduleRows, filterToParams,
  groupProgress, isDelayed, isPlayableMatch, liveOverview, nextMatchRows,
} from './spectatorData';

const M = (o: Partial<Match> & { id: string }): Match => ({ type: 'individual', status: 'pending', ...o } as Match);

describe('schedule rows, filters and next matches', () => {
  const day = '2026-11-28';
  const matches = [
    M({ id: 'g1', groupId: 'A', player1Id: 'p1', player1Name: '김철수', player2Id: 'p2', player2Name: '이영희', status: 'completed', scheduledDate: day, scheduledTime: '09:00', courtId: 'c1', courtName: '1코트' }),
    M({ id: 'g2', groupId: 'A', player1Id: 'p1', player1Name: '김철수', player2Id: 'p3', player2Name: '박민수', scheduledDate: day, scheduledTime: '10:00', courtId: 'c1', courtName: '1코트' }),
    M({ id: 'g3', groupId: 'B', player1Id: 'p4', player1Name: '최지원', player2Id: 'p5', player2Name: '정하늘', status: 'in_progress', scheduledDate: day, scheduledTime: '10:00', courtId: 'c2', courtName: '2코트' }),
    // 아직 대진이 정해지지 않은 결승 (앞 경기 승자 자리)
    M({ id: 'f1', stageId: 'finals', roundLabel: '결승', sourceMatch1: 'g2', sourceMatch2: 'g3' } as Partial<Match> & { id: string }),
    M({ id: 'bye', groupId: 'B', player1Id: 'p4', player1Name: '최지원', player2Id: 'BYE', isBye: true } as Partial<Match> & { id: string }),
    // BYE 표시가 빠진 BYE 경기도 치를 경기로 보지 않는다
    M({ id: 'bye2', groupId: 'B', player1Id: '', player1Name: '', player2Id: 'BYE', player2Name: 'BYE' }),
  ];
  const schedule: ScheduleSlot[] = [{ id: 's1', matchId: 'f1', scheduledDate: day, scheduledTime: '13:00', courtId: 'c2', courtName: '2코트' } as ScheduleSlot];
  const rows = buildScheduleRows(matches, schedule);

  it('drops BYE matches (flagged or not), keeps undecided bracket slots, uses schedule slots for time/court', () => {
    expect(rows.map(r => r.match.id)).toEqual(['g1', 'g2', 'g3', 'f1']);
    expect(isPlayableMatch(matches[5])).toBe(false);
    const f1 = rows.find(r => r.match.id === 'f1')!;
    expect(f1.court.name).toBe('2코트');
    expect(f1.time.time).toBe('13:00');
  });

  it('combines filters, including favorites only, and round-trips them through the URL', () => {
    const f = { ...EMPTY_SCHEDULE_FILTER, court: 'c1', favoritesOnly: true, status: 'remaining' as const };
    expect(filterScheduleRows(rows, f, ['p1']).map(r => r.match.id)).toEqual(['g2']);
    expect(filterScheduleRows(rows, { ...EMPTY_SCHEDULE_FILTER, stage: 'group:B' }, []).map(r => r.match.id)).toEqual(['g3']);
    expect(filterScheduleRows(rows, { ...EMPTY_SCHEDULE_FILTER, status: 'completed' }, []).map(r => r.match.id)).toEqual(['g1']);
    expect(filterScheduleRows(rows, { ...EMPTY_SCHEDULE_FILTER, favoritesOnly: true }, [])).toEqual([]);
    expect(filterFromParams(filterToParams(f))).toEqual(f);
  });

  it('next matches are sorted from now, including the undecided finals slot', () => {
    const now = new Date(`${day}T09:30:00`).getTime();
    expect(nextMatchRows(rows, now).map(r => r.match.id)).toEqual(['g2', 'f1']);
  });

  it('matches running more than 30 minutes late stay first and are marked delayed, not dropped', () => {
    const now = new Date(`${day}T10:45:00`).getTime(); // g2 예정 10:00 → 45분 지연
    const next = nextMatchRows(rows, now);
    expect(next.map(r => r.match.id)).toEqual(['g2', 'f1']);
    expect(isDelayed(next[0], now)).toBe(true);
    expect(isDelayed(next[1], now)).toBe(false);
    expect(liveOverview(rows, now).upcoming.map(r => r.match.id)).toContain('g2');
    expect(courtBoard(rows, now).find(e => e.court.id === 'c1')!.next!.match.id).toBe('g2');
    // 직접 grace를 주면 그보다 더 지난 경기만 뺀다
    expect(nextMatchRows(rows, now, { graceMs: 30 * 60_000 }).map(r => r.match.id)).toEqual(['f1']);
  });

  it('a group with unfinished matches is provisional; BYE does not count', () => {
    expect(groupProgress(matches)).toEqual([
      { groupId: 'A', total: 2, completed: 1, inProgress: 0, provisional: true },
      { groupId: 'B', total: 1, completed: 0, inProgress: 1, provisional: true },
    ]);
    expect(groupProgress([matches[0]])[0].provisional).toBe(false);
  });
});
