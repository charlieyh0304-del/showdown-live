/**
 * 부(部, division: 남자부·여자부·시니어부·혼성 단체 등) 접근 단일 창구.
 *
 * 한 대회에 여러 부가 있을 수 있다(각자 참가자·형식·규칙·순위, 코트·심판·일정은 공유, 한 선수가 여러 부에 출전 가능).
 * 부 데이터 모델은 아직 없다(포맷 엔진 M1에서 생긴다). 그때까지 getDivisions는 기본 부 하나만 돌려주고,
 * 관전 화면의 모든 구역은 이 모듈을 거쳐 부를 고르고 거른다. M1은 getDivisions 안만 바꾸면 된다.
 * 여기서 DB 스키마를 새로 만들지 않는다.
 */
import type { Match, Tournament } from '../types';

export interface Division {
  id: string;
  /** 표시 이름 (기본 부는 '' → 화면이 '전체'로 표시) */
  label: string;
  /**
   * 이 부에 속한 스테이지 ID. null이면 대회의 모든 경기.
   * 경기의 stageId가 이 목록의 ID와 같거나 'ID_'로 시작하면 이 부의 경기다.
   */
  stageIds: string[] | null;
  /** 이 부의 순위 규칙을 읽을 스테이지 (규칙 문장·순위 계산 범위) */
  rulesStageId?: string;
}

/** '전체' 선택 값 */
export const ALL_DIVISIONS = '';
export const DEFAULT_DIVISION_ID = 'default';

type TournamentInput = Pick<Tournament, 'id'> & Partial<Tournament>;

/**
 * 대회의 부 목록. 지금은 항상 기본 부 하나(모든 경기).
 * (현재 데이터에는 부를 분명히 나타내는 필드가 없어 추측하지 않는다.)
 */
export function getDivisions(tournament: TournamentInput | null | undefined, matches: ReadonlyArray<Pick<Match, 'stageId'>> = []): Division[] {
  void tournament; void matches;
  return [{ id: DEFAULT_DIVISION_ID, label: '', stageIds: null }];
}

function stageMatches(stageId: string | undefined, ids: readonly string[]): boolean {
  if (!stageId) return false;
  return ids.some(id => stageId === id || stageId.startsWith(`${id}_`));
}

/** 경기가 속한 부 ID (어느 부에도 없으면 null) */
export function divisionOfMatch(m: Pick<Match, 'stageId'>, divisions: ReadonlyArray<Division>): string | null {
  for (const d of divisions) {
    if (d.stageIds === null || stageMatches(m.stageId, d.stageIds)) return d.id;
  }
  return null;
}

export function matchInDivision(m: Pick<Match, 'stageId'>, divisionId: string, divisions: ReadonlyArray<Division>): boolean {
  if (divisionId === ALL_DIVISIONS) return true;
  const d = divisions.find(x => x.id === divisionId);
  if (!d) return true; // 사라진 부를 기억하고 있으면 전체로 본다
  return d.stageIds === null || stageMatches(m.stageId, d.stageIds);
}

/** 부로 경기 거르기 ('' = 전체) */
export function filterByDivision<M extends Pick<Match, 'stageId'>>(matches: ReadonlyArray<M>, divisionId: string, divisions: ReadonlyArray<Division>): M[] {
  if (divisionId === ALL_DIVISIONS) return [...matches];
  return matches.filter(m => matchInDivision(m, divisionId, divisions));
}

/** 선택 UI가 필요한가 (부가 둘 이상일 때만) */
export function hasDivisionChoice(divisions: ReadonlyArray<Division>): boolean {
  return divisions.length > 1;
}

/** 저장된 선택을 지금 목록에 맞춘다 (없어진 부 → 전체). 부가 하나면 항상 전체. */
export function resolveDivisionChoice(saved: string | null | undefined, divisions: ReadonlyArray<Division>): string {
  if (!hasDivisionChoice(divisions)) return ALL_DIVISIONS;
  return saved && divisions.some(d => d.id === saved) ? saved : ALL_DIVISIONS;
}

/** 선수가 출전한 부 (여러 부 가능) */
export function divisionsOfPlayer(playerMatches: ReadonlyArray<Pick<Match, 'stageId'>>, divisions: ReadonlyArray<Division>): Division[] {
  const ids = new Set<string>();
  for (const m of playerMatches) {
    const id = divisionOfMatch(m, divisions);
    if (id) ids.add(id);
  }
  return divisions.filter(d => ids.has(d.id));
}

/** 규칙을 읽을 스테이지: 지정한 스테이지 → 부의 규칙 스테이지 → 없음(대회 규칙) */
export function rulesScopeStageId(divisionId: string, divisions: ReadonlyArray<Division>, stageId?: string): string | undefined {
  if (stageId) return stageId;
  return divisions.find(d => d.id === divisionId)?.rulesStageId;
}

const STORAGE_PREFIX = 'showdown_division_';

/** 대회별로 고른 부 기억 (기기별, 실패해도 무시) */
export function loadDivisionChoice(tournamentId: string): string | null {
  try { return localStorage.getItem(`${STORAGE_PREFIX}${tournamentId}`); } catch { return null; }
}

export function saveDivisionChoice(tournamentId: string, divisionId: string): void {
  try {
    if (divisionId) localStorage.setItem(`${STORAGE_PREFIX}${tournamentId}`, divisionId);
    else localStorage.removeItem(`${STORAGE_PREFIX}${tournamentId}`);
  } catch { /* ignored */ }
}
