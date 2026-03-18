import { useRef, useCallback } from 'react';

export function useDoubleClickGuard(cooldownMs = 500) {
  const lastActionTime = useRef(0);

  const canAct = useCallback(() => {
    const now = Date.now();
    if (now - lastActionTime.current < cooldownMs) return false;
    lastActionTime.current = now;
    return true;
  }, [cooldownMs]);

  return { canAct };
}
