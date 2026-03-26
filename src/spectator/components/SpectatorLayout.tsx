import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ErrorBoundary from '@shared/components/ErrorBoundary';
import NotificationToast from '@shared/components/NotificationToast';
import { useFavorites, useTournaments, useMatches, useSchedule } from '@shared/hooks/useFirebase';
import { useMatchNotifications } from '../hooks/useMatchNotifications';
import { usePushNotifications } from '@shared/hooks/usePushNotifications';
import { useMemo } from 'react';

// Global notification watcher - runs on all spectator pages
function NotificationWatcher() {
  const { favoriteIds } = useFavorites();
  const { tournaments } = useTournaments();

  // Find first active tournament to watch
  const activeTournamentId = useMemo(
    () => tournaments.find(t => t.status === 'in_progress')?.id || null,
    [tournaments]
  );

  const { matches } = useMatches(activeTournamentId);
  const { schedule } = useSchedule(activeTournamentId);

  useMatchNotifications(favoriteIds, matches, schedule);

  // Keep push subscription in sync with favorites
  usePushNotifications(favoriteIds);

  return null; // No UI
}

interface SpectatorLayoutProps {
  children: ReactNode;
}

export default function SpectatorLayout({ children }: SpectatorLayoutProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Global notification watcher */}
      <NotificationWatcher />
      <NotificationToast />

      {/* Skip navigation - handled by global skip-link in App.tsx */}

      {/* Header */}
      <header
        aria-label={t('spectator.layout.headerAriaLabel')}
        style={{
          backgroundColor: '#111827',
          borderBottom: '2px solid #374151',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={() => navigate('/spectator')}
          className="btn"
          style={{
            background: 'none',
            color: 'var(--color-secondary)',
            padding: '0.5rem 0.75rem',
            fontSize: '1.1rem',
          }}
          aria-label={t('spectator.layout.homeAriaLabel')}
        >
          {t('spectator.layout.homeButton')}
        </button>
        <span
          aria-hidden="true"
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
        }}
      >
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>

      {/* Bottom tab navigation */}
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
        <NavLink
          to="/spectator"
          end
          className={({ isActive }) =>
            isActive ? 'nav-link active' : 'nav-link'
          }
          style={{
            flex: 1,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            textDecoration: 'none',
            fontSize: '1.25rem',
            fontWeight: 'bold',
          }}
          aria-label={t('spectator.layout.tournamentsAriaLabel')}
        >
          {t('spectator.layout.tournaments')}
        </NavLink>
        <NavLink
          to="/spectator/favorites"
          className={({ isActive }) =>
            isActive ? 'nav-link active' : 'nav-link'
          }
          style={{
            flex: 1,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            textDecoration: 'none',
            fontSize: '1.25rem',
            fontWeight: 'bold',
          }}
          aria-label={t('spectator.layout.favoritesAriaLabel')}
        >
          {t('spectator.layout.favorites')}
        </NavLink>
        <NavLink
          to="/spectator/practice"
          className={({ isActive }) =>
            isActive ? 'nav-link active' : 'nav-link'
          }
          style={{
            flex: 1,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            textDecoration: 'none',
            fontSize: '1.25rem',
            fontWeight: 'bold',
          }}
          aria-label={t('spectator.layout.practiceAriaLabel')}
        >
          {t('spectator.layout.practice')}
        </NavLink>
      </nav>
    </div>
  );
}
