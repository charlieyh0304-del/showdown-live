import { useState, useEffect, useCallback } from 'react';
import {
  applyA11yToDocument, dispatchA11y, getA11ySettings, subscribeA11y,
  type A11ySettings, type ColorMode,
} from '../utils/a11ySettings';

export type { ColorMode, A11ySettings } from '../utils/a11ySettings';

/** 접근성 화면 설정 (기기별 저장). 도우미 명령(글씨 크게·고대비)과 같은 저장소를 쓴다. */
export function useAccessibility() {
  const [settings, setSettings] = useState<A11ySettings>(getA11ySettings);

  useEffect(() => {
    applyA11yToDocument(getA11ySettings());
    return subscribeA11y(setSettings);
  }, []);

  const update = useCallback((patch: Partial<A11ySettings>) => dispatchA11y({ type: 'update', patch }), []);
  const setColorMode = useCallback((mode: ColorMode) => dispatchA11y({ type: 'update', patch: { colorMode: mode } }), []);
  const stepFont = useCallback((delta: number) => dispatchA11y({ type: 'fontStep', delta }), []);
  const reset = useCallback(() => dispatchA11y({ type: 'reset' }), []);

  return { settings, update, setColorMode, stepFont, reset };
}
