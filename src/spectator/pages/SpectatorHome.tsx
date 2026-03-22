import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTournaments } from '@shared/hooks/useFirebase';
import type { Tournament } from '@shared/types';

function getTournamentTypeLabel(type: Tournament['type']): string {
  switch (type) {
    case 'individual': return '개인전';
    case 'team': return '팀전';
    case 'randomTeamLeague': return '랜덤팀리그전';
  }
}

function getStatusLabel(status: Tournament['status']): string {
  switch (status) {
    case 'draft': return '준비중';
    case 'registration': return '모집중';
    case 'in_progress': return '진행중';
    case 'completed': return '완료';
    case 'paused': return '일시정지';
    default: return status;
  }
}

export default function SpectatorHome() {
  const { tournaments, loading } = useTournaments();
  const [filter, setFilter] = useState<'in_progress' | 'completed'>('in_progress');
  const navigate = useNavigate();

  const visibleTournaments = tournaments.filter((t) => {
    if (filter === 'in_progress') {
      return t.status === 'draft' || t.status === 'registration' || t.status === 'in_progress' || t.status === 'paused';
    }
    return t.status === 'completed';
  });

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.5rem' }}>데이터 로딩 중...</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 'bold', marginBottom: '1rem' }}>
        대회 목록
      </h2>

      {/* Filter toggle */}
      <div
        style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}
        role="tablist"
        aria-label="대회 필터"
      >
        <button
          role="tab"
          aria-selected={filter === 'in_progress'}
          className={filter === 'in_progress' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setFilter('in_progress')}
          style={{ flex: 1 }}
        >
          진행중
        </button>
        <button
          role="tab"
          aria-selected={filter === 'completed'}
          className={filter === 'completed' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setFilter('completed')}
          style={{ flex: 1 }}
        >
          완료
        </button>
      </div>

      {/* Tournament list */}
      <div role="tabpanel" aria-label={filter === 'in_progress' ? '진행중 대회 목록' : '완료된 대회 목록'}>
        {visibleTournaments.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>
              {filter === 'in_progress'
                ? '진행 중인 대회가 없습니다'
                : '완료된 대회가 없습니다'}
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {visibleTournaments.map((t) => (
              <li key={t.id}>
                <button
                  className="card"
                  onClick={() => navigate(`/spectator/tournament/${t.id}`)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: '2px solid #374151',
                  }}
                  aria-label={`${t.name}, ${getTournamentTypeLabel(t.type)}, ${getStatusLabel(t.status)}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                      {t.name}
                    </h3>
                    <span
                      style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: '0.875rem',
                        fontWeight: 'bold',
                        backgroundColor: t.status === 'in_progress' ? '#16a34a' : '#6b7280',
                        color: '#ffffff',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.status === 'in_progress' && '● '}
                      {getStatusLabel(t.status)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#d1d5db' }}>
                    <span>{t.date}</span>
                    <span>{getTournamentTypeLabel(t.type)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
