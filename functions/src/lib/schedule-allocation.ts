/**
 * 스케줄 슬롯 할당 순수 로직.
 *
 * handlers/schedule.ts의 generateSchedule 코어를 추출.
 * Firebase 의존 없이 순수 입력 → 순수 출력. 단위 테스트 가능.
 *
 * 알고리즘:
 *  - 매 경기마다 가능한 모든 코트 후보 시간을 계산하고 가장 빠른 것 선택
 *  - 같은 선수/팀이 연속 경기 시 playerRest 만큼 휴식 보장
 *  - dayEnd 도달 시 다음 가능 날짜로 롤오버
 *  - breakStart~breakEnd 시간대는 자동 점프
 */

import { addDays, skipBreak } from './schedule-time';

export interface ScheduleMatch {
  id: string;
  player1Id?: string | unknown;
  player2Id?: string | unknown;
  team1Id?: string | unknown;
  team2Id?: string | unknown;
  player1Name?: string | unknown;
  player2Name?: string | unknown;
  team1Name?: string | unknown;
  team2Name?: string | unknown;
  status?: string | unknown;
}

export interface ScheduleCourt {
  id: string;
  name: string;
}

export interface ScheduleSettings {
  /** "HH:MM"을 분으로 환산한 dayStart (첫째 날 시작) */
  dayStart: number;
  /** dayEnd (이 시간 이상이면 롤오버) */
  dayEnd: number;
  /** 다음 날 시작 시간 (분) */
  nextDayStartMin: number;
  /** 휴식 시작 (분, -1=비활성) */
  breakStart: number;
  /** 휴식 종료 (분, -1=비활성) */
  breakEnd: number;
  /** 경기 간격 (분) — 같은 코트 다음 경기까지 */
  interval: number;
  /** 같은 선수/팀의 휴식 시간 (분) */
  playerRest: number;
  /** 사용 가능한 날짜 목록 (YYYY-MM-DD, 정렬 가정). 비어 있으면 +1일씩 자동 진행 */
  scheduleDates: string[];
  /** 첫 슬롯이 시작되는 날짜 (YYYY-MM-DD) */
  effectiveStartDate: string;
}

export interface ScheduleSlot {
  matchId: string;
  courtId: string;
  courtName: string;
  scheduledTime: string;
  scheduledDate: string;
  label: string;
  status: string;
}

export interface AllocationResult {
  slots: ScheduleSlot[];
  skippedCount: number;
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function getPlayerIds(m: ScheduleMatch): string[] {
  const ids: string[] = [];
  if (m.player1Id) ids.push(asStr(m.player1Id));
  if (m.player2Id) ids.push(asStr(m.player2Id));
  if (m.team1Id) ids.push(asStr(m.team1Id));
  if (m.team2Id) ids.push(asStr(m.team2Id));
  return ids.filter(Boolean);
}

function fmtMin(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * 다음 사용 가능 날짜 — scheduleDates에 currentDate 다음 항목이 있으면 사용,
 * 없으면 +1일.
 */
export function getNextScheduleDate(currentDate: string, scheduleDates: string[]): string {
  if (scheduleDates.length > 0) {
    const next = scheduleDates.find(d => d > currentDate);
    return next || addDays(currentDate, 1);
  }
  return addDays(currentDate, 1);
}

/**
 * 메인 슬롯 할당 알고리즘.
 *
 * 경기 목록의 순서대로 가장 이른 가능한 코트/시간에 배정.
 * 동일 선수의 playerRest와 코트별 interval, 휴식 시간(skipBreak), 일일 종료를 고려.
 */
export function allocateSchedule(
  matches: ScheduleMatch[],
  courts: ScheduleCourt[],
  settings: ScheduleSettings,
): AllocationResult {
  const { dayEnd, nextDayStartMin, breakStart, breakEnd, interval, playerRest, scheduleDates, effectiveStartDate } = settings;

  const courtSlots = courts.map(c => ({
    courtId: c.id,
    courtName: c.name,
    date: effectiveStartDate,
    time: settings.dayStart,
  }));

  const playerLastEnd = new Map<string, { date: string; time: number }>();
  const sb = (t: number) => skipBreak(t, breakStart, breakEnd);
  const nextDate = (d: string) => getNextScheduleDate(d, scheduleDates);

  const slots: ScheduleSlot[] = [];
  let skippedCount = 0;

  for (const match of matches) {
    const playerIds = getPlayerIds(match);
    let bestCourtIdx = -1;
    let bestDate = effectiveStartDate;
    let bestTime = Infinity;

    for (let ci = 0; ci < courtSlots.length; ci++) {
      const court = courtSlots[ci];
      let candidateDate = court.date;
      let candidateTime = sb(court.time);

      for (const pid of playerIds) {
        const last = playerLastEnd.get(pid);
        if (last) {
          if (last.date === candidateDate && last.time > candidateTime) {
            candidateTime = sb(last.time);
          } else if (last.date > candidateDate) {
            candidateDate = last.date;
            candidateTime = sb(Math.max(nextDayStartMin, last.time));
          }
        }
      }

      candidateTime = sb(candidateTime);

      if (candidateTime >= dayEnd) {
        candidateDate = nextDate(candidateDate);
        candidateTime = sb(nextDayStartMin);
      }

      const candidateTotal = new Date(candidateDate).getTime() + candidateTime;
      const bestTotal = new Date(bestDate).getTime() + bestTime;
      if (bestCourtIdx === -1 || candidateTotal < bestTotal) {
        bestCourtIdx = ci;
        bestDate = candidateDate;
        bestTime = candidateTime;
      }
    }

    if (bestCourtIdx === -1) { skippedCount++; continue; }

    if (bestTime >= dayEnd) {
      bestDate = nextDate(bestDate);
      bestTime = sb(nextDayStartMin);
    }

    const court = courtSlots[bestCourtIdx];
    const label = `${asStr(match.player1Name) || asStr(match.team1Name)} vs ${asStr(match.player2Name) || asStr(match.team2Name)}`;

    slots.push({
      matchId: match.id,
      courtId: court.courtId,
      courtName: court.courtName,
      scheduledTime: fmtMin(bestTime),
      scheduledDate: bestDate,
      label,
      status: asStr(match.status) || 'pending',
    });

    const courtEndTime = bestTime + interval;
    if (courtEndTime >= dayEnd) {
      court.date = nextDate(bestDate);
      court.time = nextDayStartMin;
    } else {
      court.date = bestDate;
      court.time = courtEndTime;
    }

    const playerEndTime = bestTime + playerRest;
    const playerEnd = playerEndTime >= dayEnd
      ? { date: nextDate(bestDate), time: nextDayStartMin }
      : { date: bestDate, time: playerEndTime };
    for (const pid of playerIds) {
      playerLastEnd.set(pid, playerEnd);
    }
  }

  return { slots, skippedCount };
}
