import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFavorites, usePlayers, useTournaments, useMatches } from '@shared/hooks/useFirebase';

export default function FavoritesView() {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { players, loading: pLoading } = usePlayers();
  const { tournaments } = useTournaments();
  const navigate = useNavigate();

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

  if (pLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.5rem' }}>데이터 로딩 중...</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 'bold', marginBottom: '1rem' }}>
        즐겨찾기
      </h2>

      {favoritePlayers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ fontSize: '1.25rem', color: '#9ca3af', marginBottom: '1rem' }}>
            즐겨찾기한 선수가 없습니다
          </p>
          <p style={{ color: '#6b7280' }}>
            대회 관람 중 선수 이름 옆 ☆ 버튼을 눌러 추가하세요
          </p>
        </div>
      ) : (
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

  return (
    <li className="card" style={{ border: '1px solid #374151' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--color-primary)', fontSize: '1.5rem' }}>★</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{playerName}</span>
          </div>
          {playerClub && (
            <p style={{ color: '#9ca3af', marginTop: '0.25rem' }}>{playerClub}</p>
          )}
        </div>
        <button
          className="btn btn-danger"
          onClick={onRemove}
          style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
          aria-label={`${playerName} 즐겨찾기 해제`}
        >
          삭제
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
          aria-label={`${playerName} 경기 보기: ${activeMatch.player1Name} 대 ${activeMatch.player2Name}`}
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
            경기 진행중: {activeMatch.player1Name} vs {activeMatch.player2Name}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--color-secondary)' }}>보기 →</span>
        </button>
      )}
    </li>
  );
}
