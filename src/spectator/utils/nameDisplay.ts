/**
 * 이름 표기: 선수 데이터에 영문(로마자) 이름이 있을 때만 '한글 이름 (영문)'으로 함께 보이는 선택을 준다.
 * 데이터가 없으면 이름 그대로.
 */
const KEY = 'showdown_spectator_show_roman';

export function romanNameOf(p: unknown): string {
  if (!p || typeof p !== 'object') return '';
  const x = p as Record<string, unknown>;
  for (const k of ['nameEn', 'romanizedName', 'englishName', 'nameRoman']) {
    const v = x[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** 이름 → 영문 이름 */
export function buildRomanMap(players: ReadonlyArray<{ name?: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of players) {
    const r = romanNameOf(p);
    if (p.name && r && r !== p.name) out.set(p.name, r);
  }
  return out;
}

export function formatDisplayName(name: string, roman: ReadonlyMap<string, string>, showRoman: boolean): string {
  const r = showRoman ? roman.get(name) : undefined;
  return r ? `${name} (${r})` : name;
}

export function loadShowRoman(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function saveShowRoman(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}
