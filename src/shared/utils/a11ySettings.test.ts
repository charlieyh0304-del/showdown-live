import { describe, it, expect } from 'vitest';
import {
  a11yClasses, a11yReducer, clampFontLevel, DEFAULT_A11Y, effectiveReduceMotion, MAX_FONT_LEVEL, parseA11y, sanitizePatch,
} from './a11ySettings';

describe('a11ySettings reducer and storage parsing', () => {
  it('parses nothing / corrupt / non-object storage as defaults', () => {
    expect(parseA11y(null)).toEqual(DEFAULT_A11Y);
    expect(parseA11y('{bad json')).toEqual(DEFAULT_A11Y);
    expect(parseA11y('"text"')).toEqual(DEFAULT_A11Y);
    expect(parseA11y('null')).toEqual(DEFAULT_A11Y);
  });

  it('reads the legacy {colorMode, fontSize} format', () => {
    expect(parseA11y(JSON.stringify({ colorMode: 'high-contrast', fontSize: 'large' }))).toMatchObject({ colorMode: 'high-contrast', fontLevel: 2 });
    expect(parseA11y(JSON.stringify({ colorMode: 'dark', fontSize: 'xlarge' })).fontLevel).toBe(3);
  });

  it('drops unknown or out-of-range values', () => {
    const s = parseA11y(JSON.stringify({ colorMode: 'neon', fontLevel: 99, fontWeight: 'heavy', lineHeight: 'loose', strongFocus: 'yes', reduceMotion: 'no' }));
    expect(s.colorMode).toBe('dark');
    expect(s.fontLevel).toBe(MAX_FONT_LEVEL);
    expect(s.fontWeight).toBe('normal');
    expect(s.lineHeight).toBe('loose');
    expect(s.strongFocus).toBe(false);
    expect(s.reduceMotion).toBeNull();
    expect(sanitizePatch({ fontLevel: Number.NaN })).toEqual({ fontLevel: 0 });
    expect(clampFontLevel(-3)).toBe(0);
  });

  it('font step stays within the 5 levels', () => {
    let s = DEFAULT_A11Y;
    for (let i = 0; i < 10; i++) s = a11yReducer(s, { type: 'fontStep', delta: 1 });
    expect(s.fontLevel).toBe(MAX_FONT_LEVEL);
    s = a11yReducer(s, { type: 'fontStep', delta: -1 });
    expect(s.fontLevel).toBe(MAX_FONT_LEVEL - 1);
  });

  it('reduce motion follows the device until the user chooses, even after other settings are saved', () => {
    // 다른 설정(글자 크기)을 바꿔 저장해도 움직임 줄이기는 '기기 설정 따름'(null)으로 남는다
    const saved = JSON.stringify(a11yReducer(DEFAULT_A11Y, { type: 'update', patch: { fontLevel: 2 } }));
    const s = parseA11y(saved);
    expect(s.reduceMotion).toBeNull();
    expect(a11yClasses(s)).not.toContain('a11y-motion-ok');
    expect(a11yClasses(s)).not.toContain('a11y-reduce-motion');
    expect(effectiveReduceMotion(s, true)).toBe(true);
    expect(effectiveReduceMotion(s, false)).toBe(false);
    // 직접 고르면 그 값이 기기 설정보다 우선한다
    const off = a11yReducer(s, { type: 'update', patch: { reduceMotion: false } });
    expect(a11yClasses(off)).toContain('a11y-motion-ok');
    expect(effectiveReduceMotion(off, true)).toBe(false);
    const on = a11yReducer(s, { type: 'update', patch: { reduceMotion: true } });
    expect(a11yClasses(on)).toContain('a11y-reduce-motion');
    // 되돌리기는 다시 '기기 설정 따름'
    expect(a11yReducer(on, { type: 'reset' }).reduceMotion).toBeNull();
  });

  it('maps every setting to document classes', () => {
    const s = { ...DEFAULT_A11Y, colorMode: 'high-contrast-light' as const, fontLevel: 4, fontWeight: 'bold' as const, lineHeight: 'relaxed' as const, letterSpacing: 'wider' as const, strongFocus: true };
    expect(a11yClasses(s)).toEqual(['mode-high-contrast', 'mode-high-contrast-light', 'font-scale-4', 'a11y-bold', 'a11y-lh-relaxed', 'a11y-ls-wider', 'a11y-strong-focus']);
  });
});
