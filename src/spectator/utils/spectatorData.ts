/**
 * 관전 화면 데이터 가공 (순수 함수): 일정·필터·다음 경기·실시간 현황·코트 현황판·조 진행 상태.
 * 시각은 경기의 scheduledDate/scheduledTime, 없으면 일정 슬롯, 날짜가 없으면 대회 날짜를 쓴다(기기 현지 시각).
 */
import type { Match, ScheduleSlot } from '@shared/types';
import { BYE_ID, isByeMatch, isRealParticipantId } from '@shared/rules/walkover';
import { isTeamType } from '@shared/rules/competitionRules';

export type StageKind = 'qualifying' | 'finals' | 'ranking' | 'other';

/** 경기 단계 분류 (예선 조 / 본선 / 순위결정전 / 기타) */
export function stageKindOf(m: Pick<Match, 'groupId' | 'stageId' | 'roundLabel'>): StageKind {
  if (m.groupId || m.stageId?.includes('qualifying')) return 'qualifying';
  if (m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전')) return 'ranking';
  if (m.stageId?.includes('finals') || m.roundLabel) return 'finals';
  return 'other';
}

export interface MatchTime {
  /** YYYY-MM-DD (없으면 '') */
  date: string;
  /** HH:MM (없으면 '') */
  time: string;
  /** 기기 현지 시각 기준 epoch ms (시각이 없으면 null) */
  at: number | null;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

/** "9:5", "09:05", "09:05:00" → "09:05". 형식이 아니면 '' */
export function normalizeHm(time: string | undefined | null): string {
  const m = typeof time === 'string' ? time.match(/(\d{1,2}):(\d{2})/) : null;
  return m ? `${pad2(Number(m[1]))}:${m[2]}` : '';
}

export function toEpoch(date: string, time: string): number | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00`);
  const v = d.getTime();
  return Number.isNaN(v) ? null : v;
}

export function slotsByMatch(schedule: ReadonlyArray<ScheduleSlot>): Map<string, ScheduleSlot> {
  const out = new Map<string, ScheduleSlot>();
  for (const s of schedule) if (s.matchId && !out.has(s.matchId)) out.set(s.matchId, s);
  return out;
}

export function matchTimeOf(m: Match, slot: ScheduleSlot | undefined, fallbackDate = ''): MatchTime {
  const time = normalizeHm(m.scheduledTime) || normalizeHm(slot?.scheduledTime);
  const date = m.scheduledDate || slot?.scheduledDate || fallbackDate || '';
  return { date, time, at: toEpoch(date, time) };
}

export function courtOf(m: Match, slot: ScheduleSlot | undefined): { id: string; name: string } {
  const id = m.courtId || slot?.courtId || '';
  const name = m.courtName || slot?.courtName || '';
  return { id: id || name, name };
}

/** 실제로 치를 경기인가 (BYE 경기·양쪽 모두 빈 경기 제외) */
export function isPlayableMatch(m: Match): boolean {
  if (isByeMatch(m)) return false;
  // 표시가 빠진 BYE 경기: 한쪽 자리가 BYE면 치르지 않는다
  if ([m.player1Id, m.player2Id, m.team1Id, m.team2Id, m.player1Name, m.player2Name, m.team1Name, m.team2Name].some(v => v === BYE_ID)) return false;
  return isRealParticipantId(m.player1Id) || isRealParticipantId(m.player2Id) || isRealParticipantId(m.team1Id) || isRealParticipantId(m.team2Id)
    || !!(m.player1Name || m.player2Name || m.team1Name || m.team2Name)
    // 아직 대진이 정해지지 않은 본선 경기(앞 경기 승자·패자가 올 자리)도 일정·다음 경기에 보인다
    || !!(m.sourceMatch1 || m.sourceMatch2 || m.sourceMatch1Id || m.sourceMatch2Id);
}

/** 경기 참가자 (ID 또는 이름, 단체전 팀원 포함) */
export function participantKeys(m: Match): string[] {
  const team = m as unknown as { team1?: { memberIds?: string[]; memberNames?: string[] }; team2?: { memberIds?: string[]; memberNames?: string[] } };
  return [
    m.player1Id, m.player2Id, m.player1Name, m.player2Name,
    m.team1Id, m.team2Id, m.team1Name, m.team2Name,
    ...(team.team1?.memberIds || []), ...(team.team1?.memberNames || []),
    ...(team.team2?.memberIds || []), ...(team.team2?.memberNames || []),
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export function involves(m: Match, ids: ReadonlyArray<string>): boolean {
  if (ids.length === 0) return false;
  const keys = participantKeys(m);
  return ids.some(id => keys.includes(id));
}

/** 이 선수(ID 또는 이름)가 몇 번 자리인가. 아니면 null */
export function sideOfPlayer(m: Match, key: string): 1 | 2 | null {
  if (key === m.player1Id || key === m.team1Id || key === m.player1Name || key === m.team1Name) return 1;
  if (key === m.player2Id || key === m.team2Id || key === m.player2Name || key === m.team2Name) return 2;
  return null;
}

export function sideName(m: Match, side: 1 | 2): string {
  const team = isTeamType(m.type);
  return side === 1
    ? (team ? m.team1Name || m.player1Name : m.player1Name || m.team1Name) || ''
    : (team ? m.team2Name || m.player2Name : m.player2Name || m.team2Name) || '';
}

export interface ScheduleRow {
  match: Match;
  time: MatchTime;
  court: { id: string; name: string };
  stage: StageKind;
  /** 필터용 단계 키: 'group:A', 'finals', 'ranking', 'other' */
  stageKey: string;
}

export function stageKeyOf(m: Match): string {
  const kind = stageKindOf(m);
  if (kind === 'qualifying') return `group:${m.groupId || ''}`;
  return kind;
}

/** 일정 행 (시간순: 날짜 → 시각 → 코트 이름. 시각 없는 경기는 뒤) */
export function buildScheduleRows(matches: ReadonlyArray<Match>, schedule: ReadonlyArray<ScheduleSlot>, fallbackDate = ''): ScheduleRow[] {
  const slots = slotsByMatch(schedule);
  return matches
    .filter(isPlayableMatch)
    .map(m => {
      const slot = slots.get(m.id);
      return { match: m, time: matchTimeOf(m, slot, fallbackDate), court: courtOf(m, slot), stage: stageKindOf(m), stageKey: stageKeyOf(m) };
    })
    .sort(compareRows);
}

export function compareRows(a: ScheduleRow, b: ScheduleRow): number {
  const ad = a.time.date || '9999', bd = b.time.date || '9999';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.time.time || '99:99', bt = b.time.time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  const c = a.court.name.localeCompare(b.court.name, 'ko', { numeric: true });
  if (c !== 0) return c;
  return (a.match.round ?? 0) - (b.match.round ?? 0) || (a.match.bracketPosition ?? 0) - (b.match.bracketPosition ?? 0);
}

export interface ScheduleFilter {
  date: string;   // '' = 전체
  stage: string;  // '' = 전체, 아니면 stageKey
  court: string;  // '' = 전체, 아니면 court.id
  favoritesOnly: boolean;
  /** 'all' | 'remaining'(진행 중·예정) | 'completed' */
  status?: 'all' | 'remaining' | 'completed';
}

export const EMPTY_SCHEDULE_FILTER: ScheduleFilter = { date: '', stage: '', court: '', favoritesOnly: false, status: 'all' };

export function filterScheduleRows(rows: ReadonlyArray<ScheduleRow>, f: ScheduleFilter, favoriteIds: ReadonlyArray<string>): ScheduleRow[] {
  return rows.filter(r =>
    (!f.date || r.time.date === f.date)
    && (!f.stage || r.stageKey === f.stage)
    && (!f.court || r.court.id === f.court)
    && (!f.favoritesOnly || involves(r.match, favoriteIds))
    && (!f.status || f.status === 'all'
      || (f.status === 'completed' ? r.match.status === 'completed' : r.match.status !== 'completed')),
  );
}

export interface FilterOptions {
  dates: string[];
  stages: string[];
  courts: Array<{ id: string; name: string }>;
}

export function scheduleFilterOptions(rows: ReadonlyArray<ScheduleRow>): FilterOptions {
  const dates = new Set<string>();
  const stages = new Set<string>();
  const courts = new Map<string, string>();
  for (const r of rows) {
    if (r.time.date) dates.add(r.time.date);
    stages.add(r.stageKey);
    if (r.court.id) courts.set(r.court.id, r.court.name || r.court.id);
  }
  const stageOrder = (k: string) => (k.startsWith('group:') ? 0 : k === 'finals' ? 1 : k === 'ranking' ? 2 : 3);
  return {
    dates: [...dates].sort(),
    stages: [...stages].sort((a, b) => stageOrder(a) - stageOrder(b) || a.localeCompare(b, 'ko', { numeric: true })),
    courts: [...courts.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true })),
  };
}

/** 필터를 URL 검색 파라미터로 (뒤로 가기·공유 가능) */
export function filterFromParams(p: URLSearchParams): ScheduleFilter {
  const status = p.get('status');
  return {
    date: p.get('date') || '',
    stage: p.get('stage') || '',
    court: p.get('court') || '',
    favoritesOnly: p.get('fav') === '1',
    status: status === 'remaining' || status === 'completed' ? status : 'all',
  };
}

export function filterToParams(f: ScheduleFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.date) p.set('date', f.date);
  if (f.stage) p.set('stage', f.stage);
  if (f.court) p.set('court', f.court);
  if (f.favoritesOnly) p.set('fav', '1');
  if (f.status && f.status !== 'all') p.set('status', f.status);
  return p;
}

/**
 * 다음 경기: 아직 시작하지 않은 경기를 예정 시각이 이른 순서로.
 * 예정 시각이 지났는데 아직 시작하지 않은 경기(지연, isDelayed)도 버리지 않고 시간순 맨 앞에 둔다
 * (대회가 30분 넘게 밀리는 일이 흔하다). graceMs를 주면 그보다 더 지난 경기만 뺀다.
 * 시각이 없는 경기는 includeUntimed일 때 뒤에 붙인다.
 */
export function nextMatchRows(rows: ReadonlyArray<ScheduleRow>, now: number, opts: { graceMs?: number; includeUntimed?: boolean; limit?: number } = {}): ScheduleRow[] {
  const grace = opts.graceMs ?? Number.POSITIVE_INFINITY;
  const pending = rows.filter(r => r.match.status === 'pending');
  const timed = pending.filter(r => r.time.at !== null && r.time.at >= now - grace).sort((a, b) => (a.time.at! - b.time.at!) || compareRows(a, b));
  const untimed = opts.includeUntimed ? pending.filter(r => r.time.at === null) : [];
  const out = [...timed, ...untimed];
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** 예정 시각이 지났는데 아직 시작하지 않은 경기 (지연) */
export function isDelayed(r: ScheduleRow, now: number): boolean {
  return r.match.status === 'pending' && r.time.at !== null && r.time.at < now;
}

export interface LiveOverview {
  live: ScheduleRow[];
  upcoming: ScheduleRow[];
  recent: ScheduleRow[];
}

/**
 * 실시간 현황: 진행 중 / 곧 시작(앞으로 soonMs 안, 또는 지연 중) / 방금 끝남(recentMs 안에 끝남).
 * 끝난 시각은 경기의 updatedAt(없으면 표시하지 않음).
 */
export function liveOverview(rows: ReadonlyArray<ScheduleRow>, now: number, opts: { soonMs?: number; recentMs?: number; max?: number } = {}): LiveOverview {
  const soon = opts.soonMs ?? 60 * 60_000;
  const recentMs = opts.recentMs ?? 30 * 60_000;
  const max = opts.max ?? 6;
  const live = rows.filter(r => r.match.status === 'in_progress');
  const upcoming = nextMatchRows(rows, now).filter(r => r.time.at! <= now + soon).slice(0, max);
  const recent = rows
    .filter(r => r.match.status === 'completed' && typeof r.match.updatedAt === 'number' && now - r.match.updatedAt <= recentMs && r.match.updatedAt <= now + 60_000)
    .sort((a, b) => (b.match.updatedAt ?? 0) - (a.match.updatedAt ?? 0))
    .slice(0, max);
  return { live, upcoming, recent };
}

export interface CourtBoardEntry {
  court: { id: string; name: string };
  current: ScheduleRow | null;
  next: ScheduleRow | null;
}

/** 코트별 현황판: 지금 경기(진행 중), 다음 경기(그 코트의 가장 이른 예정 경기) */
export function courtBoard(rows: ReadonlyArray<ScheduleRow>, now: number): CourtBoardEntry[] {
  const courts = new Map<string, CourtBoardEntry>();
  for (const r of rows) {
    if (!r.court.id) continue;
    if (!courts.has(r.court.id)) courts.set(r.court.id, { court: r.court, current: null, next: null });
  }
  for (const e of courts.values()) {
    const onCourt = rows.filter(r => r.court.id === e.court.id);
    e.current = onCourt.find(r => r.match.status === 'in_progress') ?? null;
    const pending = onCourt.filter(r => r.match.status === 'pending');
    const upcoming = nextMatchRows(pending, now, { includeUntimed: true });
    e.next = upcoming[0] ?? null;
  }
  return [...courts.values()]
    .filter(e => e.current || e.next)
    .sort((a, b) => a.court.name.localeCompare(b.court.name, 'ko', { numeric: true }));
}

export interface GroupProgress {
  groupId: string;
  total: number;
  completed: number;
  inProgress: number;
  /** 아직 끝나지 않은 경기가 있어 순위가 잠정이다 */
  provisional: boolean;
}

/** 조별 진행 상태 (BYE 경기 제외) */
export function groupProgress(matches: ReadonlyArray<Match>): GroupProgress[] {
  const map = new Map<string, Match[]>();
  for (const m of matches) {
    if (!m.groupId) continue;
    if (!map.has(m.groupId)) map.set(m.groupId, []);
    map.get(m.groupId)!.push(m);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko', { numeric: true }))
    .map(([groupId, ms]) => {
      const playable = ms.filter(isPlayableMatch);
      const completed = playable.filter(m => m.status === 'completed').length;
      const inProgress = playable.filter(m => m.status === 'in_progress').length;
      return { groupId, total: playable.length, completed, inProgress, provisional: completed < playable.length };
    });
}

/** 선수(ID 또는 이름)의 경기 목록 */
export function matchesOfPlayer(matches: ReadonlyArray<Match>, key: string, name?: string): Match[] {
  return matches.filter(m => sideOfPlayer(m, key) !== null || (!!name && sideOfPlayer(m, name) !== null));
}

/** 심판이 맡은 경기 (주심·부심·배정 목록) */
export function matchesOfReferee(matches: ReadonlyArray<Match>, refereeId: string, assignedIds: ReadonlyArray<string> = []): Match[] {
  const assigned = new Set(assignedIds);
  return matches.filter(m => m.refereeId === refereeId || m.assistantRefereeId === refereeId || assigned.has(m.id));
}
