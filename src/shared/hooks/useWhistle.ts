import { useRef, useCallback } from 'react';

/**
 * Referee whistle sounds using Web Audio API.
 * - shortWhistle: 1-point score, warning (~300ms)
 * - longWhistle: match start/end, timeout start/end, warmup start/end (~800ms)
 * - goalWhistle: goal (2-point) - short + long (~2 blasts)
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

  const playWhistleTone = useCallback((duration: number) => {
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;

      // Main whistle oscillator (~3200 Hz)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 3200;

      // Second harmonic for richness (~6400 Hz, quieter)
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 6400;

      // Vibrato LFO for realism
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 5.5; // vibrato rate
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 30; // vibrato depth in Hz
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);

      // Gain nodes
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();
      const masterGain = ctx.createGain();

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(masterGain);
      gain2.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Envelope
      const dur = duration / 1000;
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.35, now + 0.02); // fast attack
      gain1.gain.setValueAtTime(0.35, now + dur - 0.05);
      gain1.gain.linearRampToValueAtTime(0, now + dur);

      gain2.gain.setValueAtTime(0, now);
      gain2.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain2.gain.setValueAtTime(0.08, now + dur - 0.05);
      gain2.gain.linearRampToValueAtTime(0, now + dur);

      masterGain.gain.value = 0.6;

      osc1.start(now);
      osc2.start(now);
      lfo.start(now);
      osc1.stop(now + dur);
      osc2.stop(now + dur);
      lfo.stop(now + dur);
    } catch {
      /* audio not available */
    }
  }, [getCtx]);

  const shortWhistle = useCallback(() => {
    playWhistleTone(300);
  }, [playWhistleTone]);

  const longWhistle = useCallback(() => {
    playWhistleTone(800);
  }, [playWhistleTone]);

  const goalWhistle = useCallback(() => {
    playWhistleTone(300);
    setTimeout(() => playWhistleTone(300), 400);
  }, [playWhistleTone]);

  return { shortWhistle, longWhistle, goalWhistle };
}
