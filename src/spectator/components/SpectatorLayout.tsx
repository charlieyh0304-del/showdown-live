import { type ReactNode, useState, useEffect, useMemo } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ErrorBoundary from '@shared/components/ErrorBoundary';
import AiChatPanel from '@shared/components/AiChatPanel';
import NotificationToast from '@shared/components/NotificationToast';
import { useFavorites, useTournaments, useMatches, useSchedule } from '@shared/hooks/useFirebase';
import { useMatchNotifications } from '../hooks/useMatchNotifications';
import { usePushNotifications } from '@shared/hooks/usePushNotifications';
import { useNotificationSettings } from '@shared/hooks/useNotificationSettings';
import { createSpectatorResponder } from '../utils/spectatorAssistant';

// Global notification watcher - deferred to avoid blocking initial render
function NotificationWatcher({ tournamentId }: { tournamentId: string | null }) {
  const [ready, setReady] = useState(false);

  // Defer heavy subscriptions to avoid freezing on iOS navigation
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) return null;
  return <NotificationWatcherInner currentTournamentId={tournamentId} />;
}

function NotificationWatcherInner({ currentTournamentId }: { currentTournamentId: string | null }) {
  const { favoriteIds, favorites } = useFavorites();
  const { tournaments } = useTournaments(20);

  // Pick any active tournament (in_progress first, then registration, then any)
  // 보고 있는 대회가 있으면 그 대회, 아니면 진행 중인 대회
  const activeTournamentId = useMemo(
    () => currentTournamentId
      || tournaments.find(t => t.status === 'in_progress')?.id
      || tournaments.find(t => t.status === 'registration')?.id
      || tournaments[0]?.id
      || null,
    [tournaments, currentTournamentId]
  );

  const { matches } = useMatches(activeTournamentId, 100);
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
  width: '100%',
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
  const { t } = useTranslation();
  const tournamentId = useTournamentContext();
  const responder = useMemo(() => ({ ...createSpectatorResponder(t), offlineNote: t('spectator.assistant.offlineNote') }), [t]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Global notification watcher */}
      <NotificationWatcher tournamentId={tournamentId} />
      <NotificationToast />

      <header
        style={{
          backgroundColor: '#111827',
          borderBottom: '2px solid #374151',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        {tournamentId ? (
          <Link
            to="/spectator"
            className="btn"
            style={{ background: 'none', color: 'var(--color-secondary)', padding: '0.5rem 0.75rem', fontSize: '1.1rem', position: 'absolute', left: '0.5rem', textDecoration: 'underline' }}
          >
            <span aria-hidden="true">← </span>{t('spectator.layout.backToTournamentList')}
          </Link>
        ) : null}
        <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>
          {t('spectator.layout.headerTitle')}
        </span>
      </header>

      <main
        id="main-content"
        style={{
          flex: 1,
          padding: '1rem',
          paddingBottom: tournamentId ? '6rem' : '5rem',
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

      {/* 대회 밖(목록·즐겨찾기·연습)에서만 아래 메뉴를 둔다. 대회 안 구역 메뉴는 대회 화면 위쪽에 있다. */}
      {!tournamentId && (
        <nav
          aria-label={t('spectator.nav.label')}
          style={{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: '#111827', borderTop: '2px solid #374151', zIndex: 40 }}
        >
          <ul style={{ display: 'flex', listStyle: 'none', margin: 0, padding: 0 }}>
            {([
              { to: '/spectator', end: true, icon: '🏆', label: t('spectator.layout.tournaments') },
              { to: '/spectator/favorites', end: false, icon: '⭐', label: t('spectator.layout.favorites') },
              { to: '/spectator/practice', end: false, icon: '🏋️', label: t('spectator.layout.practice') },
            ]).map(item => (
              <li key={item.to} style={{ flex: 1 }}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} style={getNavStyle}>
                  <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <AiChatPanel
        userRole="spectator"
        localResponder={responder}
        contextInfo={tournamentId ? `현재 보고 있는 대회: tournamentId=${tournamentId}. 이 대회의 결과를 기준으로 답하세요.` : undefined}
      />
    </div>
  );
}
