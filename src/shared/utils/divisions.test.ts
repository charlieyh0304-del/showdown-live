import { describe, it, expect } from 'vitest';
import {
  ALL_DIVISIONS, DEFAULT_DIVISION_ID, divisionOfMatch, divisionsOfPlayer, filterByDivision, getDivisions, hasDivisionChoice,
  resolveDivisionChoice, rulesScopeStageId, type Division,
} from './divisions';
import { focusKeySelector, peekFocusKey, rememberFocusKey, takeFocusKey } from './focusReturn';

// M1 이전에는 데이터에 부가 없으므로, 여러 부 동작은 직접 만든 목록으로 확인한다
const multi: Division[] = [
  { id: 'men', label: '남자부', stageIds: ['men'], rulesStageId: 'men_qualifying' },
  { id: 'women', label: '여자부', stageIds: ['women'] },
  { id: 'mixed', label: '혼성 단체', stageIds: ['mixed'] },
];
const matches = [
  { id: 'a', stageId: 'men_qualifying' },
  { id: 'b', stageId: 'men_finals' },
  { id: 'c', stageId: 'women_qualifying' },
  { id: 'd', stageId: 'mixed' },
  { id: 'e', stageId: 'menace' }, // 'men'으로 시작하지만 'men_'이 아니다
];

describe('divisions (부)', () => {
  it('today every tournament has one default division covering all matches, and no selector', () => {
    const ds = getDivisions({ id: 't1' }, matches);
    expect(ds).toEqual([{ id: DEFAULT_DIVISION_ID, label: '', stageIds: null }]);
    expect(hasDivisionChoice(ds)).toBe(false);
    expect(filterByDivision(matches, resolveDivisionChoice('men', ds), ds)).toHaveLength(matches.length);
    expect(resolveDivisionChoice('men', ds)).toBe(ALL_DIVISIONS);
  });

  it('with several divisions: filters by stage prefix, "전체" keeps everything, a vanished choice falls back to 전체', () => {
    expect(hasDivisionChoice(multi)).toBe(true);
    expect(filterByDivision(matches, 'men', multi).map(m => m.id)).toEqual(['a', 'b']);
    expect(filterByDivision(matches, 'women', multi).map(m => m.id)).toEqual(['c']);
    expect(filterByDivision(matches, ALL_DIVISIONS, multi)).toHaveLength(matches.length);
    expect(divisionOfMatch(matches[4], multi)).toBeNull();
    expect(resolveDivisionChoice('women', multi)).toBe('women');
    expect(resolveDivisionChoice('seniors', multi)).toBe(ALL_DIVISIONS);
    expect(resolveDivisionChoice(null, multi)).toBe(ALL_DIVISIONS);
  });

  it('a player in several divisions (e.g. 남자부 and 혼성) lists all of them', () => {
    const playerMatches = [matches[0], matches[3]];
    expect(divisionsOfPlayer(playerMatches, multi).map(d => d.label)).toEqual(['남자부', '혼성 단체']);
  });

  it('rules scope: explicit stage → division rules stage → tournament rules', () => {
    expect(rulesScopeStageId('men', multi, 'men_finals')).toBe('men_finals');
    expect(rulesScopeStageId('men', multi)).toBe('men_qualifying');
    expect(rulesScopeStageId('women', multi)).toBeUndefined();
    expect(rulesScopeStageId(ALL_DIVISIONS, multi)).toBeUndefined();
  });
});

describe('focusReturn (뒤로 가기 초점 복귀)', () => {
  it('remembers one focus key per history entry, take removes it', () => {
    rememberFocusKey('k1', 'player:p1');
    expect(peekFocusKey('k1')).toBe('player:p1');
    expect(takeFocusKey('k1')).toBe('player:p1');
    expect(takeFocusKey('k1')).toBeNull();
    rememberFocusKey('', 'x');
    expect(peekFocusKey('')).toBeNull();
  });

  it('keeps at most 50 entries (oldest dropped) and escapes selector values', () => {
    for (let i = 0; i < 60; i++) rememberFocusKey(`loc${i}`, `f${i}`);
    expect(peekFocusKey('loc0')).toBeNull();
    expect(peekFocusKey('loc59')).toBe('f59');
    expect(focusKeySelector('player:"a"\\b')).toBe('[data-focus-key="player:\\"a\\"\\\\b"]');
  });
});
