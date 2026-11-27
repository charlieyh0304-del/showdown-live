// 자동 생성 사본: 원본은 src/shared/rules/. 직접 고치지 말고 node scripts/sync-shared-rules.mjs를 실행하세요.
/**
 * 자동 일정 배정 (M0g, docs/05 B6·H3·H6, docs/06 소유자 요구).
 *
 * - 선수 휴식은 앞 경기 *종료* 예정 시각(시작 + 경기 시간)부터 다음 경기 *시작*까지로 잰다(시작~시작 아님).
 *   최소 휴식은 다음 경기 스테이지의 규칙 resolveCompetitionRules(t, stageId).schedule.minRestMinutes(기본 30분)이고,
 *   배정 화면·챗봇에서 이번 배정에만 다른 값으로 바꿀 수 있다.
 * - 단체전은 팀 ID와 팀원 ID 모두에 휴식을 적용한다(랜덤팀처럼 한 선수가 여러 팀에 있어도 지킨다).
 * - 대진 선후관계: sourceMatch1/2에서 선수가 오는 경기는 두 원천 경기의 종료 + 최소 휴식 이후에 시작한다.
 *   선수가 아직 미정(자리 표시)이어도 원천 경기로 휴식을 지킨다. 원천 경기를 먼저 배정하도록 순서를 맞춘다.
 * - 이번에 배정하지 않는 경기(이미 일정이 있는 경기, 끝난 경기 포함)는 고정 점유로 보고 휴식·선후관계에 넣는다.
 *
 * 순수 모듈 (Firebase 의존 없음). functions/src/shared/rules/scheduling.ts는 이 파일의 사본이다.
 * 클라이언트 ScheduleTab과 서버 generate_schedule이 같은 함수를 쓴다.
 */
import { isObject, resolveCompetitionRules, toList, type TournamentLike } from './competitionRules';

export interface AllocMatch {
  id: string;
  /** 휴식을 지켜야 하는 참가자 ID (선수/팀 ID와 팀원 ID) */
  participantIds: string[];
  /** 이 경기의 선수가 나오는 원천 경기 ID (sourceMatch1/2) */
  sourceMatchIds: string[];
  /** 이 경기 전에 지켜야 하는 최소 휴식(분): 앞 경기 종료 → 이 경기 시작 */
  minRestBefore: number;
  label: string;
  status: string;
}

/** 이번에 배정하지 않는(이미 일정이 있는) 경기 */
export interface FixedMatch {
  id: string;
  participantIds: string[];
  date: string;
  /** 시작 시각(0시부터 분) */
  start: number;
}

export interface AllocCourt {
  id: string;
  name: string;
}

export interface AllocSettings {
  /** 첫째 날 시작(분) */
  dayStart: number;
  /** 하루 마감(분): 이 시각 이상에 시작하는 경기는 다음 날로 */
  dayEnd: number;
  /** 다음 날 시작(분) */
  nextDayStartMin: number;
  /** 휴식(점심) 시작/종료(분, -1 = 없음) */
  breakStart: number;
  breakEnd: number;
  /** 경기 시간(분) = 같은 코트 다음 경기까지의 간격. 선수 휴식은 이 시간이 끝난 뒤부터 잰다. */
  matchDuration: number;
  /** 사용 가능한 날짜 (YYYY-MM-DD, 정렬). 비어 있으면 +1일씩 */
  scheduleDates: string[];
  /** 첫 슬롯 날짜 */
  effectiveStartDate: string;
}

export interface AllocSlot {
  matchId: string;
  courtId: string;
  courtName: string;
  scheduledTime: string;
  scheduledDate: string;
  label: string;
  status: string;
}

export interface AllocResult {
  slots: AllocSlot[];
  skippedCount: number;
}

interface At { date: string; t: number }

