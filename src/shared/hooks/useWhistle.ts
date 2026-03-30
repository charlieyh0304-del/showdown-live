import { useRef, useCallback } from 'react';

/**
 * Referee whistle sounds using Web Audio API.
 * - shortWhistle: 1-point score, warning (~300ms)
 * - longWhistle: match start/end, timeout start/end, warmup end (~800ms)
 * - goalWhistle: goal (2-point) - two short blasts with clear gap
 *
 * AudioContext.resume() is fire-and-forget (synchronous call) to preserve
 * iOS user-gesture context. Scheduled tones play once resume completes.
 */
export function useWhistle() {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const playTone = useCallback((ctx: AudioContext, startTime: number, duration: number) => {
    try {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 3200;

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 6400;

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 5.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 30;
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);

      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();
      const masterGain = ctx.createGain();

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(masterGain);
      gain2.connect(masterGain);
      masterGain.connect(ctx.destination);

      const dur = duration / 1000;
      gain1.gain.setValueAtTime(0, startTime);
      gain1.gain.linearRampToValueAtTime(0.35, startTime + 0.02);
      gain1.gain.setValueAtTime(0.35, startTime + dur - 0.05);
      gain1.gain.linearRampToValueAtTime(0, startTime + dur);

      gain2.gain.setValueAtTime(0, startTime);
      gain2.gain.linearRampToValueAtTime(0.08, startTime + 0.02);
      gain2.gain.setValueAtTime(0.08, startTime + dur - 0.05);
      gain2.gain.linearRampToValueAtTime(0, startTime + dur);

      masterGain.gain.value = 0.6;

      osc1.start(startTime);
      osc2.start(startTime);
      lfo.start(startTime);
      osc1.stop(startTime + dur);
      osc2.stop(startTime + dur);
      lfo.stop(startTime + dur);
    } catch {
      /* audio not available */
    }
  }, []);

  const shortWhistle = useCallback(() => {
    const ctx = getCtx();
    playTone(ctx, ctx.currentTime, 300);
  }, [getCtx, playTone]);

  const longWhistle = useCallback(() => {
    const ctx = getCtx();
    playTone(ctx, ctx.currentTime, 800);
  }, [getCtx, playTone]);

  const goalWhistle = useCallback(() => {
    const ctx = getCtx();
    const now = ctx.currentTime;
    playTone(ctx, now, 250);        // 0~250ms: first blast
    playTone(ctx, now + 0.4, 250);  // 400~650ms: second blast (150ms gap)
  }, [getCtx, playTone]);

  // Pre-warm AudioContext on user gesture (call during setup UI interactions)
  const initAudio = useCallback(() => {
    const ctx = getCtx();
    // Silent tone to fully activate audio pipeline on mobile
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
    } catch { /* ignore */ }
  }, [getCtx]);

  return { shortWhistle, longWhistle, goalWhistle, initAudio };
}
