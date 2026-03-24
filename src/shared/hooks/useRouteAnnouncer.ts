import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Route announcer hook for screen reader accessibility.
 * - Announces the page title on route changes via aria-live region
 * - Updates document.title on route changes
 * - Moves focus to main content or h1 on navigation
 */

const ROUTE_TITLES: Record<string, string> = {
  '/': '쇼다운 - 모드 선택',
  '/admin': '관리자 - 대시보드',
  '/admin/players': '관리자 - 선수 관리',
  '/admin/referees': '관리자 - 심판 관리',
  '/admin/courts': '관리자 - 경기장 관리',
  '/admin/settings': '관리자 - 설정',
  '/admin/tournament/new': '관리자 - 대회 생성',
  '/referee': '심판 - 로그인',
  '/referee/games': '심판 - 경기 목록',
  '/referee/practice': '심판 - 연습 모드',
  '/referee/practice/setup': '심판 - 연습 설정',
  '/referee/practice/play': '심판 - 연습 경기',
  '/referee/practice/history': '심판 - 연습 기록',
  '/spectator': '관람 - 대회 목록',
  '/spectator/favorites': '관람 - 즐겨찾기',
  '/spectator/practice': '관람 - 연습 경기',
};

function getPageTitle(pathname: string): string {
  // Exact match first
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];

  // Pattern matching for dynamic routes
  if (pathname.startsWith('/admin/tournament/')) return '관리자 - 대회 상세';
  if (pathname.startsWith('/referee/match/')) return '심판 - 경기 기록';
  if (pathname.startsWith('/referee/team/')) return '심판 - 팀전 기록';
  if (pathname.startsWith('/spectator/tournament/')) return '관람 - 대회 상세';
  if (pathname.startsWith('/spectator/match/')) return '관람 - 경기 관람';
  if (pathname.startsWith('/spectator/player/')) return '관람 - 선수 프로필';

  return '쇼다운 대회 관리';
}

export function useRouteAnnouncer() {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    const title = getPageTitle(location.pathname);
    document.title = title;

    // Skip announcement on first render (initial page load)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Announce the page title to screen readers
    setAnnouncement(title);

    // Move focus to main content area or h1 after navigation
    requestAnimationFrame(() => {
      const mainContent = document.getElementById('main-content');
      const h1 = mainContent?.querySelector('h1') || document.querySelector('h1');
      if (h1 instanceof HTMLElement) {
        h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: false });
      } else if (mainContent instanceof HTMLElement) {
        mainContent.setAttribute('tabindex', '-1');
        mainContent.focus({ preventScroll: false });
      }
    });
  }, [location.pathname]);

  return announcement;
}
