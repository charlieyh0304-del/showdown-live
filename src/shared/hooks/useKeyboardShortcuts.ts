import { useEffect } from 'react';

export function useKeyboardShortcuts(
  handlers: Record<string, () => void>,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;

      const fn = handlers[e.code];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlers, enabled]);
}

// 심판 스코어링 단축키 안내
export const SCORING_SHORTCUTS: Record<string, string> = {
  'ArrowLeft': '선수1 득점 (+1)',
  'ArrowRight': '선수2 득점 (+1)',
  'KeyQ': '선수1 점수 감소 (-1)',
  'KeyP': '선수2 점수 감소 (-1)',
  'KeyF': '선수1 폴트',
  'KeyJ': '선수2 폴트',
  'KeyT': '타임아웃',
};
