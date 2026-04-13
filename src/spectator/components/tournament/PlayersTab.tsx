import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Match } from '@shared/types';
import type { useNavigate } from 'react-router-dom';

export interface PlayersTabProps {
  matches: Match[];
  onSelectPlayer: (name: string) => void;
  isTeam?: boolean;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, name?: string) => void;
  tournamentId: string;
  navigate: ReturnType<typeof useNavigate>;
}

export default function PlayersTab({ matches, onSelectPlayer, isTeam = false, isFavorite, toggleFavorite, tournamentId, navigate }: PlayersTabProps) {
  const { t } = useTranslation();
  const [playerSearch, setPlayerSearch] = useState('');

  const playerList = useMemo(() => {
    const stats = new Map<string, {
      id: string; name: string; wins: number; losses: number;
      setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number;
    }>();

    for (const m of matches) {
      const p1Id = m.player1Id || m.team1Id || '';
      const p2Id = m.player2Id || m.team2Id || '';
      const p1Name = m.player1Name || m.team1Name || '';
      const p2Name = m.player2Name || m.team2Name || '';

      if (p1Id && p1Name && !stats.has(p1Id)) {
        stats.set(p1Id, { id: p1Id, name: p1Name, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
      }
      if (p2Id && p2Name && !stats.has(p2Id)) {
        stats.set(p2Id, { id: p2Id, name: p2Name, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
      }

      if (m.status === 'completed' && p1Id && p2Id) {
        const s1 = stats.get(p1Id);
        const s2 = stats.get(p2Id);
        if (s1 && s2) {
          if (m.winnerId === p1Id) { s1.wins++; s2.losses++; }
          else if (m.winnerId === p2Id) { s2.wins++; s1.losses++; }

          (Array.isArray(m.sets) ? m.sets : []).forEach(set => {
            if (set.player1Score > set.player2Score) { s1.setsWon++; s2.setsLost++; }
            else if (set.player2Score > set.player1Score) { s2.setsWon++; s1.setsLost++; }
            s1.pointsFor += set.player1Score; s1.pointsAgainst += set.player2Score;
            s2.pointsFor += set.player2Score; s2.pointsAgainst += set.player1Score;
          });
        }
      }
    }

    return Array.from(stats.values()).sort((a, b) =>
      b.wins - a.wins || (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost) || a.name.localeCompare(b.name)
    );
  }, [matches]);

  const filteredPlayers = useMemo(() => {
    if (!playerSearch.trim()) return playerList;
    const q = playerSearch.trim().toLowerCase();
    return playerList.filter(p => p.name.toLowerCase().includes(q));
  }, [playerList, playerSearch]);

  if (playerList.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.tabs.players')} - {t('common.matchStatus.pending')}</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <input
          className="input"
          style={{ width: '100%' }}
          value={playerSearch}
          onChange={e => setPlayerSearch(e.target.value)}
          placeholder={t('spectator.tournament.searchPlaceholder')}
          aria-label={t('spectator.tournament.searchAriaLabel')}
        />
      </div>
      <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.75rem', textAlign: 'center' }}>
        {isTeam
          ? `\ucd1d ${filteredPlayers.length}${t('common.units.team')}`
          : t('spectator.tournament.view.playerCount', { count: filteredPlayers.length })
        }{playerSearch.trim() ? ` (${t('spectator.tournament.searchAriaLabel')}: "${playerSearch.trim()}")` : ''}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {filteredPlayers.map(p => (
          <div
            key={p.id}
            className="card"
            style={{
              padding: '0.75rem 1rem',
              border: `1px solid ${isFavorite(p.id) ? '#f59e0b' : '#374151'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => onSelectPlayer(p.name)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: 1, padding: 0 }}
                aria-label={p.name}
              >
                <span style={{ fontWeight: 'bold', fontSize: '1.125rem', color: '#facc15' }}>{p.name}</span>
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8125rem', marginTop: '0.125rem' }} aria-hidden="true">
                  <span style={{ color: '#d1d5db' }}>
                    {p.wins}{t('common.units.win')}{p.losses}{t('common.units.loss')}
                  </span>
                  {!isTeam && <span style={{ color: p.setsWon - p.setsLost > 0 ? '#22c55e' : p.setsWon - p.setsLost < 0 ? '#ef4444' : '#9ca3af' }}>
                    {t('common.units.set')} {p.setsWon - p.setsLost > 0 ? '+' : ''}{p.setsWon - p.setsLost}
                  </span>}
                  <span style={{ color: p.pointsFor - p.pointsAgainst > 0 ? '#22c55e' : p.pointsFor - p.pointsAgainst < 0 ? '#ef4444' : '#9ca3af' }}>
                    {t('spectator.tournament.playerRecord.goalDiff')} {p.pointsFor - p.pointsAgainst > 0 ? '+' : ''}{p.pointsFor - p.pointsAgainst}
                  </span>
                </div>
              </button>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id, p.name); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  aria-label={isFavorite(p.id) ? t('spectator.favorites.removeFavorite', { name: p.name }) : t('spectator.favorites.addFavorite', { name: p.name })}
                  aria-pressed={isFavorite(p.id)}
                >
                  {isFavorite(p.id) ? '\u2605' : '\u2606'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/spectator/player/${tournamentId}/${encodeURIComponent(p.name)}`); }}
                  className="btn btn-sm"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', minHeight: '44px' }}
                  aria-label={`${p.name} ${t('common.profile')}`}
                >
                  {t('common.profile')}
                </button>
              </div>
            </div>
          </div>
        ))}
        {filteredPlayers.length === 0 && playerSearch.trim() && (
          <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ color: '#d1d5db' }}>{t('spectator.tournament.view.noSearchResults', { query: playerSearch.trim() })}</p>
          </div>
        )}
      </div>
    </div>
  );
}
