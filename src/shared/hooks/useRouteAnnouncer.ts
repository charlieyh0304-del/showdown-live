import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
    setAnnouncement(title);

    // Move focus to main content area or h1 after navigation
    requestAnimationFrame(() => {
      const mainContent = document.getElementById('main-content');
      const h1 = mainContent?.querySelector('h1') || document.querySelector('h1');
      const target = h1 || mainContent;
      if (target instanceof HTMLElement) {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: false });
        // Remove tabindex after focus to avoid persistent tab stop
        const cleanup = () => { target.removeAttribute('tabindex'); target.removeEventListener('blur', cleanup); };
        target.addEventListener('blur', cleanup);
      }
    });
  }, [location.pathname, t]);

  return announcement;
}
