import { type ReactNode, useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ErrorBoundary from '@shared/components/ErrorBoundary';
import NotificationToast from '@shared/components/NotificationToast';
import { useFavorites, useTournaments, useMatches, useSchedule } from '@shared/hooks/useFirebase';
import { useMatchNotifications } from '../hooks/useMatchNotifications';
import { usePushNotifications } from '@shared/hooks/usePushNotifications';
import { useNotificationSettings } from '@shared/hooks/useNotificationSettings';
import { useMemo } from 'react';

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

  useMatchNotifications(favoriteIds, matches, schedule, notifSettings);
  usePushNotifications(favorites);

  return null;
}

/** Extract tournament ID from pathname like /spectator/tournament/abc123/players */
function useTournamentContext() {
  const location = useLocation();
  const match = location.pathname.match(/^\/spectator\/tournament\/([^/]+)/);
  return match ? match[1] : null;
}

const navLinkStyle = {
  flex: 1,
  textAlign: 'center' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  padding: '0.625rem 0.25rem',
  textDecoration: 'none',
  fontSize: '0.8125rem',
  fontWeight: 'bold' as const,
  gap: '0.125rem',
  minHeight: '56px',
};

interface SpectatorLayoutProps {
  children: ReactNode;
}

export default function SpectatorLayout({ children }: SpectatorLayoutProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const tournamentId = useTournamentContext();

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
              style={navLinkStyle}
              aria-label={t('spectator.layout.tournamentTab.overviewAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#9889;</span>
              {t('spectator.layout.tournamentTab.overview')}
            </NavLink>
            <NavLink
              to={`/spectator/tournament/${tournamentId}/players`}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={navLinkStyle}
              aria-label={t('spectator.layout.tournamentTab.playersAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#128101;</span>
              {t('spectator.layout.tournamentTab.players')}
            </NavLink>
            <NavLink
              to={`/spectator/tournament/${tournamentId}/standings`}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={navLinkStyle}
              aria-label={t('spectator.layout.tournamentTab.standingsAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#127942;</span>
              {t('spectator.layout.tournamentTab.standings')}
            </NavLink>
            <NavLink
              to={`/spectator/tournament/${tournamentId}/schedule`}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={navLinkStyle}
              aria-label={t('spectator.layout.tournamentTab.scheduleAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#128197;</span>
              {t('spectator.layout.tournamentTab.schedule')}
            </NavLink>
            <NavLink
              to={`/spectator/tournament/${tournamentId}/referees`}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={navLinkStyle}
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
              style={navLinkStyle}
              aria-label={t('spectator.layout.tournamentsAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#127942;</span>
              {t('spectator.layout.tournaments')}
            </NavLink>
            <NavLink
              to="/spectator/favorites"
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={navLinkStyle}
              aria-label={t('spectator.layout.favoritesAriaLabel')}
            >
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>&#11088;</span>
              {t('spectator.layout.favorites')}
            </NavLink>
            <NavLink
              to="/spectator/practice"
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
              style={navLinkStyle}
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
