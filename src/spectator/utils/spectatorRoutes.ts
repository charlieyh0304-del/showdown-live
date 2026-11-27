/**
 * 관전 대회 화면 주소 (/spectator/tournament/:id/<나머지>) 해석. 구역마다, 선수·심판마다 주소가 있어
 * 브라우저 뒤로 가기와 링크 공유가 된다. 예전 주소(players, standings, schedule, referees)도 그대로 열린다.
 */
export const SPECTATOR_SECTIONS = ['live', 'schedule', 'standings', 'bracket', 'next', 'players', 'referees', 'settings'] as const;
export type SpectatorSection = typeof SPECTATOR_SECTIONS[number];

export type SpectatorRoute =
  | { kind: 'section'; section: SpectatorSection }
  | { kind: 'player'; key: string }
  | { kind: 'referee'; key: string };

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function parseSpectatorPath(rest: string): SpectatorRoute {
  const parts = rest.split('/').filter(Boolean);
  if (parts[0] === 'player' && parts[1]) return { kind: 'player', key: decode(parts.slice(1).join('/')) };
  if (parts[0] === 'referee' && parts[1]) return { kind: 'referee', key: decode(parts.slice(1).join('/')) };
  const s = parts[0] === 'overview' ? 'live' : parts[0];
  if (s && (SPECTATOR_SECTIONS as readonly string[]).includes(s)) return { kind: 'section', section: s as SpectatorSection };
  return { kind: 'section', section: 'live' };
}

export function sectionPath(tournamentId: string, section: SpectatorSection): string {
  return section === 'live' ? `/spectator/tournament/${tournamentId}` : `/spectator/tournament/${tournamentId}/${section}`;
}

export function playerPath(tournamentId: string, key: string): string {
  return `/spectator/tournament/${tournamentId}/player/${encodeURIComponent(key)}`;
}

export function refereePath(tournamentId: string, id: string): string {
  return `/spectator/tournament/${tournamentId}/referee/${encodeURIComponent(id)}`;
}
