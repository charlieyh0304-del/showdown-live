import { useRef, useCallback } from 'react';

export function useAudioFeedback() {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  const playTone = useCallback((freq: number, duration: number, type: OscillatorType = 'sine') => {
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.value = 0.3;
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);
      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);
    } catch { /* 오디오 불가 환경 무시 */ }
  }, [getCtx]);

  return {
    scoreUp: useCallback(() => playTone(880, 150), [playTone]),
    scoreDown: useCallback(() => playTone(220, 200), [playTone]),
    setComplete: useCallback(() => {
      playTone(523, 150);
      setTimeout(() => playTone(659, 150), 160);
      setTimeout(() => playTone(784, 300), 320);
    }, [playTone]),
    matchComplete: useCallback(() => {
      playTone(523, 200);
      setTimeout(() => playTone(659, 200), 220);
      setTimeout(() => playTone(784, 200), 440);
      setTimeout(() => playTone(1047, 400), 660);
    }, [playTone]),
    fault: useCallback(() => playTone(200, 300, 'sawtooth'), [playTone]),
    error: useCallback(() => {
      playTone(200, 200, 'square');
      setTimeout(() => playTone(150, 300, 'square'), 220);
    }, [playTone]),
  };
}
