import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Match } from '@shared/types';
import { cacheKey, loadSnapshot, MAX_SNAPSHOTS, parseSnapshot, saveSnapshot, serializeSnapshot } from './spectatorCache';

/** 용량 제한이 있는 메모리 localStorage */
function memoryStorage(quota = Number.POSITIVE_INFINITY) {
  const data = new Map<string, string>();
  const size = () => [...data.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    data,
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const prev = data.get(k);
      data.set(k, v);
      if (size() > quota) {
        if (prev === undefined) data.delete(k); else data.set(k, prev);
        throw new Error('QuotaExceededError');
      }
    },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

const snap = (n: number, extra = '') => ({
  savedAt: 1000 + n,
  tournament: null,
  matches: [{ id: `m${n}`, scoreHistory: [{ a: 1 }], note: extra } as unknown as Match],
  schedule: [],
});

describe('spectatorCache', () => {
  let store: ReturnType<typeof memoryStorage>;
  beforeEach(() => { store = memoryStorage(); vi.stubGlobal('localStorage', store); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('round-trips a snapshot without heavy fields and rejects corrupt data', () => {
    const raw = serializeSnapshot(snap(1));
    const back = parseSnapshot(raw)!;
    expect(back.savedAt).toBe(1001);
    expect((back.matches[0] as unknown as Record<string, unknown>).scoreHistory).toBeUndefined();
    expect(parseSnapshot('{bad')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v: 999, savedAt: 1, matches: [] }))).toBeNull();
  });

  it(`keeps only the ${MAX_SNAPSHOTS} most recently viewed tournaments`, () => {
    store.setItem('showdown_favorites', '["keep me"]');
    for (let i = 1; i <= MAX_SNAPSHOTS + 2; i++) saveSnapshot(`t${i}`, snap(i));
    saveSnapshot('t3', snap(3)); // 다시 본 대회는 가장 최근으로
    saveSnapshot('t9', snap(9));
    const cached = [...store.data.keys()].filter(k => k.startsWith('showdown_spectator_cache_t'));
    expect(cached.length).toBe(MAX_SNAPSHOTS);
    expect(loadSnapshot('t3')).not.toBeNull();
    expect(loadSnapshot('t9')).not.toBeNull();
    expect(loadSnapshot('t1')).toBeNull();
    expect(store.getItem('showdown_favorites')).toBe('["keep me"]');
  });

  it('evicts older caches and retries once when storage is full, so other settings still fit', () => {
    store = memoryStorage(3000);
    vi.stubGlobal('localStorage', store);
    saveSnapshot('old', snap(1, 'x'.repeat(1200)));
    expect(loadSnapshot('old')).not.toBeNull();
    // old(약 1.3KB) + new(약 1.9KB)는 3KB를 넘는다: 저장 실패 → 다른 캐시를 지우고 한 번 더 시도
    saveSnapshot('new', snap(2, 'y'.repeat(1800)));
    expect(loadSnapshot('new')).not.toBeNull();
    expect(store.getItem(cacheKey('old'))).toBeNull();
    // 너무 커서 안 들어가면 조용히 포기한다 (예외 없음)
    expect(() => saveSnapshot('huge', snap(3, 'z'.repeat(5000)))).not.toThrow();
    expect(loadSnapshot('huge')).toBeNull();
    expect(() => store.setItem('showdown_accessibility', '{"fontLevel":2}')).not.toThrow();
  });
});
