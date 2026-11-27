/**
 * 재현 가능한 난수 (추첨·랜덤 팀 편성·제비뽑기 동률 처리용).
 *
 * 순수 모듈. functions/src/shared/rules/rng.ts는 이 파일의 사본이다(scripts/sync-shared-rules.mjs).
 * 같은 seed 문자열이면 항상 같은 결과가 나오므로, seed를 저장해 두면 누구나 결과를 다시 확인할 수 있다.
 */

/** 문자열을 32비트 정수로 (FNV-1a) */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: seed 문자열로 [0,1) 난수 생성기를 만든다 */
export function createRng(seed: string): () => number {
  let a = hashString(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates 셔플 (원본 불변) */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = createRng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 새 추첨 seed (저장용). 호출부가 시각/난수를 넘겨 순수성을 유지한다. */
export function makeSeed(now: number, random: number): string {
  return `${now.toString(36)}-${Math.floor(random * 1e9).toString(36)}`;
}
