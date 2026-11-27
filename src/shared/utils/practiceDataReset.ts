/**
 * 연습 모드 기록 1회 초기화 (소유자 요청, 2026-11-28 — 공개 테스트 전 데이터 정리).
 * 연습 기록은 DB가 아니라 각 기기의 브라우저 저장소에만 있으므로, 앱을 처음 여는 순간 기기마다 한 번 지운다.
 * 다시 초기화가 필요하면 RESET_VERSION을 올린다.
 */
export const PRACTICE_KEYS = [
  'showdown_practice_completed',
  'showdown_practice_live',
  'showdown_practice_history',
  'showdown_practice_match',
] as const;
const MARK_KEY = 'showdown_practice_reset';
const RESET_VERSION = '2026-11-28';

export function resetPracticeDataOnce(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(MARK_KEY) === RESET_VERSION) return false;
    for (const k of PRACTICE_KEYS) storage.removeItem(k);
    storage.setItem(MARK_KEY, RESET_VERSION);
    return true;
  } catch {
    return false; // 저장소 접근 불가(사생활 보호 모드 등): 지울 기록도 없다
  }
}
