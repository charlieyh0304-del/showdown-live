import { useRef, useCallback } from 'react';

/**
 * Referee whistle sounds using Web Audio API.
 * - shortWhistle: 1-point score, warning (~300ms)
 * - longWhistle: match start/end, timeout start/end, warmup end (~800ms)
 * - goalWhistle: goal (2-point) - two short blasts
 *
 * All functions handle AudioContext suspension (mobile first-interaction requirement)
 * by awaiting resume() before scheduling tones.
 */
export function useWhistle() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureCtx = useCallback(async (): Promise<AudioContext> => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    if (ctxRef.current.state === 'suspended') {
      await ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const playTone = useCallback((ctx: AudioContext, startTime: number, duration: number) => {
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
  }, []);

  const shortWhistle = useCallback(() => {
    ensureCtx().then(ctx => playTone(ctx, ctx.currentTime, 300)).catch(() => {});
  }, [ensureCtx, playTone]);

  const longWhistle = useCallback(() => {
    ensureCtx().then(ctx => playTone(ctx, ctx.currentTime, 800)).catch(() => {});
  }, [ensureCtx, playTone]);

  const goalWhistle = useCallback(() => {
    ensureCtx().then(ctx => {
      const now = ctx.currentTime;
      playTone(ctx, now, 300);
      playTone(ctx, now + 0.4, 300);
    }).catch(() => {});
  }, [ensureCtx, playTone]);

  return { shortWhistle, longWhistle, goalWhistle };
}
