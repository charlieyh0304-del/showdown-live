import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Match } from '@shared/types';
import type { useNavigate } from 'react-router-dom';
import { participantStats, type RankingTournament } from '@shared/utils/ranking';

export interface PlayersTabProps {
  matches: Match[];
  onSelectPlayer: (name: string) => void;
  isTeam?: boolean;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, name?: string) => void;
  tournamentId: string;
  navigate: ReturnType<typeof useNavigate>;
  /** 대회 규칙(세트 승자·부전승 집계·동률 순서)을 읽는다 */
  tournament?: Partial<RankingTournament> | null;
}

export default function PlayersTab({ matches, onSelectPlayer, isTeam = false, isFavorite, toggleFavorite, tournamentId, navigate, tournament }: PlayersTabProps) {
  const { t } = useTranslation();
  const [playerSearch, setPlayerSearch] = useState('');

  // 전적: 대회 규칙의 'stats' 문맥(세트 승자 = 그 경기의 유효 점수 규칙, 부전승 개인 전적 반영 규칙), 순서는 동률 규칙
  const playerList = useMemo(
    () => participantStats(matches, tournament, { includeUnplayed: true })
      .filter(r => !!r.playerId && !!r.playerName)
      .map(r => ({ id: r.playerId, name: r.playerName, wins: r.wins, losses: r.losses, setsWon: r.setsWon, setsLost: r.setsLost, pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst })),
    [matches, tournament],
  );

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
