import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFavorites, usePlayers, useTournaments, useMatches } from '@shared/hooks/useFirebase';
import { usePushNotifications } from '@shared/hooks/usePushNotifications';
import { requestNotificationPermission, getNotificationPermissionStatus } from '@shared/utils/notifications';
import { useNotificationSettings } from '@shared/hooks/useNotificationSettings';
import { useNotificationHistory } from '@shared/hooks/useNotificationHistory';
export default function FavoritesView() {
  const { favorites, toggleFavorite, updateFavoriteName } = useFavorites();
  const { players, loading: pLoading } = usePlayers();
  const { tournaments } = useTournaments();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermissionStatus());
  const { settings, setEnabled, setTypeEnabled, setQuietHours, setPlayerSettings, getPlayerSettings } = useNotificationSettings();
  const { history: notifHistory, unreadCount, markAllAsRead, clearAll } = useNotificationHistory();
  const [showHistory, setShowHistory] = useState(false);
  const { pushEnabled, pushSupported, enablePush, debugInfo } = usePushNotifications(favorites);

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
    // Try FCM push first, fall back to basic web notifications
    if (pushSupported) {
      const ok = await enablePush();
      if (ok) {
        setNotifPermission('granted');
        return;
      }
    }
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

      {/* 푸시 알림 디버그 */}
      <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.75rem', color: '#94a3b8' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: '#e2e8f0' }}>푸시 알림 상태</div>
        <div>{debugInfo}</div>
        <div>지원: {pushSupported ? '✅' : '❌'} | 활성: {pushEnabled ? '✅' : '❌'} | 권한: {typeof Notification !== 'undefined' ? Notification.permission : 'N/A'}</div>
      </div>

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
            {notifPermission === 'unsupported' && !pushSupported ? (
              <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>{t('spectator.favorites.notifications.unsupported')}</p>
            ) : notifPermission === 'granted' || pushEnabled ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: '#22c55e', fontSize: '1.25rem' }}>&#10003;</span>
                  <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>
                    {pushEnabled
                      ? t('spectator.favorites.notifications.pushEnabled')
                      : t('spectator.favorites.notifications.enabledDetail')}
                  </p>
                </div>

                {/* Global toggle */}
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderTop: '1px solid #374151' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>{t('spectator.favorites.notifications.globalToggle')}</span>
                  <input type="checkbox" checked={settings.enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: '20px', height: '20px', accentColor: '#3b82f6' }} />
                </label>

                {settings.enabled && (
                  <>
                    {/* Notification type toggles */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {(['preMatch', 'matchStart', 'matchComplete'] as const).map((type) => (
                        <label key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.25rem 0' }}>
                          <span style={{ fontSize: '0.875rem', color: '#d1d5db' }}>
                            {t(`spectator.favorites.notifications.type${type.charAt(0).toUpperCase() + type.slice(1)}`)}
                          </span>
                          <input type="checkbox" checked={settings.types[type]} onChange={(e) => setTypeEnabled(type, e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }} />
                        </label>
                      ))}
                    </div>

                    {/* Quiet hours */}
                    <div style={{ borderTop: '1px solid #374151', paddingTop: '0.75rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>{t('spectator.favorites.notifications.quietHours')}</span>
                        <input type="checkbox" checked={settings.quietHours.enabled} onChange={(e) => setQuietHours({ ...settings.quietHours, enabled: e.target.checked })} style={{ width: '20px', height: '20px', accentColor: '#3b82f6' }} />
                      </label>
                      {settings.quietHours.enabled && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{t('spectator.favorites.notifications.quietHoursStart')}</span>
                          <select value={settings.quietHours.start.split(':')[0]} onChange={(e) => setQuietHours({ ...settings.quietHours, start: `${e.target.value}:${settings.quietHours.start.split(':')[1] || '00'}` })} style={{ backgroundColor: '#1f2937', color: '#fff', border: '1px solid #4b5563', borderRadius: '0.375rem', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}>
                            {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => <option key={h} value={h}>{h}시</option>)}
                          </select>
                          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{t('spectator.favorites.notifications.quietHoursEnd')}</span>
                          <select value={settings.quietHours.end.split(':')[0]} onChange={(e) => setQuietHours({ ...settings.quietHours, end: `${e.target.value}:${settings.quietHours.end.split(':')[1] || '00'}` })} style={{ backgroundColor: '#1f2937', color: '#fff', border: '1px solid #4b5563', borderRadius: '0.375rem', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}>
                            {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => <option key={h} value={h}>{h}시</option>)}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Per-player settings */}
                    {favoritePlayers.length > 0 && (
                      <div style={{ borderTop: '1px solid #374151', paddingTop: '0.75rem' }}>
                        <h3 style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t('spectator.favorites.notifications.perPlayerTitle')}</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {favoritePlayers.map((player) => {
                            const ps = getPlayerSettings(player.id);
                            return (
                              <label key={player.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.25rem 0' }}>
                                <span style={{ fontSize: '0.875rem', color: '#d1d5db' }}>{player.name}</span>
                                <input type="checkbox" checked={ps.enabled} onChange={(e) => setPlayerSettings(player.id, { ...ps, enabled: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }} />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
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

          {/* Notification history */}
          <div className="card" style={{ marginTop: '1rem', border: '1px solid #374151' }}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
            >
              <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', margin: 0 }}>
                {t('spectator.favorites.notifications.historyTitle')}
                {unreadCount > 0 && (
                  <span style={{ marginLeft: '0.5rem', backgroundColor: '#ef4444', color: '#fff', borderRadius: '9999px', padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 'normal' }}>
                    {unreadCount}
                  </span>
                )}
              </h2>
              <span style={{ color: '#9ca3af', fontSize: '1.25rem' }}>{showHistory ? '\u25B2' : '\u25BC'}</span>
            </button>

            {showHistory && (
              <div style={{ marginTop: '0.75rem' }}>
                {notifHistory.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{t('spectator.favorites.notifications.historyEmpty')}</p>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      {unreadCount > 0 && (
                        <button className="btn btn-sm" onClick={markAllAsRead} style={{ fontSize: '0.75rem' }}>
                          {t('spectator.favorites.notifications.markAllRead')}
                        </button>
                      )}
                      <button className="btn btn-sm btn-danger" onClick={clearAll} style={{ fontSize: '0.75rem' }}>
                        {t('spectator.favorites.notifications.clearHistory')}
                      </button>
                    </div>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
                      {notifHistory.slice(0, 20).map((entry) => (
                        <li key={entry.id} style={{ padding: '0.5rem', borderRadius: '0.375rem', backgroundColor: entry.read ? 'transparent' : '#1e3a5f', border: `1px solid ${entry.read ? '#374151' : '#2563eb'}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <p style={{ fontSize: '0.875rem', fontWeight: entry.read ? 'normal' : 'bold' }}>{entry.title}</p>
                              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.125rem' }}>{entry.body}</p>
                            </div>
                            <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap', marginLeft: '0.5rem' }}>
                              {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

    </div>
  );
}
