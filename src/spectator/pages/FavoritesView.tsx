import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFavorites, usePlayers, useTournaments, useMatches } from '@shared/hooks/useFirebase';
import { requestNotificationPermission, getNotificationPermissionStatus } from '@shared/utils/notifications';

export default function FavoritesView() {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { players, loading: pLoading } = usePlayers();
  const { tournaments } = useTournaments();
  const navigate = useNavigate();
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermissionStatus());

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
            <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>
              알림 설정
            </h3>
            {notifPermission === 'unsupported' ? (
              <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                이 브라우저는 알림을 지원하지 않습니다.
              </p>
            ) : notifPermission === 'granted' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#22c55e', fontSize: '1.25rem' }}>&#10003;</span>
                <div>
                  <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>
                    알림이 활성화되어 있습니다
                  </p>
                  <p style={{ color: '#6b7280', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    즐겨찾기 선수의 경기 10분 전, 경기 결과를 알려드립니다.
                  </p>
                </div>
              </div>
            ) : notifPermission === 'denied' ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#ef4444', fontSize: '1.25rem' }}>&#10007;</span>
                  <p style={{ color: '#d1d5db', fontSize: '0.875rem' }}>
                    알림이 차단되어 있습니다
                  </p>
                </div>
                <p style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                  브라우저 설정에서 이 사이트의 알림 권한을 허용해주세요.
                  주소창 왼쪽의 자물쇠 아이콘 &gt; 알림 &gt; 허용
                </p>
              </div>
            ) : (
              <div>
                <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                  알림을 활성화하면 즐겨찾기 선수의 경기 10분 전 알림과 경기 결과를 받을 수 있습니다.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleRequestPermission}
                  style={{ fontSize: '0.875rem' }}
                >
                  알림 허용하기
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
              aria-label={`${playerName} 즐겨찾기 해제`}
              title="즐겨찾기 해제"
            >
              {'\u2605'}
            </button>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{playerName}</span>
          </div>
          {playerClub && (
            <p style={{ color: '#9ca3af', marginTop: '0.25rem' }}>{playerClub}</p>
          )}
        </div>
        <button
          className="btn btn-danger"
          onClick={handleRemove}
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
