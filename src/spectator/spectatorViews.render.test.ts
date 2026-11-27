import { it, expect, vi, describe } from 'vitest';

// CI에는 Firebase 설정이 없다: 화면 렌더만 보므로 Firebase와 데이터 훅을 대체한다
vi.mock('../shared/config/firebase', () => ({ database: {}, auth: { currentUser: null }, authReady: Promise.resolve(), default: {} }));

const now = Date.now();
const tournaments = [
  { id: 'done', name: '지난 대회', status: 'completed', date: '2026-01-01', type: 'individual' },
  { id: 'live', name: '진행 대회', status: 'in_progress', date: '2026-11-28', type: 'individual' },
  { id: 'soon', name: '예정 대회', status: 'registration', date: '2026-12-10', type: 'individual' },
];
const match = (id: string, extra: Record<string, unknown>) => ({ id, tournamentId: 'live', type: 'individual', round: 1, createdAt: 0, ...extra });
const matches = [
  match('m1', { status: 'in_progress', player1Id: 'p1', player1Name: '김철수', player2Id: 'p2', player2Name: '이영희', groupId: 'A', courtId: 'c1', courtName: '1번 코트', sets: [{ player1Score: 5, player2Score: 3 }], currentSet: 0 }),
  match('m2', { status: 'completed', player1Id: 'p1', player1Name: '김철수', player2Id: 'p3', player2Name: '박민수', groupId: 'A', winnerId: 'p1', sets: [{ player1Score: 11, player2Score: 5 }, { player1Score: 11, player2Score: 7 }], updatedAt: now }),
  match('f1', { status: 'pending', roundLabel: '결승', stageId: 'finals', sourceMatch1: 'm1', sourceMatch2: 'm2', scheduledTime: '23:59' }),
];
let tournamentList = tournaments;

vi.mock('../shared/hooks/useFirebase', () => ({
  useTournaments: () => ({ tournaments: tournamentList, loading: false }),
  useTournament: (id: string | null) => ({ tournament: id ? { ...tournaments[1], id, createdAt: 0, updatedAt: 0, gameConfig: { winScore: 11, setsToWin: 2 }, format: 'group_league' } : null, loading: false }),
  useMatches: () => ({ matches, loading: false }),
  useSchedule: () => ({ schedule: [] }),
  useReferees: () => ({ referees: [{ id: 'r1', name: '최심판', role: 'main', createdAt: 0 }] }),
  useTournamentReferees: () => ({ assignments: { r1: { assignedMatchIds: ['m1'] } } }),
  useTournamentLocalPlayers: () => ({ players: [] }),
  useFavorites: () => ({ favoriteIds: [], favorites: [], isFavorite: () => false, toggleFavorite: () => [] }),
  getFavoriteEntries: () => [],
  setFavoriteEntry: () => [],
}));
vi.mock('../shared/hooks/useConnection', () => ({ useConnection: () => ({ isOnline: true, status: 'online' }) }));

import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SpectatorHome from './pages/SpectatorHome';
import TournamentView from './pages/TournamentView';

function renderAt(path: string, el: ReturnType<typeof h>, routePath: string) {
  return renderToString(h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: routePath, element: el }))));
}

describe('spectator tournament list (entry)', () => {
  it('lists tournaments as links grouped live → upcoming → finished, never redirecting', () => {
    const html = renderAt('/spectator', h(SpectatorHome), '/spectator');
    const live = html.indexOf('진행 대회'), soon = html.indexOf('예정 대회'), done = html.indexOf('지난 대회');
    expect(live).toBeGreaterThan(-1);
    expect(live).toBeLessThan(soon);
    expect(soon).toBeLessThan(done);
    expect(html).toContain('href="/spectator/tournament/live"');
    expect(html).toContain('<h1');
    expect(html).toContain('type="search"');
  });

  it('with only one tournament it still shows the list (no auto-redirect)', () => {
    tournamentList = [tournaments[1]];
    const html = renderAt('/spectator', h(SpectatorHome), '/spectator');
    tournamentList = tournaments;
    expect(html).toContain('href="/spectator/tournament/live"');
    expect(html).toContain('spectator.home.title');
    // 대회 화면(구역 메뉴)으로 들어가지 않았다
    expect(html).not.toContain('spectator.sections.menuLabel');
  });
});

describe('spectator tournament view', () => {
  const view = (path: string) => renderAt(path, h(TournamentView), '/spectator/tournament/:id/*');

  it('has one h1 (tournament name), a section nav with aria-current, and the people search combobox', () => {
    const html = view('/spectator/tournament/live');
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain('진행 대회</h1>');
    expect(html).toContain('spectator.sections.menuLabel');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="search"');
    // 실시간 사건 알림 영역 (polite)
    expect(html).toContain('aria-live="polite"');
  });

  it('renders every section and the player / referee detail by deep link', () => {
    for (const s of ['', 'schedule', 'standings', 'bracket', 'next', 'players', 'referees', 'settings']) {
      const html = view(`/spectator/tournament/live${s ? `/${s}` : ''}`);
      expect(html).toContain('data-route-focus');
    }
    const standings = view('/spectator/tournament/live/standings');
    expect(standings).toContain('spectator.standings.provisional');
    expect(standings).toContain('spectator.rules.');
    const next = view('/spectator/tournament/live/next');
    // 미정 자리는 출처 경기로 읽는다
    expect(next).toContain('common.competitionRules.undecidedFrom');
    const players = view('/spectator/tournament/live/players');
    expect(players).toContain('href="/spectator/tournament/live/player/p1"');
    expect(players).toContain('data-focus-key="player:p1"');
    const player = view('/spectator/tournament/live/player/p1');
    expect(player).toContain('김철수');
    expect(player).toContain('spectator.person.standing');
    const ref = view('/spectator/tournament/live/referee/r1');
    expect(ref).toContain('spectator.person.refereeHeading');
    const schedule = view('/spectator/tournament/live/schedule?fav=1');
    expect(schedule).toContain('checked=""');
  });
});

describe('spectator shell (layout + routes)', () => {
  it('tournament detail deep link: one h1 (tournament name), a link back to the tournament list, skip-to-main target', async () => {
    // 앱 i18n(ErrorBoundary가 불러옴)은 시작할 때 localStorage를 읽는다
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
    const { default: SpectatorRoutes } = await import('./SpectatorRoutes');
    const html = renderAt('/spectator/tournament/live/standings', h(SpectatorRoutes), '/spectator/*');
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain('진행 대회</h1>');
    // (여기서는 앱 i18n이 초기화되어 실제 한국어 문구가 나온다)
    expect(html).toMatch(/<a [^>]*href="\/spectator"[^>]*>.*대회 목록으로<\/a>/);
    expect(html).toContain('id="main-content"');
    // 부가 하나뿐이면 부 선택창을 숨긴다
    expect(html).not.toContain('id="division-select"');
    vi.unstubAllGlobals();
  });
});
