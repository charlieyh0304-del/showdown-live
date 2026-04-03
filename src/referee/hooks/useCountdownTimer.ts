import { useState, useRef, useCallback } from 'react';

/**
 * Time-based countdown timer.
 * Uses absolute end time instead of decrementing to ensure accuracy on mobile
 * (where setInterval can be throttled when screen is off or app is backgrounded).
 *
 * Mobile audio fix: pre-warms AudioContext on start() (user gesture context)
 * so that onComplete callback can play sounds even from setInterval.
 */

// Shared AudioContext for timer alarm — pre-warmed on user gesture
let sharedAudioCtx: AudioContext | null = null;
function getOrCreateAudioCtx(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

function playAlarmTone() {
  try {
    const ctx = getOrCreateAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 3200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.8);
  } catch { /* audio not available */ }
}

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

    // Pre-warm AudioContext on user gesture (start is always called from user interaction)
    try {
      const ctx = getOrCreateAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      // Silent tone to fully activate audio pipeline on mobile
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
    } catch { /* ignore */ }

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
        // Play alarm tone directly (bypasses useWhistle's AudioContext issues)
        playAlarmTone();
        onCompleteRef.current?.();
      } else {
        setSeconds(remaining);
      }
    }, 250);
  }, [stop]);

  const isWarning = isRunning && seconds <= 15;

  return { seconds, isRunning, isWarning, start, stop };
}
