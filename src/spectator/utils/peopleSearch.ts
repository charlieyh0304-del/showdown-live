/**
 * 관전 화면의 선수·심판 찾기 (전역 검색 콤보박스).
 * - 이름 일부(대소문자 무시)로 찾는다.
 * - 한글 초성만 입력해도 찾는다: "ㄱㅊㅅ" → 김철수, "김ㅊ" → 김철수 (글자마다 완성형 또는 그 글자의 초성).
 * 순수 함수만 둔다(파이어베이스 없이 테스트한다).
 */
import type { Match, Referee } from '@shared/types';
import { isRealParticipantId } from '@shared/rules/walkover';
import { isTeamType } from '@shared/rules/competitionRules';

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** 완성형 한글 한 글자의 초성. 한글이 아니면 null */
export function choseongOf(ch: string): string | null {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  return CHOSEONG[Math.floor((code - HANGUL_BASE) / 588)];
}

/** 호환용 자음(ㄱ~ㅎ)인가 */
export function isChoseongJamo(ch: string): boolean {
  return CHOSEONG.includes(ch);
}

/** 문자열 전체의 초성 (한글이 아닌 글자는 그대로) */
export function toChoseong(s: string): string {
  return Array.from(s).map(c => choseongOf(c) ?? c).join('');
}

function norm(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, '');
}

/**
 * 이름에서 검색어가 처음 맞는 위치 (못 찾으면 -1).
 * 검색어의 글자는 이름의 같은 글자와 같거나, 자음(ㄱ~ㅎ)이면 이름 글자의 초성과 같으면 맞는다.
 */
export function matchIndex(name: string, query: string): number {
  const n = Array.from(norm(name));
  const q = Array.from(norm(query));
  if (q.length === 0) return 0;
  for (let start = 0; start + q.length <= n.length; start++) {
    let ok = true;
    for (let i = 0; i < q.length; i++) {
      const nc = n[start + i];
      const qc = q[i];
      if (nc === qc) continue;
      if (isChoseongJamo(qc) && choseongOf(nc) === qc) continue;
      ok = false;
      break;
    }
    if (ok) return start;
  }
  return -1;
}

export type PersonKind = 'player' | 'team' | 'referee';

export interface PersonEntry {
  kind: PersonKind;
  /** 선수·팀: 참가자 ID (없으면 이름). 심판: 심판 ID */
  id: string;
  name: string;
  /** 보조 정보 (조 이름 등). 화면·낭독 문구에 쓴다 */
  groups: string[];
}

/**
 * 경기·심판 데이터에서 찾을 수 있는 사람 목록을 만든다.
 * BYE·미정 슬롯은 넣지 않는다. 같은 ID는 한 번만 넣는다.
 */
export function buildPeopleIndex(
  matches: ReadonlyArray<Match>,
  referees: ReadonlyArray<Pick<Referee, 'id' | 'name'>> = [],
  assignments: Readonly<Record<string, unknown>> = {},
): PersonEntry[] {
  const people = new Map<string, PersonEntry>();
  const add = (kind: PersonKind, id: string | undefined, name: string | undefined, group?: string) => {
    if (!name || !name.trim()) return;
    if (kind !== 'referee' && id && !isRealParticipantId(id)) return;
    const key = `${kind}:${id || name}`;
    let e = people.get(key);
    if (!e) {
      e = { kind, id: id || name, name, groups: [] };
      people.set(key, e);
    }
    if (group && !e.groups.includes(group)) e.groups.push(group);
  };
  for (const m of matches) {
    const team = isTeamType(m.type);
    const g = m.groupId || undefined;
    if (team) {
      if (isRealParticipantId(m.team1Id)) add('team', m.team1Id, m.team1Name, g);
      if (isRealParticipantId(m.team2Id)) add('team', m.team2Id, m.team2Name, g);
    } else {
      if (isRealParticipantId(m.player1Id)) add('player', m.player1Id, m.player1Name, g);
      if (isRealParticipantId(m.player2Id)) add('player', m.player2Id, m.player2Name, g);
    }
  }
  const refName = new Map(referees.map(r => [r.id, r.name]));
  const refIds = new Set<string>(Object.keys(assignments));
  for (const m of matches) {
    if (m.refereeId) { refIds.add(m.refereeId); if (m.refereeName && !refName.has(m.refereeId)) refName.set(m.refereeId, m.refereeName); }
    if (m.assistantRefereeId) { refIds.add(m.assistantRefereeId); if (m.assistantRefereeName && !refName.has(m.assistantRefereeId)) refName.set(m.assistantRefereeId, m.assistantRefereeName); }
  }
  for (const id of refIds) add('referee', id, refName.get(id));
  return Array.from(people.values());
}

/**
 * 검색 결과: 이름 앞부분이 맞는 것 → 중간이 맞는 것 순, 같으면 이름순(한국어).
 * 빈 검색어는 빈 결과.
 */
export function searchPeople(people: ReadonlyArray<PersonEntry>, query: string, limit = 12): PersonEntry[] {
  const q = query.trim();
  if (!q) return [];
  const scored: Array<{ e: PersonEntry; pos: number }> = [];
  for (const e of people) {
    const pos = matchIndex(e.name, q);
    if (pos >= 0) scored.push({ e, pos });
  }
  scored.sort((a, b) => (a.pos === 0 ? 0 : 1) - (b.pos === 0 ? 0 : 1) || a.e.name.localeCompare(b.e.name, 'ko') || a.e.kind.localeCompare(b.e.kind));
  return scored.slice(0, limit).map(s => s.e);
}
