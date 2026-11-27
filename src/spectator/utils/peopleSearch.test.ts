import { describe, it, expect } from 'vitest';
import type { Match } from '@shared/types';
import { buildPeopleIndex, matchIndex, searchPeople, toChoseong } from './peopleSearch';
import { groupTournaments, tournamentPhase } from './tournamentList';

const m = (p: Partial<Match>): Match => ({ id: 'm', type: 'individual', status: 'pending', ...p }) as Match;

describe('peopleSearch (초성 검색)', () => {
  it('matches a pure 초성 query and a mixed query', () => {
    expect(toChoseong('이종경')).toBe('ㅇㅈㄱ');
    expect(matchIndex('이종경', 'ㅇㅈㄱ')).toBe(0);
    expect(matchIndex('이종경', '이ㅈ')).toBe(0);
    expect(matchIndex('이종경', 'ㅈㄱ')).toBe(1);
    expect(matchIndex('이종경', 'ㄱㅈ')).toBe(-1);
    expect(matchIndex('Kim Chulsoo', 'chul')).toBe(3);
  });

  it('builds a de-duplicated index without BYE/TBD slots and ranks prefix matches first', () => {
    const matches = [
      m({ id: 'a', player1Id: 'p1', player1Name: '이종경', player2Id: 'p2', player2Name: '김이종', groupId: 'A', refereeId: 'r1', refereeName: '박심판' }),
      m({ id: 'b', player1Id: 'p1', player1Name: '이종경', player2Id: 'BYE', player2Name: 'BYE' }),
      m({ id: 'c', player1Id: '', player1Name: 'TBD', player2Id: 'p3', player2Name: '최영수' }),
    ];
    const people = buildPeopleIndex(matches);
    expect(people.filter(p => p.kind === 'player').map(p => p.name).sort()).toEqual(['김이종', '이종경', '최영수']);
    expect(people.find(p => p.id === 'p1')?.groups).toEqual(['A']);
    expect(people.find(p => p.kind === 'referee')?.name).toBe('박심판');
    // '이종' : 이종경(앞부분) → 김이종(중간)
    expect(searchPeople(people, '이종').map(p => p.name)).toEqual(['이종경', '김이종']);
    expect(searchPeople(people, 'ㅇㅈㄱ').map(p => p.name)).toEqual(['이종경']);
    expect(searchPeople(people, '   ')).toEqual([]);
  });
});

describe('tournamentList', () => {
  it('groups live → upcoming → finished and searches by 초성 without auto-selecting', () => {
    const list = [
      { id: '1', name: '전국 쇼다운 대회', status: 'completed' as const, date: '2026-05-01' },
      { id: '2', name: '서울 오픈', status: 'in_progress' as const, date: '2026-11-28' },
      { id: '3', name: '부산 컵', status: 'registration' as const, date: '2026-12-10' },
      { id: '4', name: '광주 대회', status: 'completed' as const, date: '2026-09-01' },
    ];
    const g = groupTournaments(list);
    expect(g.map(x => x.phase)).toEqual(['live', 'upcoming', 'finished']);
    expect(g[2].items.map(x => x.id)).toEqual(['4', '1']); // 끝난 대회는 최근 먼저
    expect(groupTournaments(list, 'ㅅㅇ').flatMap(x => x.items.map(i => i.id))).toEqual(['2']);
    expect(groupTournaments([list[1]]).length).toBe(1);
    expect(tournamentPhase('paused')).toBe('live');
  });
});
