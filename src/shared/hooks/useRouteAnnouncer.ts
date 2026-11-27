import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { focusKeySelector, takeFocusKey } from '../utils/focusReturn';
import { useTranslation } from 'react-i18next';

/**
 * Route announcer hook for screen reader accessibility.
 * - Announces the page title on route changes via aria-live region
 * - Updates document.title on route changes
 * - Moves focus to main content or h1 on navigation
 */

const ROUTE_KEYS: Record<string, string> = {
  '/': 'common.routes.modeSelect',
  '/admin': 'common.routes.adminDashboard',
  '/admin/players': 'common.routes.adminPlayers',
  '/admin/referees': 'common.routes.adminReferees',
  '/admin/courts': 'common.routes.adminCourts',
  '/admin/settings': 'common.routes.adminSettings',
  '/admin/tournament/new': 'common.routes.adminTournamentNew',
  '/referee': 'common.routes.refereeLogin',
  '/referee/games': 'common.routes.refereeGames',
  '/referee/practice': 'common.routes.refereePractice',
  '/referee/practice/setup': 'common.routes.refereePracticeSetup',
  '/referee/practice/play': 'common.routes.refereePracticePlay',
  '/referee/practice/history': 'common.routes.refereePracticeHistory',
  '/spectator': 'common.routes.spectatorTournaments',
  '/spectator/favorites': 'common.routes.spectatorFavorites',
  '/spectator/practice': 'common.routes.spectatorPractice',
};

function getPageTitleKey(pathname: string): string {
  if (ROUTE_KEYS[pathname]) return ROUTE_KEYS[pathname];

  if (pathname.startsWith('/admin/tournament/')) return 'common.routes.adminTournamentDetail';
  if (pathname.startsWith('/referee/match/')) return 'common.routes.refereeMatch';
  if (pathname.startsWith('/referee/team/')) return 'common.routes.refereeTeamMatch';
  if (pathname.startsWith('/spectator/tournament/')) return 'common.routes.spectatorTournamentDetail';
  if (pathname.startsWith('/spectator/match/')) return 'common.routes.spectatorMatch';
  if (pathname.startsWith('/spectator/player/')) return 'common.routes.spectatorPlayer';

  return 'common.routes.defaultTitle';
}

export function useRouteAnnouncer() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    const titleKey = getPageTitleKey(location.pathname);
    const title = t(titleKey);
    document.title = title;

    // Skip announcement on first render (initial page load)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Announce the page title to screen readers
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnnouncement(title);

    // 뒤로 가기(POP)로 돌아왔고 떠날 때 누른 이름이 기억되어 있으면 그 이름으로 초점을 되돌린다(데이터가 늦게 그려질 수 있어 몇 번 다시 찾는다)
    const restoreKey = navigationType === 'POP' ? takeFocusKey(location.key) : null;
    let cancelled = false;
    const focusDefault = () => {
      const mainContent = document.getElementById('main-content');
      // 화면이 지정한 초점 대상(구역 제목 등) → h1 → 본문
      const preferred = mainContent?.querySelector<HTMLElement>('[data-route-focus]');
      const h1 = mainContent?.querySelector('h1') || document.querySelector('h1');
      const target = preferred || h1 || mainContent;
      const title = preferred?.getAttribute('data-route-title');
      if (title) { document.title = title; setAnnouncement(title); }
      if (target instanceof HTMLElement) {
        const hadTabIndex = target.hasAttribute('tabindex');
        if (!hadTabIndex) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: false });
        // Remove tabindex after focus to avoid persistent tab stop
        const cleanup = () => { if (!hadTabIndex) target.removeAttribute('tabindex'); target.removeEventListener('blur', cleanup); };
        target.addEventListener('blur', cleanup);
      }
    };
    const tryRestore = (attempt: number) => {
      if (cancelled) return;
      const el = restoreKey ? document.querySelector<HTMLElement>(focusKeySelector(restoreKey)) : null;
      if (el) { el.focus(); return; }
      if (restoreKey && attempt < 20) { setTimeout(() => tryRestore(attempt + 1), 50); return; }
      focusDefault();
    };
    requestAnimationFrame(() => tryRestore(0));
    return () => { cancelled = true; };
    // 검색 파라미터(필터)만 바뀔 때는 초점을 옮기지 않는다: 경로가 바뀔 때만 실행한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, t]);

  return announcement;
}
