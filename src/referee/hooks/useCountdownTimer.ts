import { useState, useRef, useCallback } from 'react';

export function useCountdownTimer(onComplete?: () => void) {
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    setSeconds(0);
  }, []);

  const start = useCallback((totalSeconds: number) => {
    stop();
    setSeconds(totalSeconds);
    setIsRunning(true);
    intervalRef.current = setInterval(() => {
      setSeconds(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          setIsRunning(false);
          onComplete?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stop, onComplete]);

  const isWarning = isRunning && seconds <= 15;

  return { seconds, isRunning, isWarning, start, stop };
}
