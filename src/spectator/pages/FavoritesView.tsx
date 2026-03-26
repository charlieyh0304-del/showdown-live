import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFavorites, usePlayers, useTournaments, useMatches } from '@shared/hooks/useFirebase';
import { requestNotificationPermission, getNotificationPermissionStatus } from '@shared/utils/notifications';
export default function FavoritesView() {
  const { favorites, toggleFavorite, updateFavoriteName, syncCode, generateSyncCode, importFromSyncCode, linked } = useFavorites();
  const [importCode, setImportCode] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const { players, loading: pLoading } = usePlayers();
  const { tournaments } = useTournaments();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermissionStatus());

  // Always call useMatches with a stable value (no conditional hooks)
  const firstActiveTournamentId = useMemo(
    () => tournaments.find(t => t.status === 'in_progress')?.id
      || tournaments[0]?.id
      || null,
    [tournaments]
  );
  const { matches } = useMatches(firstActiveTournamentId);

  useEffect(() => {
    document.title = t('spectator.favorites.pageTitle');
  }, [t]);

  // Resolve favorites: stored name > global player > match data > raw id
  const favoritePlayers = useMemo(() => {
    return favorites.map(fav => {
      // Stored name is valid (not same as id)
      if (fav.name && fav.name !== fav.id) {
        const globalPlayer = players.find(p => p.id === fav.id);
        return { id: fav.id, name: fav.name, club: globalPlayer?.club, tournamentId: firstActiveTournamentId || undefined };
      }
      // Try global player DB
      const globalPlayer = players.find(p => p.id === fav.id);
      if (globalPlayer) return { id: fav.id, name: globalPlayer.name, club: globalPlayer.club, tournamentId: firstActiveTournamentId || undefined };
      // Try match data
      for (const m of matches) {
        if (m.player1Id === fav.id && m.player1Name) return { id: fav.id, name: m.player1Name, tournamentId: firstActiveTournamentId || undefined };
        if (m.player2Id === fav.id && m.player2Name) return { id: fav.id, name: m.player2Name, tournamentId: firstActiveTournamentId || undefined };
        if (m.team1Id === fav.id && m.team1Name) return { id: fav.id, name: m.team1Name, tournamentId: firstActiveTournamentId || undefined };
        if (m.team2Id === fav.id && m.team2Name) return { id: fav.id, name: m.team2Name, tournamentId: firstActiveTournamentId || undefined };
      }
      return { id: fav.id, name: fav.id, tournamentId: firstActiveTournamentId || undefined };
    });
  }, [favorites, players, matches, firstActiveTournamentId]);

  // Auto-fix unresolved names
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
            {favoritePlayers.map(player => {
              const activeMatch = matches.find(m =>
                m.status === 'in_progress' &&
                (m.player1Id === player.id || m.player2Id === player.id ||
                 m.team1Id === player.id || m.team2Id === player.id ||
                 m.player1Name === player.id || m.player2Name === player.id ||
                 m.team1Name === player.id || m.team2Name === player.id)
              );
              return (
                <li key={player.id} className="card" style={{ border: '1px solid #374151' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                      <span style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{player.name}</span>
                      {player.club && <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{player.club}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
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
                        onClick={() => toggleFavorite(player.id)}
                        style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem', minHeight: '44px' }}
                        aria-label={t('spectator.favorites.removeAriaLabel', { name: player.name })}
                      >
                        {t('spectator.favorites.removeButton')}
                      </button>
                    </div>
                  </div>

                  {activeMatch && firstActiveTournamentId && (
                    <button
                      onClick={() => navigate(`/spectator/match/${firstActiveTournamentId}/${activeMatch.id}`)}
                      style={{
                        marginTop: '0.75rem', width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.75rem', backgroundColor: '#1e3a5f', borderRadius: '0.5rem',
                        border: '1px solid #2563eb', cursor: 'pointer', color: '#fff', fontSize: 'inherit', minHeight: '44px',
                      }}
                      aria-label={t('spectator.favorites.viewMatchAriaLabel', { name: player.name, p1: activeMatch.player1Name || activeMatch.team1Name, p2: activeMatch.player2Name || activeMatch.team2Name })}
                    >
                      <span className="animate-pulse" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444' }} aria-hidden="true" />
                      <span style={{ fontWeight: 'bold' }}>
                        {t('spectator.favorites.liveMatch', { p1: activeMatch.player1Name || activeMatch.team1Name, p2: activeMatch.player2Name || activeMatch.team2Name })}
                      </span>
                      <span style={{ marginLeft: 'auto', color: 'var(--color-secondary)' }}>{t('spectator.favorites.viewMatch')}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Notification settings */}
          <div className="card" style={{ marginTop: '1.5rem', border: '1px solid #374151' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>
              {t('spectator.favorites.notifications.title')}
            </h2>
            {notifPermission === 'unsupported' ? (
              <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>{t('spectator.favorites.notifications.unsupported')}</p>
            ) : notifPermission === 'granted' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#22c55e', fontSize: '1.25rem' }}>&#10003;</span>
                <div>
                  <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>{t('spectator.favorites.notifications.enabled')}</p>
                  <p style={{ color: '#d1d5db', fontSize: '0.75rem', marginTop: '0.25rem' }}>{t('spectator.favorites.notifications.enabledDetail')}</p>
                </div>
              </div>
            ) : notifPermission === 'denied' ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#ef4444', fontSize: '1.25rem' }}>&#10007;</span>
                  <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>{t('spectator.favorites.notifications.denied')}</p>
                </div>
                <p style={{ color: '#d1d5db', fontSize: '0.75rem' }}>{t('spectator.favorites.notifications.deniedDetail')}</p>
              </div>
            ) : (
              <div>
                <p style={{ color: '#d1d5db', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{t('spectator.favorites.notifications.promptMessage')}</p>
                <button className="btn btn-primary" onClick={handleRequestPermission} style={{ fontSize: '0.875rem' }}>
                  {t('spectator.favorites.notifications.enableButton')}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Device sync - always visible */}
      <div className="card" style={{ marginTop: '1rem', border: '1px solid #374151' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>
          {t('spectator.favorites.sync.title')}
        </h2>

        {linked ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span style={{ color: '#22c55e', fontSize: '1.25rem' }}>&#10003;</span>
            <div>
              <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>{t('spectator.favorites.sync.linked')}</p>
              {syncCode && <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.25rem' }}>{t('spectator.favorites.sync.myCode')}: <strong style={{ color: '#facc15' }}>{syncCode}</strong></p>}
            </div>
          </div>
        ) : (
          <>
            <p style={{ color: '#9ca3af', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
              {t('spectator.favorites.sync.description')}
            </p>
            <div style={{ marginBottom: '1rem' }}>
              {syncCode ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.875rem', color: '#d1d5db' }}>{t('spectator.favorites.sync.myCode')}:</span>
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#facc15', letterSpacing: '0.15em', fontVariantNumeric: 'tabular-nums' }}>{syncCode}</span>
                </div>
              ) : (
                <button className="btn btn-primary" onClick={async () => { await generateSyncCode(); }} style={{ fontSize: '0.875rem' }}>
                  {t('spectator.favorites.sync.generateCode')}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                className="input"
                style={{ width: '120px', textAlign: 'center', fontSize: '1.125rem', letterSpacing: '0.1em' }}
                value={importCode}
                onChange={e => setImportCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                aria-label={t('spectator.favorites.sync.enterCode')}
              />
              <button
                className="btn btn-primary"
                disabled={importCode.length !== 6 || syncStatus === 'loading'}
                onClick={async () => {
                  setSyncStatus('loading');
                  const ok = await importFromSyncCode(importCode).catch(() => false);
                  setSyncStatus(ok ? 'success' : 'error');
                  if (ok) setImportCode('');
                }}
                style={{ fontSize: '0.875rem', minHeight: '44px' }}
              >
                {syncStatus === 'loading' ? t('common.loading') : t('spectator.favorites.sync.importButton')}
              </button>
            </div>
            {syncStatus === 'success' && <p style={{ color: '#22c55e', fontSize: '0.8125rem', marginTop: '0.5rem' }}>{t('spectator.favorites.sync.importSuccess')}</p>}
            {syncStatus === 'error' && <p style={{ color: '#ef4444', fontSize: '0.8125rem', marginTop: '0.5rem' }}>{t('spectator.favorites.sync.importError')}</p>}
          </>
        )}
      </div>
    </div>
  );
}
