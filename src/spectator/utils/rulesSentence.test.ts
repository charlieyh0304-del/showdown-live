import { describe, it, expect } from 'vitest';
import { resolveCompetitionRules, DEFAULT_INDIVIDUAL_SCORING } from '@shared/rules/competitionRules';
import { tFor, RAW_KEY } from '@shared/i18n/testing';
import { describeStandingsRules } from './rulesSentence';

const ko = tFor('ko');
const en = tFor('en');
const rulesOf = (rules: Record<string, unknown>) => resolveCompetitionRules({ type: 'individual', rules } as never);

describe('describeStandingsRules (규칙 문장, 실제 ko/en 문구)', () => {
  it('default rules read as plain sentences with no raw keys in either language', () => {
    for (const t of [ko, en]) {
      const s = describeStandingsRules(resolveCompetitionRules({ type: 'individual' } as never), t, { hasGroups: true });
      expect(s).not.toMatch(RAW_KEY);
      expect(s.length).toBeGreaterThan(20);
    }
    const s = describeStandingsRules(resolveCompetitionRules({ type: 'individual' } as never), ko, { hasGroups: true });
    expect(s).toContain('이기면 1점');
    expect(s).toContain(`${DEFAULT_INDIVIDUAL_SCORING.winScore}:0`);
    expect(s).toContain('운영진이 정합니다');
  });

  it('custom 1: draw and walkover points are mentioned only when they differ', () => {
    const s = describeStandingsRules(rulesOf({ standingsPoints: { win: 3, draw: 1, loss: 0, walkoverWin: 3, forfeitLoss: 0 } }), ko);
    expect(s).toContain('이기면 3점');
    expect(s).toContain('비기면 1점');
    expect(s).not.toContain('부전승은'); // 승점과 같으면 따로 말하지 않는다
    const w = describeStandingsRules(rulesOf({ standingsPoints: { win: 2, draw: 0, loss: 0, walkoverWin: 1, forfeitLoss: -1 } }), ko);
    expect(w).toContain('부전승은 1점');
    expect(w).toContain('기권패는 -1점');
    expect(describeStandingsRules(rulesOf({ standingsPoints: { win: 3, draw: 1, loss: 0, walkoverWin: 3, forfeitLoss: 0 } }), en)).toContain('1 for a draw');
  });

  it('custom 2: walkovers excluded from standings', () => {
    const s = describeStandingsRules(rulesOf({ walkover: { countInStandings: false } }), ko);
    expect(s).toContain('순위 계산에 넣지 않습니다');
    expect(s).not.toContain(`${DEFAULT_INDIVIDUAL_SCORING.winScore}:0`);
  });

  it('custom 3: a different tiebreak order and unresolved policy are read in that order', () => {
    const s = describeStandingsRules(rulesOf({ tiebreak: { criteria: ['points', 'set_difference', 'head_to_head'], headToHeadMode: 'single_pass', unresolved: 'lot' } }), ko);
    expect(s).toContain('세트 득실차, 동률 선수끼리의 상대 전적 순서로');
    expect(s).toContain('추첨으로 정합니다');
    expect(s).not.toContain('다시 비교'); // single_pass에는 재비교 문장이 없다
    const e = describeStandingsRules(rulesOf({ tiebreak: { criteria: ['points', 'set_difference', 'head_to_head'], unresolved: 'playoff' } }), en);
    expect(e).toContain('set difference, head-to-head among tied players, in that order');
    expect(e).toContain('a playoff decides');
    expect(e).not.toMatch(RAW_KEY);
  });

  it('qualification sentence only when the tournament has groups; wildcards only when there are some', () => {
    const r = rulesOf({ qualification: { perGroup: 2, wildcards: 1 } });
    expect(describeStandingsRules(r, ko, { hasGroups: true })).toContain('1명이 와일드카드로');
    expect(describeStandingsRules(r, ko)).not.toContain('본선');
    expect(describeStandingsRules(rulesOf({ qualification: { perGroup: 2, wildcards: 0 } }), ko, { hasGroups: true })).not.toContain('와일드카드');
  });
});
