import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ErrorBoundary from '@shared/components/ErrorBoundary';
import NotificationToast from '@shared/components/NotificationToast';
import { useFavorites, useTournaments, useMatches, useSchedule } from '@shared/hooks/useFirebase';
import { useMatchNotifications } from '../hooks/useMatchNotifications';
import { usePushNotifications } from '@shared/hooks/usePushNotifications';
import { useNotificationSettings } from '@shared/hooks/useNotificationSettings';

// Global notification watcher - deferred to avoid blocking initial render
function NotificationWatcher() {
  const [ready, setReady] = useState(false);

  // Defer heavy subscriptions to avoid freezing on iOS navigation
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) return null;
  return <NotificationWatcherInner />;
}

function NotificationWatcherInner() {
  const { favoriteIds, favorites } = useFavorites();
  const { tournaments } = useTournaments();

  // Pick any active tournament (in_progress first, then registration, then any)
  const activeTournamentId = useMemo(
    () => tournaments.find(t => t.status === 'in_progress')?.id
      || tournaments.find(t => t.status === 'registration')?.id
      || tournaments[0]?.id
      || null,
    [tournaments]
  );

  const { matches } = useMatches(activeTournamentId);
  const { schedule } = useSchedule(activeTournamentId);
  const { settings: notifSettings } = useNotificationSettings();

  const { pushEnabled } = usePushNotifications(favorites);
  useMatchNotifications(favoriteIds, matches, schedule, notifSettings, pushEnabled);

  return null;
}

/** Extract tournament ID from pathname like /spectator/tournament/abc123/players */
function useTournamentContext() {
  const location = useLocation();
  const match = location.pathname.match(/^\/spectator\/tournament\/([^/]+)/);
  return match ? match[1] : null;
}

const baseNavStyle = {
  flex: 1,
  textAlign: 'center' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  padding: '0.625rem 0.25rem',
  textDecoration: 'none',
  fontSize: '0.8125rem',
  gap: '0.125rem',
  minHeight: '56px',
};

const getNavStyle = ({ isActive }: { isActive: boolean }) => ({
  ...baseNavStyle,
  backgroundColor: isActive ? '#ffff00' : 'transparent',
  color: isActive ? '#000000' : '#d1d5db',
  fontWeight: isActive ? 800 : 600,
  borderBottom: isActive ? '3px solid #ffff00' : '3px solid transparent',
} as const);

interface SpectatorLayoutProps {
  children: ReactNode;
}

