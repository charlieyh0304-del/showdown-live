import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFavorites, usePlayers, useTournaments, useMatches } from '@shared/hooks/useFirebase';
import { requestNotificationPermission, getNotificationPermissionStatus } from '@shared/utils/notifications';
import type { Match } from '@shared/types';

interface ResolvedFavorite {
  id: string;
  name: string;
  club?: string;
  tournamentId?: string;
}

export default function FavoritesView() {
  const { favorites, toggleFavorite, updateFavoriteName } = useFavorites();
  const { players, loading: pLoading } = usePlayers();
  const { tournaments } = useTournaments();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermissionStatus());

  useEffect(() => {
    document.title = t('spectator.favorites.pageTitle');
  }, [t]);

  const activeTournamentIds = useMemo(
    () => tournaments.filter((t) => t.status === 'in_progress').map((t) => t.id),
    [tournaments]
  );

  // Load matches from first active tournament to resolve player names
  const firstTournamentId = activeTournamentIds.length > 0 ? activeTournamentIds[0] : null;
  const { matches: activeMatches } = useMatches(firstTournamentId);

  // Also load matches from ALL tournaments (not just active) to resolve names
  const allTournamentIds = useMemo(() => tournaments.map(t => t.id), [tournaments]);
  // Use first available tournament for name resolution
  const resolveTournamentId = firstTournamentId || (allTournamentIds.length > 0 ? allTournamentIds[0] : null);
  const { matches: resolveMatches } = useMatches(resolveTournamentId !== firstTournamentId ? resolveTournamentId : null);
  const allResolveMatches = useMemo(() => [...activeMatches, ...resolveMatches], [activeMatches, resolveMatches]);

  // Resolve favorite IDs to player info
  const favoritePlayers = useMemo(() => {
    return favorites.map((fav): ResolvedFavorite => {
      // 1. Try global players DB
      const globalPlayer = players.find((p) => p.id === fav.id);
      if (globalPlayer) {
        return { id: fav.id, name: globalPlayer.name, club: globalPlayer.club };
      }

      // 2. Use stored name from favorites (saved at toggle time)
      const storedName = fav.name !== fav.id ? fav.name : null;
      if (storedName) {
        return { id: fav.id, name: storedName, tournamentId: resolveTournamentId || undefined };
      }

      // 3. Try matching in tournament matches (resolve Firebase key → name)
      for (const m of allResolveMatches) {
        if (m.player1Id === fav.id && m.player1Name) return { id: fav.id, name: m.player1Name, tournamentId: resolveTournamentId || undefined };
        if (m.player2Id === fav.id && m.player2Name) return { id: fav.id, name: m.player2Name, tournamentId: resolveTournamentId || undefined };
        if (m.team1Id === fav.id && m.team1Name) return { id: fav.id, name: m.team1Name, tournamentId: resolveTournamentId || undefined };
        if (m.team2Id === fav.id && m.team2Name) return { id: fav.id, name: m.team2Name, tournamentId: resolveTournamentId || undefined };
      }

      // 4. Fallback: use id
      return { id: fav.id, name: fav.id, tournamentId: resolveTournamentId || undefined };
    });
  }, [favorites, players, allResolveMatches, resolveTournamentId]);

  // Auto-fix: when names are resolved from matches, save them back to localStorage
  useEffect(() => {
    for (const resolved of favoritePlayers) {
      const stored = favorites.find(f => f.id === resolved.id);
      if (stored && stored.name === stored.id && resolved.name !== resolved.id) {
        updateFavoriteName(resolved.id, resolved.name);
      }
    }
  }, [favoritePlayers, favorites, updateFavoriteName]);

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
                player={player}
                onRemove={() => toggleFavorite(player.id)}
                activeMatches={activeMatches}
                activeTournamentId={firstTournamentId}
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
  player,
  onRemove,
  activeMatches,
  activeTournamentId,
  navigate,
}: {
  player: ResolvedFavorite;
  onRemove: () => void;
  activeMatches: Match[];
  activeTournamentId: string | null;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation();
  const [animating, setAnimating] = useState(false);

  const activeMatch = useMemo(() => {
    return activeMatches.find(
      (m) =>
        m.status === 'in_progress' &&
        (m.player1Id === player.id || m.player2Id === player.id ||
         m.team1Id === player.id || m.team2Id === player.id ||
         m.player1Name === player.id || m.player2Name === player.id ||
         m.team1Name === player.id || m.team2Name === player.id)
    ) || null;
  }, [activeMatches, player.id]);

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
              aria-label={t('spectator.favorites.removeAriaLabel', { name: player.name })}
              title={t('spectator.favorites.removeAriaLabel', { name: player.name })}
              style={{ minWidth: '44px', minHeight: '44px' }}
            >
              {'\u2605'}
            </button>
            <div>
              <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{player.name}</span>
              {player.club && (
                <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>{player.club}</p>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {player.tournamentId && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => navigate(`/spectator/player/${player.tournamentId}/${encodeURIComponent(player.name)}`)}
              style={{ fontSize: '0.75rem', minHeight: '44px' }}
              aria-label={`${player.name} ${t('common.profile')}`}
            >
              {t('common.profile')}
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={handleRemove}
            style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem', minHeight: '44px' }}
            aria-label={t('spectator.favorites.removeAriaLabel', { name: player.name })}
          >
            {t('spectator.favorites.removeButton')}
          </button>
        </div>
      </div>

      {/* Active match link */}
      {activeMatch && activeTournamentId && (
        <button
          onClick={() => navigate(`/spectator/match/${activeTournamentId}/${activeMatch.id}`)}
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
            minHeight: '44px',
          }}
          aria-label={t('spectator.favorites.viewMatchAriaLabel', { name: player.name, p1: activeMatch.player1Name || activeMatch.team1Name, p2: activeMatch.player2Name || activeMatch.team2Name })}
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
            {t('spectator.favorites.liveMatch', { p1: activeMatch.player1Name || activeMatch.team1Name, p2: activeMatch.player2Name || activeMatch.team2Name })}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--color-secondary)' }}>{t('spectator.favorites.viewMatch')}</span>
        </button>
      )}
    </li>
  );
}
