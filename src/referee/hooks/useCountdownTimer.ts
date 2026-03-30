import { useState, useRef, useCallback } from 'react';

/**
 * Time-based countdown timer.
 * Uses absolute end time instead of decrementing to ensure accuracy on mobile
 * (where setInterval can be throttled when screen is off or app is backgrounded).
 */
export function useCountdownTimer(onComplete?: () => void) {
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const endTimeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    setSeconds(0);
    endTimeRef.current = 0;
  }, []);

  const start = useCallback((totalSeconds: number) => {
    stop();
    endTimeRef.current = Date.now() + totalSeconds * 1000;
    setSeconds(totalSeconds);
    setIsRunning(true);
    intervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      if (remaining <= 0) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        setIsRunning(false);
        setSeconds(0);
        endTimeRef.current = 0;
        onCompleteRef.current?.();
      } else {
        setSeconds(remaining);
      }
    }, 250);
  }, [stop]);

  const isWarning = isRunning && seconds <= 15;

  return { seconds, isRunning, isWarning, start, stop };
}
