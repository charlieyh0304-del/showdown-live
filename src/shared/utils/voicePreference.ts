/**
 * 음성 안내(TTS) 사용 설정 — 기기별 저장, 기본값은 꺼짐(소유자 요구).
 * 화면낭독기 사용자는 aria-live로 같은 내용을 듣으므로, 음성 안내는 원하는 사람만 켠다.
 */
const KEY = 'showdown.voiceAnnouncements';
const listeners = new Set<(on: boolean) => void>();

export function isVoiceEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setVoiceEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'on');
    else localStorage.removeItem(KEY);
  } catch {
    // 저장 불가(사생활 보호 모드 등): 이번 화면에서만 적용되지 않으며 기본값(꺼짐)을 유지한다
  }
  listeners.forEach(l => l(on));
}

export function subscribeVoice(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
