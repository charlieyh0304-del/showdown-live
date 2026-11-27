/**
 * 접근성 화면 설정 (기기별 저장): 글자 크기 5단계, 색 모드 5종, 글자 굵기, 줄 간격, 자간, 초점 강조,
 * 움직임 줄이기(직접 고르기 전에는 기기의 '동작 줄이기' 설정을 따른다).
 * 순수 리듀서 + 문서 클래스 계산 + 모듈 저장소(설정 창과 도우미 명령이 같은 값을 쓴다).
 */
export type ColorMode = 'dark' | 'light' | 'high-contrast' | 'high-contrast-light' | 'invert';
export const COLOR_MODES: readonly ColorMode[] = ['dark', 'light', 'high-contrast', 'high-contrast-light', 'invert'];

/** 글자 크기 배율 (5단계) */
export const FONT_SCALES = [1, 1.125, 1.25, 1.5, 1.75] as const;
export const MAX_FONT_LEVEL = FONT_SCALES.length - 1;

export type FontWeight = 'normal' | 'bold';
export type LineHeight = 'normal' | 'relaxed' | 'loose';
export type LetterSpacing = 'normal' | 'wide' | 'wider';

export interface A11ySettings {
  colorMode: ColorMode;
  fontLevel: number;
  fontWeight: FontWeight;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  strongFocus: boolean;
  /** 움직임 줄이기: null이면 기기 설정(prefers-reduced-motion)을 따른다. true/false는 사용자가 직접 고른 값 */
  reduceMotion: boolean | null;
}

export const DEFAULT_A11Y: A11ySettings = {
  colorMode: 'dark', fontLevel: 0, fontWeight: 'normal', lineHeight: 'normal', letterSpacing: 'normal',
  strongFocus: false, reduceMotion: null,
};

const LINE_HEIGHTS: readonly LineHeight[] = ['normal', 'relaxed', 'loose'];
const LETTER_SPACINGS: readonly LetterSpacing[] = ['normal', 'wide', 'wider'];

export type A11yAction =
  | { type: 'update'; patch: Partial<A11ySettings> }
  | { type: 'fontStep'; delta: number }
  | { type: 'reset' };

export function clampFontLevel(n: number): number {
  return Math.min(MAX_FONT_LEVEL, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
}

/** 알 수 없는 값은 버리고 올바른 값만 반영한다 */
export function sanitizePatch(p: Partial<Record<keyof A11ySettings, unknown>>): Partial<A11ySettings> {
  const out: Partial<A11ySettings> = {};
  if (typeof p.colorMode === 'string' && COLOR_MODES.includes(p.colorMode as ColorMode)) out.colorMode = p.colorMode as ColorMode;
  if (typeof p.fontLevel === 'number') out.fontLevel = clampFontLevel(p.fontLevel);
  if (p.fontWeight === 'normal' || p.fontWeight === 'bold') out.fontWeight = p.fontWeight;
  if (typeof p.lineHeight === 'string' && LINE_HEIGHTS.includes(p.lineHeight as LineHeight)) out.lineHeight = p.lineHeight as LineHeight;
  if (typeof p.letterSpacing === 'string' && LETTER_SPACINGS.includes(p.letterSpacing as LetterSpacing)) out.letterSpacing = p.letterSpacing as LetterSpacing;
  if (typeof p.strongFocus === 'boolean') out.strongFocus = p.strongFocus;
  if (typeof p.reduceMotion === 'boolean' || p.reduceMotion === null) out.reduceMotion = p.reduceMotion as boolean | null;
  return out;
}

export function a11yReducer(s: A11ySettings, a: A11yAction): A11ySettings {
  switch (a.type) {
    case 'update': return { ...s, ...sanitizePatch(a.patch) };
    case 'fontStep': return { ...s, fontLevel: clampFontLevel(s.fontLevel + a.delta) };
    case 'reset': return { ...DEFAULT_A11Y };
  }
}

/**
 * 저장 값 읽기. 움직임 줄이기를 직접 고르지 않았으면(null) 기기 설정(prefers-reduced-motion)을 따른다.
 * 예전 형식 {colorMode:'dark'|'high-contrast', fontSize:'normal'|'large'|'xlarge'}도 읽는다.
 */
export function parseA11y(raw: string | null): A11ySettings {
  const base = { ...DEFAULT_A11Y };
  if (!raw) return base;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!d || typeof d !== 'object') return base;
    const patch = sanitizePatch(d as Partial<Record<keyof A11ySettings, unknown>>);
    if (patch.fontLevel === undefined) {
      if (d.fontSize === 'large') patch.fontLevel = 2;
      else if (d.fontSize === 'xlarge') patch.fontLevel = 3;
    }
    return { ...base, ...patch };
  } catch {
    return base;
  }
}

