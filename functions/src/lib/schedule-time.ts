/**
 * 스케줄 관련 시간/날짜 순수 헬퍼.
 *
 * handlers/schedule.ts에서 추출. Firebase/DB 의존 없이 단위 테스트 가능.
 */

/** "HH:MM" → 0시부터 분 단위 */
export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 분 단위 → "HH:MM" (24시간 표기, 0-padded) */
export function formatMinutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** YYYY-MM-DD에 days 더한 새 날짜 (음수 가능) */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * "HH:MM" + (선택)날짜를 shiftMinutes만큼 이동.
 * 자정을 넘으면 dateShift(±n일)와 함께 새 시간 반환.
 *
 * - 음수 shift도 지원 (앞당기기)
 * - date가 없으면 dateShift만 계산해서 반환 (호출자가 무시 가능)
 */
export function shiftTime(
  time: string,
  date: string | undefined,
  shiftMinutes: number,
): { time: string; date: string | undefined; dateShift: number } {
  const total0 = parseTimeToMinutes(time) + shiftMinutes;
  let total = total0;
  let dateShift = 0;
  while (total < 0) {
    total += 24 * 60;
    dateShift--;
  }
  while (total >= 24 * 60) {
    total -= 24 * 60;
    dateShift++;
  }
  const newTime = formatMinutesToTime(total);
  const newDate = dateShift !== 0 && date ? addDays(date, dateShift) : date;
  return { time: newTime, date: newDate, dateShift };
}

/**
 * 휴식 시간대(breakStart ≤ time < breakEnd)에 들어가면 breakEnd로 점프.
 * 휴식 정의가 없으면(둘 중 하나라도 < 0) 그대로 반환.
 */
export function skipBreak(timeMinutes: number, breakStart: number, breakEnd: number): number {
  if (breakStart >= 0 && breakEnd >= 0 && timeMinutes >= breakStart && timeMinutes < breakEnd) {
    return breakEnd;
  }
  return timeMinutes;
}
