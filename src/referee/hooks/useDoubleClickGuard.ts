import { useRef, useCallback } from 'react';

export function useDoubleClickGuard(cooldownMs = 500) {
  const lastActionTime = useRef(0);
  const isProcessing = useRef(false);

  const canAct = useCallback(() => {
    if (isProcessing.current) return false;
    const now = Date.now();
    if (now - lastActionTime.current < cooldownMs) return false;
    lastActionTime.current = now;
    return true;
  }, [cooldownMs]);

  const startProcessing = useCallback(() => {
    isProcessing.current = true;
  }, []);

  const done = useCallback(() => {
    isProcessing.current = false;
  }, []);

  return { canAct, startProcessing, done };
}
