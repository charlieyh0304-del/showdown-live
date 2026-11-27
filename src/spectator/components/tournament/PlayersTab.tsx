import { useState, useMemo, useId } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Match } from '@shared/types';
import { participantStats, type RankingTournament } from '@shared/utils/ranking';
import { rememberFocusKey } from '@shared/utils/focusReturn';
import { playerPath } from '../../utils/spectatorRoutes';

export interface PlayersTabProps {
  matches: Match[];
  isTeam?: boolean;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, name?: string) => void;
  tournamentId: string;
  /** 대회 규칙(세트 승자·부전승 집계·동률 순서)을 읽는다 */
  tournament?: Partial<RankingTournament> | null;
  /** 이름 표기 (영문 병기 설정) */
  nameOf?: (name: string) => string;
}

/**
 * 선수 명단: 이름을 누르면 선수 상세(주소가 있어 뒤로 가기로 돌아오면 누른 이름에 초점이 돌아온다),
 * 별은 즐겨찾기(기기별 저장). '즐겨찾기만 보기'로 거른다.
 */
export default function PlayersTab({ matches, isTeam = false, isFavorite, toggleFavorite, tournamentId, tournament, nameOf = n => n }: PlayersTabProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [favOnly, setFavOnly] = useState(false);
  const favId = useId();
  const [announce, setAnnounce] = useState('');

  // 전적: 대회 규칙의 'stats' 문맥, 순서는 동률 규칙. 목록은 이름순(찾기 쉽게)
  const playerList = useMemo(
    () => participantStats(matches, tournament, { includeUnplayed: true })
      .filter(r => !!r.playerId && !!r.playerName)
      .map(r => ({ id: r.playerId, name: r.playerName, wins: r.wins, losses: r.losses }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [matches, tournament],
  );

  const visible = useMemo(() => (favOnly ? playerList.filter(p => isFavorite(p.id)) : playerList), [playerList, favOnly, isFavorite]);

  if (playerList.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.players.empty')}</p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: '#d1d5db', marginBottom: '0.75rem' }}>{t('spectator.players.intro')}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <input id={favId} type="checkbox" checked={favOnly} onChange={e => setFavOnly(e.target.checked)} style={{ width: '1.5rem', height: '1.5rem', minHeight: 0 }} />
        <label htmlFor={favId}>{t('spectator.filters.favoritesOnly')}</label>
      </div>
      <p role="status" aria-live="polite" style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
        {isTeam ? t('spectator.players.teamCount', { count: visible.length }) : t('spectator.players.count', { count: visible.length })}
      </p>
      <p className="sr-only" aria-live="polite">{announce}</p>
      {visible.length === 0 ? (
        <p className="card" style={{ textAlign: 'center', color: '#d1d5db' }}>{t('spectator.players.noFavorites')}</p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {visible.map(p => {
            const fav = isFavorite(p.id);
            const focusKey = `player:${p.id}`;
            return (
              <li key={p.id} className="card" style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: `1px solid ${fav ? '#f59e0b' : '#374151'}` }}>
                <Link
                  to={playerPath(tournamentId, p.id)}
                  data-focus-key={focusKey}
                  onClick={() => rememberFocusKey(location.key, focusKey)}
                  style={{ flex: 1, color: '#facc15', fontWeight: 'bold', fontSize: '1.125rem', display: 'flex', alignItems: 'center', minHeight: '48px' }}
                >
                  {nameOf(p.name)}
                  <span style={{ color: '#d1d5db', fontWeight: 'normal', fontSize: '0.875rem', marginLeft: '0.75rem' }}>
                    <span className="sr-only">, </span>{t('spectator.players.record', { w: p.wins, l: p.losses })}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    toggleFavorite(p.id, p.name);
                    setAnnounce(fav ? t('spectator.favorites.removedAnnounce', { name: p.name }) : t('spectator.favorites.addedAnnounce', { name: p.name }));
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', minWidth: '48px', minHeight: '48px', color: 'var(--color-primary)' }}
                  aria-label={t('spectator.favorites.toggleLabel', { name: p.name })}
                  aria-pressed={fav}
                >
                  <span aria-hidden="true">{fav ? '★' : '☆'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
