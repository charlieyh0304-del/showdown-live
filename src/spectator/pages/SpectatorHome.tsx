import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTournaments } from '@shared/hooks/useFirebase';
import type { Tournament } from '@shared/types';

export default function SpectatorHome() {
  const { tournaments, loading } = useTournaments();
  const [filter, setFilter] = useState<'in_progress' | 'completed'>('in_progress');
  const navigate = useNavigate();
  const { t } = useTranslation();

  const getTournamentTypeLabel = (type: Tournament['type']): string => {
    return t(`common.tournamentType.${type}`);
  };

  const getStatusLabel = (status: Tournament['status']): string => {
    const statusMap: Record<string, string> = {
      draft: t('spectator.home.tournamentStatusLabels.draft'),
      registration: t('spectator.home.tournamentStatusLabels.registration'),
      in_progress: t('spectator.home.tournamentStatusLabels.inProgress'),
      completed: t('spectator.home.tournamentStatusLabels.completed'),
      paused: t('spectator.home.tournamentStatusLabels.paused'),
    };
    return statusMap[status] || status;
  };

  useEffect(() => {
    document.title = t('spectator.home.pageTitle');
  }, [t]);

  const visibleTournaments = tournaments.filter((t) => {
    if (filter === 'in_progress') {
      return t.status === 'draft' || t.status === 'registration' || t.status === 'in_progress' || t.status === 'paused';
    }
    return t.status === 'completed';
  });

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="status" aria-live="polite">
        <p style={{ fontSize: '1.5rem' }}>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', marginBottom: '1rem', textAlign: 'center' }}>
        {t('spectator.home.title')}
      </h1>

      {/* Filter toggle */}
      <div
        style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}
        role="tablist"
        aria-label={t('spectator.home.filterAriaLabel')}
        onKeyDown={e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const tabs: Array<'in_progress' | 'completed'> = ['in_progress', 'completed'];
            const idx = tabs.indexOf(filter);
            const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
            setFilter(tabs[next]);
            e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
          }
        }}
      >
        <button
          role="tab"
          aria-selected={filter === 'in_progress'}
          tabIndex={filter === 'in_progress' ? 0 : -1}
          className={filter === 'in_progress' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setFilter('in_progress')}
          style={{ flex: 1 }}
        >
          {t('spectator.home.inProgress')}
        </button>
        <button
          role="tab"
          aria-selected={filter === 'completed'}
          tabIndex={filter === 'completed' ? 0 : -1}
          className={filter === 'completed' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setFilter('completed')}
          style={{ flex: 1 }}
        >
          {t('spectator.home.completed')}
        </button>
      </div>

      {/* Tournament list */}
      <div role="tabpanel" aria-label={filter === 'in_progress' ? t('spectator.home.inProgressPanel') : t('spectator.home.completedPanel')}>
        {visibleTournaments.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontSize: '1.25rem', color: '#d1d5db' }} role="status">
              {filter === 'in_progress'
                ? t('spectator.home.noInProgress')
                : t('spectator.home.noCompleted')}
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {(() => {
              const grouped = new Map<string, typeof visibleTournaments>();
              const ungrouped: typeof visibleTournaments = [];
              for (const tour of visibleTournaments) {
                if (tour.groupId && tour.groupName) {
                  if (!grouped.has(tour.groupId)) grouped.set(tour.groupId, []);
                  grouped.get(tour.groupId)!.push(tour);
                } else {
                  ungrouped.push(tour);
                }
              }
              return (
                <>
                  {[...grouped.entries()].map(([groupId, groupTours]) => (
                    <li key={groupId}>
                      <div className="card" style={{ border: '2px solid #374151' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-primary)', display: 'block', marginBottom: '0.5rem' }}>
                          {groupTours[0].groupName}
                        </span>
                        <div style={{ color: '#d1d5db', marginBottom: '0.75rem' }}>{groupTours[0].date} | {groupTours.length}개 부문</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {groupTours.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => navigate(`/spectator/tournament/${t.id}`)}
                              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: '0.75rem 1rem', borderRadius: '0.5rem', backgroundColor: '#1f2937', border: 'none', color: 'inherit' }}
                              aria-label={`${t.name}, ${getTournamentTypeLabel(t.type)}, ${getStatusLabel(t.status)}`}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 'bold' }}>{t.name}</span>
                                <span style={{ padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold', backgroundColor: (t.status === 'in_progress' || t.status === 'draft') ? '#16a34a' : t.status === 'registration' ? '#3b82f6' : t.status === 'paused' ? '#d97706' : '#6b7280', color: '#fff' }}>
                                  {getStatusLabel(t.status)}
                                </span>
                              </div>
                              <span style={{ color: '#67e8f9', fontSize: '0.875rem' }}>{getTournamentTypeLabel(t.type)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                  {ungrouped.map((t) => (
                    <li key={t.id}>
                      <button
                        className="card"
                        onClick={() => navigate(`/spectator/tournament/${t.id}`)}
                        style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: '2px solid #374151' }}
                        aria-label={`${t.name}, ${getTournamentTypeLabel(t.type)}, ${getStatusLabel(t.status)}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-primary)', display: 'block' }}>{t.name}</span>
                          <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.875rem', fontWeight: 'bold', backgroundColor: (t.status === 'in_progress' || t.status === 'draft') ? '#16a34a' : t.status === 'registration' ? '#3b82f6' : t.status === 'paused' ? '#d97706' : '#6b7280', color: '#ffffff', whiteSpace: 'nowrap' }}>
                            {(t.status === 'in_progress' || t.status === 'draft' || t.status === 'paused') && <span aria-hidden="true">{'● '}</span>}
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
                </>
              );
            })()}
          </ul>
        )}
      </div>

      {/* 연습 경기 관람 */}
      <button
        className="card w-full p-4"
        onClick={() => navigate('/spectator/practice')}
        style={{ border: '2px solid #7c3aed', cursor: 'pointer', textAlign: 'center' }}
      >
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#c084fc' }}>{t('spectator.home.practiceWatch')}</h2>
        <p style={{ color: '#d1d5db', fontSize: '0.875rem', marginTop: '0.25rem' }}>{t('spectator.home.practiceWatchDescription')}</p>
      </button>
    </div>
  );
}
