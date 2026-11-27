/**
 * 관전 화면 오프라인 캐시: 마지막으로 받은 대회·경기·일정을 기기(localStorage)에 저장해 두고,
 * 다음 방문 때 서버 연결 전이나 끊긴 상태에서 '저장된 데이터 (HH:MM 기준)'으로 바로 보여 준다.
 * 저장 실패(용량·사생활 보호 모드)는 무시한다. 점수 기록(scoreHistory)처럼 큰 필드는 저장하지 않는다.
 */
import type { Match, ScheduleSlot, Tournament } from '@shared/types';

export interface SpectatorSnapshot {
  savedAt: number;
  tournament: Tournament | null;
  matches: Match[];
  schedule: ScheduleSlot[];
}

const PREFIX = 'showdown_spectator_cache_';
const VERSION = 1;
const HEAVY_FIELDS = ['scoreHistory', 'pauseHistory', 'individualMatches'] as const;

export function cacheKey(tournamentId: string): string {
  return `${PREFIX}${tournamentId}`;
}

export function slimMatch(m: Match): Match {
  const copy = { ...m } as Record<string, unknown>;
  for (const f of HEAVY_FIELDS) delete copy[f];
  return copy as unknown as Match;
}

export function serializeSnapshot(s: SpectatorSnapshot): string {
  return JSON.stringify({ v: VERSION, ...s, matches: s.matches.map(slimMatch) });
}

export function parseSnapshot(raw: string | null): SpectatorSnapshot | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<SpectatorSnapshot> & { v?: number };
    if (d.v !== VERSION || typeof d.savedAt !== 'number' || !Array.isArray(d.matches)) return null;
    return {
      savedAt: d.savedAt,
      tournament: d.tournament && typeof d.tournament === 'object' ? d.tournament : null,
      matches: d.matches,
      schedule: Array.isArray(d.schedule) ? d.schedule : [],
    };
  } catch {
    return null;
  }
}

export function loadSnapshot(tournamentId: string): SpectatorSnapshot | null {
  try {
    return parseSnapshot(localStorage.getItem(cacheKey(tournamentId)));
  } catch {
    return null;
  }
}

/** 기기에 남겨 두는 대회 캐시 수: 넘치면 가장 오래 전에 본 대회부터 지운다 (즐겨찾기·설정 저장 공간을 지킨다) */
export const MAX_SNAPSHOTS = 3;
const INDEX_KEY = `${PREFIX}index`;

function readIndex(): string[] {
  try {
    const d = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]') as unknown;
    return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(ids)); } catch { /* 무시 */ }
}

/** 색인에 없는 예전 캐시 키(색인 도입 전)도 찾아 함께 관리한다 */
function knownIds(): string[] {
  const ids = readIndex();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== INDEX_KEY) {
        const id = k.slice(PREFIX.length);
        if (!ids.includes(id)) ids.unshift(id);
      }
    }
  } catch { /* 무시 */ }
  return ids;
}

function removeSnapshot(id: string): void {
  try { localStorage.removeItem(cacheKey(id)); } catch { /* 무시 */ }
}

/**
 * 저장: 최근에 본 MAX_SNAPSHOTS개만 남긴다. 저장 공간이 모자라면 다른 대회 캐시를 모두 지우고 한 번 더 시도하고,
 * 그래도 안 되면 이 대회 캐시도 지운다(오래된 데이터를 남기지 않는다).
 */
export function saveSnapshot(tournamentId: string, s: SpectatorSnapshot): void {
  let ids = knownIds().filter(id => id !== tournamentId);
  ids.push(tournamentId); // 가장 최근
  while (ids.length > MAX_SNAPSHOTS) removeSnapshot(ids.shift()!);
  const raw = serializeSnapshot(s);
  try {
    localStorage.setItem(cacheKey(tournamentId), raw);
  } catch {
    for (const id of ids) if (id !== tournamentId) removeSnapshot(id);
    ids = [tournamentId];
    try {
      localStorage.setItem(cacheKey(tournamentId), raw);
    } catch {
      // 저장 공간 부족 등: 캐시 없이 계속한다
      removeSnapshot(tournamentId);
      ids = [];
    }
  }
  writeIndex(ids);
}
