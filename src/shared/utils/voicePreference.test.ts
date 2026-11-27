import { describe, it, expect, beforeEach, vi } from 'vitest';

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
}

describe('voicePreference', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules(); stubStorage(); });

  it('기본값은 꺼짐', async () => {
    const { isVoiceEnabled } = await import('./voicePreference');
    expect(isVoiceEnabled()).toBe(false);
  });

  it('켜고 끄면 저장되고 구독자에게 알린다', async () => {
    const { isVoiceEnabled, setVoiceEnabled, subscribeVoice } = await import('./voicePreference');
    const seen: boolean[] = [];
    const off = subscribeVoice(v => seen.push(v));
    setVoiceEnabled(true);
    expect(isVoiceEnabled()).toBe(true);
    setVoiceEnabled(false);
    expect(isVoiceEnabled()).toBe(false);
    off();
    setVoiceEnabled(true);
    expect(seen).toEqual([true, false]);
  });

  it('저장소 접근이 막히면 꺼짐으로 동작', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    const { isVoiceEnabled, setVoiceEnabled } = await import('./voicePreference');
    expect(() => setVoiceEnabled(true)).not.toThrow();
    expect(isVoiceEnabled()).toBe(false);
  });

  it('꺼져 있으면 speak()가 음성을 내지 않고, 켜면 낸다', async () => {
    const spoken: string[] = [];
    class Utter { text: string; lang = ''; rate = 1; volume = 1; constructor(t: string) { this.text = t; } }
    vi.stubGlobal('SpeechSynthesisUtterance', Utter);
    vi.stubGlobal('navigator', { userAgent: 'test' });
    vi.stubGlobal('window', { speechSynthesis: { cancel: () => {}, speak: (u: Utter) => spoken.push(u.text) } });
    const { speak } = await import('./locale');
    const { setVoiceEnabled } = await import('./voicePreference');
    speak('하나');
    expect(spoken).toEqual([]);
    setVoiceEnabled(true);
    speak('둘');
    expect(spoken).toEqual(['둘']);
  });
});
