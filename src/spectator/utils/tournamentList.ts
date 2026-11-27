/**
 * 관전 첫 화면(대회 목록) 정렬·묶음 (순수 함수).
 * 진행 중 → 예정 → 종료 순으로 묶고, 묶음 안에서는 날짜순(진행 중·예정은 이른 날짜 먼저, 종료는 최근 먼저).
 * 대회가 하나뿐이어도 자동으로 들어가지 않는다(소유자 요구): 이 모듈은 목록만 만들고 이동은 사용자가 고른다.
 */
import type { Tournament } from '@shared/types';
import { matchIndex } from './peopleSearch';

export type TournamentPhase = 'live' | 'upcoming' | 'finished';
export const TOURNAMENT_PHASES: readonly TournamentPhase[] = ['live', 'upcoming', 'finished'];

export function tournamentPhase(status: Tournament['status'] | string | undefined): TournamentPhase {
  if (status === 'in_progress' || status === 'paused') return 'live';
  if (status === 'completed') return 'finished';
  return 'upcoming';
}

/** 대회 장소 (저장된 경우에만: venue 또는 location) */
export function tournamentVenue(t: Partial<Tournament>): string {
  const x = t as { venue?: unknown; location?: unknown };
  if (typeof x.venue === 'string' && x.venue.trim()) return x.venue.trim();
  if (typeof x.location === 'string' && x.location.trim()) return x.location.trim();
  return '';
}

export interface TournamentGroup<T> {
  phase: TournamentPhase;
  items: T[];
}

type ListItem = Pick<Tournament, 'id' | 'name' | 'status' | 'date'> & Partial<Tournament>;

function byDate<T extends ListItem>(asc: boolean) {
  return (a: T, b: T) => {
    const ad = a.date || '', bd = b.date || '';
    if (ad !== bd) return asc ? (ad < bd ? -1 : 1) : (ad < bd ? 1 : -1);
    return (a.name || '').localeCompare(b.name || '', 'ko', { numeric: true });
  };
}

/** 묶음 (빈 묶음은 뺀다) */
export function groupTournaments<T extends ListItem>(list: ReadonlyArray<T>, query = ''): TournamentGroup<T>[] {
  const q = query.trim();
  const visible = q
    ? list.filter(t => matchIndex(t.name || '', q) >= 0 || matchIndex(tournamentVenue(t), q) >= 0 || matchIndex(t.groupName || '', q) >= 0)
    : [...list];
  return TOURNAMENT_PHASES
    .map(phase => ({
      phase,
      items: visible.filter(t => tournamentPhase(t.status) === phase).sort(byDate<T>(phase !== 'finished')),
    }))
    .filter(g => g.items.length > 0);
}

/** 날짜 표시: 시작일, 끝나는 날이 다르면 "시작 ~ 끝" */
export function tournamentDateRange(t: Pick<Tournament, 'date'> & { endDate?: string }): string {
  if (t.endDate && t.endDate !== t.date) return `${t.date} ~ ${t.endDate}`;
  return t.date || '';
}
