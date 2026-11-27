/**
 * 뒤로 가기 때 초점 되돌리기: 목록에서 이름을 눌러 상세로 갈 때, 그 이름의 data-focus-key를
 * 목록 화면의 히스토리 항목(location.key)에 기억해 두고, 브라우저 뒤로 가기(POP)로 돌아오면 그 이름에 초점을 준다.
 */
const store = new Map<string, string>();
const MAX = 50;

export function rememberFocusKey(locationKey: string, focusKey: string): void {
  if (!locationKey || !focusKey) return;
  store.delete(locationKey);
  store.set(locationKey, focusKey);
  while (store.size > MAX) store.delete(store.keys().next().value as string);
}

export function peekFocusKey(locationKey: string): string | null {
  return store.get(locationKey) ?? null;
}

export function takeFocusKey(locationKey: string): string | null {
  const v = store.get(locationKey) ?? null;
  store.delete(locationKey);
  return v;
}

/** 속성 선택자에 넣을 수 있게 따옴표·역슬래시를 이스케이프한다 */
export function focusKeySelector(key: string): string {
  return `[data-focus-key="${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}