export default function SpectatorLayout({ children }: SpectatorLayoutProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const location = useLocation();
  const tournamentId = useTournamentContext();

  const isTabActive = useCallback((path: string, exact = false) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  }, [location.pathname]);

  const handleNavKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const tabs = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
    const currentIdx = Array.from(tabs).findIndex(tab => tab === document.activeElement);
    if (currentIdx === -1) return;

    let nextIdx = currentIdx;
    if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
    else return;

    e.preventDefault();
    tabs[nextIdx].focus();
    tabs[nextIdx].click();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Global notification watcher */}
      <NotificationWatcher />
      <NotificationToast />

      {/* Header */}
      <header
        aria-label={t('spectator.layout.headerAriaLabel')}
        style={{
          backgroundColor: '#111827',
          borderBottom: '2px solid #374151',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {tournamentId ? (
          <button
            onClick={() => navigate('/spectator')}
            className="btn"
            style={{
              background: 'none',
              color: 'var(--color-secondary)',
              padding: '0.5rem 0.75rem',
              fontSize: '1.1rem',
              position: 'absolute',
              left: '0.5rem',
            }}
            aria-label={t('spectator.layout.backToListAriaLabel')}
          >
            {t('spectator.layout.backToList')}
          </button>
        ) : null}
        <span
          style={{
            fontSize: '1.5rem',
            fontWeight: 'bold',
            color: 'var(--color-primary)',
          }}
        >
          {t('spectator.layout.headerTitle')}
        </span>
      </header>

      {/* Main content area */}
      <main
        id="main-content"
        style={{
          flex: 1,
          padding: '1rem',
          paddingBottom: '5rem',
          overflowY: 'auto',
          maxWidth: '64rem',
          marginLeft: 'auto',
          marginRight: 'auto',
          width: '100%',
        }}
      >
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>

      {/* Bottom tab navigation - context-aware */}
      <nav
        role="tablist"
        onKeyDown={handleNavKeyDown}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#111827',
          borderTop: '2px solid #374151',
          display: 'flex',
          zIndex: 40,
        }}
        aria-label={t('spectator.layout.bottomNavAriaLabel')}
      >
        {tournamentId ? (
          /* Tournament context: 5 tabs */
          <>
            <NavLink
              to={`/spectator/tournament/${tournamentId}`}
              end
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={getNavStyle}
              role="tab"
              aria-selected={isTabActive(`/spectator/tournament/${tournamentId}`, true)}
              aria-current={isTabActive(`/spectator/tournament/${tournamentId}`, true) ? 'page' : undefined}
              aria-label={t('spectator.layout.tournamentTab.overviewAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#9889;</span>
              {t('spectator.layout.tournamentTab.overview')}
            </NavLink>
            <NavLink
              to={`/spectator/tournament/${tournamentId}/players`}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={getNavStyle}
              role="tab"
              aria-selected={isTabActive(`/spectator/tournament/${tournamentId}/players`)}
              aria-current={isTabActive(`/spectator/tournament/${tournamentId}/players`) ? 'page' : undefined}
              aria-label={t('spectator.layout.tournamentTab.playersAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#128101;</span>
              {t('spectator.layout.tournamentTab.players')}
            </NavLink>
            <NavLink
              to={`/spectator/tournament/${tournamentId}/standings`}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={getNavStyle}
              role="tab"
              aria-selected={isTabActive(`/spectator/tournament/${tournamentId}/standings`)}
              aria-current={isTabActive(`/spectator/tournament/${tournamentId}/standings`) ? 'page' : undefined}
              aria-label={t('spectator.layout.tournamentTab.standingsAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#127942;</span>
              {t('spectator.layout.tournamentTab.standings')}
            </NavLink>
            <NavLink
              to={`/spectator/tournament/${tournamentId}/schedule`}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={getNavStyle}
              role="tab"
              aria-selected={isTabActive(`/spectator/tournament/${tournamentId}/schedule`)}
              aria-current={isTabActive(`/spectator/tournament/${tournamentId}/schedule`) ? 'page' : undefined}
              aria-label={t('spectator.layout.tournamentTab.scheduleAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#128197;</span>
              {t('spectator.layout.tournamentTab.schedule')}
            </NavLink>
            <NavLink
              to={`/spectator/tournament/${tournamentId}/referees`}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={getNavStyle}
              role="tab"
              aria-selected={isTabActive(`/spectator/tournament/${tournamentId}/referees`)}
              aria-current={isTabActive(`/spectator/tournament/${tournamentId}/referees`) ? 'page' : undefined}
              aria-label={t('spectator.layout.tournamentTab.refereesAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#128084;</span>
              {t('spectator.layout.tournamentTab.referees')}
            </NavLink>
          </>
        ) : (
          /* Home context: 3 tabs */
          <>
            <NavLink
              to="/spectator"
              end
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={getNavStyle}
              role="tab"
              aria-selected={isTabActive('/spectator', true)}
              aria-current={isTabActive('/spectator', true) ? 'page' : undefined}
              aria-label={t('spectator.layout.tournamentsAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#127942;</span>
              {t('spectator.layout.tournaments')}
            </NavLink>
            <NavLink
              to="/spectator/favorites"
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={getNavStyle}
              role="tab"
              aria-selected={isTabActive('/spectator/favorites')}
              aria-current={isTabActive('/spectator/favorites') ? 'page' : undefined}
              aria-label={t('spectator.layout.favoritesAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#11088;</span>
              {t('spectator.layout.favorites')}
            </NavLink>
            <NavLink
              to="/spectator/practice"
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={getNavStyle}
              role="tab"
              aria-selected={isTabActive('/spectator/practice')}
              aria-current={isTabActive('/spectator/practice') ? 'page' : undefined}
              aria-label={t('spectator.layout.practiceAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#127947;</span>
              {t('spectator.layout.practice')}
            </NavLink>
          </>
        )}
      </nav>
    </div>
  );
}
