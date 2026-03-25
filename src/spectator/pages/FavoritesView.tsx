import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFavorites, usePlayers, useTournaments, useMatches } from '@shared/hooks/useFirebase';
import { requestNotificationPermission, getNotificationPermissionStatus } from '@shared/utils/notifications';

export default function FavoritesView() {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { players, loading: pLoading } = usePlayers();
  const { tournaments } = useTournaments();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermissionStatus());

  useEffect(() => {
    document.title = t('spectator.favorites.pageTitle');
  }, [t]);

  // Find active tournaments to search for live matches
  const activeTournamentIds = useMemo(
    () => tournaments.filter((t) => t.status === 'in_progress').map((t) => t.id),
    [tournaments]
  );

  const favoritePlayers = useMemo(() => {
    return favoriteIds
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => p != null);
  }, [favoriteIds, players]);

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(granted ? 'granted' : 'denied');
  };

  if (pLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="status" aria-live="polite">
        <p style={{ fontSize: '1.5rem' }}>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', marginBottom: '1rem' }}>
        {t('spectator.favorites.title')}
      </h1>

      {favoritePlayers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ fontSize: '1.25rem', color: '#d1d5db', marginBottom: '1rem' }} role="status">
            {t('spectator.favorites.noFavorites')}
          </p>
          <p style={{ color: '#d1d5db' }}>
            {t('spectator.favorites.addHint')}
          </p>
        </div>
      ) : (
        <>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {favoritePlayers.map((player) => (
              <FavoritePlayerCard
                key={player.id}
                playerId={player.id}
                playerName={player.name}
                playerClub={player.club}
                onRemove={() => toggleFavorite(player.id)}
                activeTournamentIds={activeTournamentIds}
                navigate={navigate}
              />
            ))}
          </ul>

          {/* Notification settings section */}
          <div className="card" style={{ marginTop: '1.5rem', border: '1px solid #374151' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>
              {t('spectator.favorites.notifications.title')}
            </h2>
            {notifPermission === 'unsupported' ? (
              <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>
                {t('spectator.favorites.notifications.unsupported')}
              </p>
            ) : notifPermission === 'granted' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#22c55e', fontSize: '1.25rem' }}>&#10003;</span>
                <div>
                  <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>
                    {t('spectator.favorites.notifications.enabled')}
                  </p>
                  <p style={{ color: '#d1d5db', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    {t('spectator.favorites.notifications.enabledDetail')}
                  </p>
                </div>
              </div>
            ) : notifPermission === 'denied' ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#ef4444', fontSize: '1.25rem' }}>&#10007;</span>
                  <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>
                    {t('spectator.favorites.notifications.denied')}
                  </p>
                </div>
                <p style={{ color: '#d1d5db', fontSize: '0.75rem' }}>
                  {t('spectator.favorites.notifications.deniedDetail')}
                </p>
              </div>
            ) : (
              <div>
                <p style={{ color: '#d1d5db', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                  {t('spectator.favorites.notifications.promptMessage')}
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleRequestPermission}
                  style={{ fontSize: '0.875rem' }}
                >
                  {t('spectator.favorites.notifications.enableButton')}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FavoritePlayerCard({
  playerId,
  playerName,
  playerClub,
  onRemove,
  activeTournamentIds,
  navigate,
}: {
  playerId: string;
  playerName: string;
  playerClub?: string;
  onRemove: () => void;
  activeTournamentIds: string[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation();
  const [animating, setAnimating] = useState(false);
  // Subscribe to first active tournament to find live match for this player
  const firstTournamentId = activeTournamentIds.length > 0 ? activeTournamentIds[0] : null;
  const { matches } = useMatches(firstTournamentId);

  const activeMatch = useMemo(() => {
    return matches.find(
      (m) =>
        m.status === 'in_progress' &&
        (m.player1Id === playerId || m.player2Id === playerId)
    ) || null;
  }, [matches, playerId]);

  const handleRemove = () => {
    setAnimating(true);
    setTimeout(() => {
      onRemove();
    }, 200);
  };

  return (
    <li className="card" style={{ border: '1px solid #374151' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={handleRemove}
              className={`favorite-btn favorite-btn--active${animating ? ' favorite-btn--pop' : ''}`}
              aria-label={t('spectator.favorites.removeAriaLabel', { name: playerName })}
              title={t('spectator.favorites.removeAriaLabel', { name: playerName })}
            >
              {'\u2605'}
            </button>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{playerName}</span>
          </div>
          {playerClub && (
            <p style={{ color: '#d1d5db', marginTop: '0.25rem' }}>{playerClub}</p>
          )}
        </div>
        <button
          className="btn btn-danger"
          onClick={handleRemove}
          style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
          aria-label={t('spectator.favorites.removeAriaLabel', { name: playerName })}
        >
          {t('spectator.favorites.removeButton')}
        </button>
      </div>

      {/* Active match link */}
      {activeMatch && firstTournamentId && (
        <button
          onClick={() => navigate(`/spectator/match/${firstTournamentId}/${activeMatch.id}`)}
          style={{
            marginTop: '0.75rem',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            backgroundColor: '#1e3a5f',
            borderRadius: '0.5rem',
            border: '1px solid #2563eb',
            cursor: 'pointer',
            color: '#fff',
            fontSize: 'inherit',
          }}
          aria-label={t('spectator.favorites.viewMatchAriaLabel', { name: playerName, p1: activeMatch.player1Name, p2: activeMatch.player2Name })}
        >
          <span
            className="animate-pulse"
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#ef4444',
            }}
            aria-hidden="true"
          />
          <span style={{ fontWeight: 'bold' }}>
            {t('spectator.favorites.liveMatch', { p1: activeMatch.player1Name, p2: activeMatch.player2Name })}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--color-secondary)' }}>{t('spectator.favorites.viewMatch')}</span>
        </button>
      )}
    </li>
  );
}