const MODE_CLASS: Record<ColorMode, string[]> = {
  dark: ['mode-dark'],
  light: ['mode-light'],
  'high-contrast': ['mode-high-contrast'],
  // 흰 바탕 고대비: 검정·노랑 고대비 규칙 위에 흑백 반전을 더한다
  'high-contrast-light': ['mode-high-contrast', 'mode-high-contrast-light'],
  invert: ['mode-invert'],
};

/** 문서 루트(html)에 붙일 클래스 */
export function a11yClasses(s: A11ySettings): string[] {
  const out = [...MODE_CLASS[s.colorMode], `font-scale-${clampFontLevel(s.fontLevel)}`];
  if (s.fontWeight === 'bold') out.push('a11y-bold');
  if (s.lineHeight !== 'normal') out.push(`a11y-lh-${s.lineHeight}`);
  if (s.letterSpacing !== 'normal') out.push(`a11y-ls-${s.letterSpacing}`);
  if (s.strongFocus) out.push('a11y-strong-focus');
  // null이면 아무 클래스도 붙이지 않아 CSS의 prefers-reduced-motion 규칙이 그대로 기기 설정을 따른다
  if (s.reduceMotion === true) out.push('a11y-reduce-motion');
  else if (s.reduceMotion === false) out.push('a11y-motion-ok');
  return out;
}

/** 이 모듈이 관리하는 클래스 (예전 font-normal/large/xlarge 포함): 적용 전에 지운다 */
export const A11Y_CLASS_PATTERN = /^(mode-|font-scale-|font-normal$|font-large$|font-xlarge$|a11y-)/;

// ===== 저장소 =====
export const A11Y_STORAGE_KEY = 'showdown_accessibility';
const listeners = new Set<(s: A11ySettings) => void>();
let current: A11ySettings | null = null;

/** 지금 실제로 움직임을 줄이는지 (직접 고른 값, 없으면 기기 설정) */
export function effectiveReduceMotion(s: A11ySettings, system = systemReduceMotion()): boolean {
  return s.reduceMotion ?? system;
}

function systemReduceMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function getA11ySettings(): A11ySettings {
  if (!current) {
    let raw: string | null = null;
    try { raw = typeof localStorage !== 'undefined' ? localStorage.getItem(A11Y_STORAGE_KEY) : null; } catch { raw = null; }
    current = parseA11y(raw);
  }
  return current;
}

export function applyA11yToDocument(s: A11ySettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const c of Array.from(root.classList)) if (A11Y_CLASS_PATTERN.test(c)) root.classList.remove(c);
  root.classList.add(...a11yClasses(s));
}

export function dispatchA11y(action: A11yAction): A11ySettings {
  const next = a11yReducer(getA11ySettings(), action);
  current = next;
  try { localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(next)); } catch { /* 저장 불가: 이번 화면에만 적용 */ }
  applyA11yToDocument(next);
  listeners.forEach(l => l(next));
  return next;
}

export function subscribeA11y(listener: (s: A11ySettings) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
