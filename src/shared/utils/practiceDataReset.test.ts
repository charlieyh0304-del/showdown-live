import { describe, it, expect } from 'vitest';
import { resetPracticeDataOnce, PRACTICE_KEYS } from './practiceDataReset';

function mem() {
  const m = new Map<string, string>();
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } };
}

describe('resetPracticeDataOnce', () => {
  it('연습 기록을 지우고 한 번만 실행한다', () => {
    const { m, s } = mem();
    for (const k of PRACTICE_KEYS) m.set(k, '[1]');
    m.set('showdown_favorites', 'keep');
    expect(resetPracticeDataOnce(s)).toBe(true);
    for (const k of PRACTICE_KEYS) expect(m.has(k)).toBe(false);
    expect(m.get('showdown_favorites')).toBe('keep');
    m.set('showdown_practice_completed', '[new]');
    expect(resetPracticeDataOnce(s)).toBe(false);
    expect(m.get('showdown_practice_completed')).toBe('[new]');
  });

  it('저장소를 쓸 수 없어도 오류 없이 넘어간다', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => {}, removeItem: () => {} };
    expect(resetPracticeDataOnce(bad)).toBe(false);
    expect(resetPracticeDataOnce(undefined)).toBe(false);
  });
});