export function formatMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function parseMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** YYYY-MM-DD + days (UTC 기준 정수 날짜 연산) */
export function addDaysYmd(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 다음 사용 가능 날짜: scheduleDates에 다음 항목이 있으면 그것, 없으면 +1일 */
export function nextScheduleDate(current: string, scheduleDates: readonly string[]): string {
  if (scheduleDates.length > 0) {
    const next = scheduleDates.find(d => d > current);
    return next || addDaysYmd(current, 1);
  }
  return addDaysYmd(current, 1);
}

function later(a: At, b: At): At {
  if (a.date !== b.date) return a.date > b.date ? a : b;
  return a.t >= b.t ? a : b;
}

function before(a: At, b: At): boolean {
  return a.date < b.date || (a.date === b.date && a.t < b.t);
}

/**
 * 원천 경기를 먼저 오도록 정렬한다: 대진 깊이(원천 경기 사슬 길이, 8강 0 → 4강 1 → 결승 2) 순, 같은 깊이는 입력 순서.
 * 라운드가 섞이지 않고 앞 라운드가 먼저 배정된다. 순환 링크는 무시한다.
 */
export function orderByDependencies<M extends { id: string; sourceMatchIds: readonly string[] }>(matches: readonly M[]): M[] {
  const byId = new Map(matches.map(m => [m.id, m]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (m: M): number => {
    const known = depth.get(m.id);
    if (known !== undefined) return known;
    if (visiting.has(m.id)) return 0;
    visiting.add(m.id);
    let d = 0;
    for (const sid of m.sourceMatchIds) {
      const src = byId.get(sid);
      if (src) d = Math.max(d, depthOf(src) + 1);
    }
    visiting.delete(m.id);
    depth.set(m.id, d);
    return d;
  };
  return matches
    .map((m, i) => ({ m, i, d: depthOf(m) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(x => x.m);
}

/**
 * 메인 배정: 경기마다 모든 코트 후보 중 가장 이른 시각을 고른다.
 * 후보 시각 = max(코트가 비는 시각, 참가자 마지막 종료 + 최소 휴식, 원천 경기 종료 + 최소 휴식).
 */
export function allocateMatches(
  matches: readonly AllocMatch[],
  courts: readonly AllocCourt[],
  settings: AllocSettings,
  fixed: readonly FixedMatch[] = [],
): AllocResult {
  const { dayEnd, nextDayStartMin, breakStart, breakEnd, matchDuration, scheduleDates, effectiveStartDate } = settings;
  const sb = (t: number) => (breakStart >= 0 && breakEnd > breakStart && t >= breakStart && t < breakEnd ? breakEnd : t);
  const firstStart = (date: string) => (date === effectiveStartDate ? settings.dayStart : nextDayStartMin);
  /** 세션 안의 시작 시각으로 맞춘다: 날짜 목록 밖이면 다음 날짜, 시작 전이면 시작, 휴식 중이면 휴식 끝, 마감 이후면 다음 날 */
  const normalize = (at: At): At => {
    let { date, t } = at;
    for (let guard = 0; guard < 400; guard++) {
      if (date < effectiveStartDate) { date = effectiveStartDate; t = settings.dayStart; }
      if (scheduleDates.length > 0 && !scheduleDates.includes(date) && scheduleDates.some(d => d > date)) {
        date = nextScheduleDate(date, scheduleDates);
        t = nextDayStartMin;
      }
      t = sb(Math.max(t, firstStart(date)));
      if (t < dayEnd) return { date, t };
      date = nextScheduleDate(date, scheduleDates);
      t = nextDayStartMin;
    }
    return { date, t };
  };

  const courtFree = courts.map(c => ({ id: c.id, name: c.name, at: { date: effectiveStartDate, t: settings.dayStart } as At }));
  /** 참가자별 마지막 경기 종료 시각 */
  const lastEnd = new Map<string, At>();
  /** 경기별 종료 시각 (선후관계) */
  const matchEnd = new Map<string, At>();
  const setEnd = (ids: readonly string[], end: At) => {
    for (const id of ids) {
      const prev = lastEnd.get(id);
      if (!prev || before(prev, end)) lastEnd.set(id, end);
    }
  };
  for (const f of fixed) {
    const end = { date: f.date, t: f.start + matchDuration };
    matchEnd.set(f.id, end);
    setEnd(f.participantIds, end);
  }

  const slots: AllocSlot[] = [];
  let skippedCount = 0;
  for (const m of orderByDependencies(matches)) {
    if (courtFree.length === 0) { skippedCount++; continue; }
    const rest = Math.max(0, m.minRestBefore);
    let ready: At = { date: effectiveStartDate, t: settings.dayStart };
    for (const pid of m.participantIds) {
      const e = lastEnd.get(pid);
      if (e) ready = later(ready, { date: e.date, t: e.t + rest });
    }
    for (const sid of m.sourceMatchIds) {
      const e = matchEnd.get(sid);
      if (e) ready = later(ready, { date: e.date, t: e.t + rest });
    }
    let best = -1;
    let bestAt: At | null = null;
    for (let ci = 0; ci < courtFree.length; ci++) {
      const cand = normalize(later(courtFree[ci].at, ready));
      if (!bestAt || before(cand, bestAt)) { best = ci; bestAt = cand; }
    }
    if (best < 0 || !bestAt) { skippedCount++; continue; }
    const court = courtFree[best];
    slots.push({
      matchId: m.id,
      courtId: court.id,
      courtName: court.name,
      scheduledTime: formatMinutes(bestAt.t),
      scheduledDate: bestAt.date,
      label: m.label,
      status: m.status || 'pending',
    });
    const end = { date: bestAt.date, t: bestAt.t + matchDuration };
    court.at = end;
    matchEnd.set(m.id, end);
    setEnd(m.participantIds, end);
  }
  return { slots, skippedCount };
}

// ===== 경기 데이터 → 배정 입력 =====

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 휴식을 지켜야 하는 참가자 ID: 선수/팀 ID + 팀원 ID ("BYE"·빈 값 제외) */
export function scheduleParticipantIds(m: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const k of ['player1Id', 'player2Id', 'team1Id', 'team2Id']) {
    const v = str(m[k]);
    if (v && v !== 'BYE') ids.add(v);
  }
  for (const k of ['team1', 'team2']) {
    const team = m[k];
    if (isObject(team)) for (const id of toList<unknown>(team.memberIds)) if (typeof id === 'string' && id) ids.add(id);
  }
  return [...ids];
}

/** 원천 경기 ID (sourceMatch1/2, 구 클라이언트 필드 sourceMatch1Id/2Id) */
export function scheduleSourceIds(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const side of [1, 2]) {
    const id = str(m[`sourceMatch${side}`]) || str(m[`sourceMatch${side}Id`]);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function matchScheduleLabel(m: Record<string, unknown>): string {
  return `${str(m.player1Name) || str(m.team1Name)} vs ${str(m.player2Name) || str(m.team2Name)}`;
}

/**
 * 이 경기 전 최소 휴식(분): 지정값(이번 배정에만 쓰는 값)이 있으면 그것, 없으면 그 경기 스테이지의 규칙.
 */
export function minRestBeforeMatch(m: Record<string, unknown>, tournament: TournamentLike | null | undefined, override?: number | null): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;
  return resolveCompetitionRules(tournament, m.stageId).schedule.minRestMinutes;
}

export function toAllocMatch(m: Record<string, unknown> & { id: string }, tournament: TournamentLike | null | undefined, restOverride?: number | null): AllocMatch {
  return {
    id: m.id,
    participantIds: scheduleParticipantIds(m),
    sourceMatchIds: scheduleSourceIds(m),
    minRestBefore: minRestBeforeMatch(m, tournament, restOverride),
    label: matchScheduleLabel(m),
    status: str(m.status) || 'pending',
  };
}

/**
 * 이미 일정이 있는 경기 (배정 대상이 아닌 것) → 고정 점유 (휴식·선후관계용; 코트 점유는 하지 않는다).
 * 끝난 경기도 넣는다: 원천 경기(8강)가 먼저 끝났어도 그 종료 + 최소 휴식 전에 다음 경기(4강)를 잡지 않는다.
 */
export function toFixedMatches(all: ReadonlyArray<Record<string, unknown> & { id: string }>, targetIds: ReadonlySet<string>): FixedMatch[] {
  const out: FixedMatch[] = [];
  for (const m of all) {
    if (targetIds.has(m.id)) continue;
    const date = str(m.scheduledDate);
    const time = str(m.scheduledTime);
    if (!date || !/^\d{1,2}:\d{2}$/.test(time)) continue;
    out.push({ id: m.id, participantIds: scheduleParticipantIds(m), date, start: parseMinutes(time) });
  }
  return out;
}
