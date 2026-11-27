import { useState, useEffect, useMemo, useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTournaments, useMatches } from '@shared/hooks/useFirebase';
import type { Tournament } from '@shared/types';
import { groupTournaments, tournamentDateRange, tournamentPhase, tournamentVenue, type TournamentPhase } from '../utils/tournamentList';

const PHASE_COLOR: Record<TournamentPhase, string> = { live: '#15803d', upcoming: '#2563eb', finished: '#4b5563' };

/** 진행 중 대회의 지금 진행 중인 경기 수 (진행 중 대회만 구독한다) */
function LiveCount({ tournamentId }: { tournamentId: string }) {
  const { t } = useTranslation();
  const { matches } = useMatches(tournamentId, 100);
  const n = matches.filter(m => m.status === 'in_progress').length;
  return <span style={{ color: n > 0 ? '#fca5a5' : '#d1d5db' }}>{t('spectator.home.liveMatchCount', { count: n })}</span>;
}

export interface TournamentListItemProps {
  tournament: Tournament;
}

export function TournamentListItem({ tournament: tour }: TournamentListItemProps) {
  const { t } = useTranslation();
  const phase = tournamentPhase(tour.status);
  const venue = tournamentVenue(tour);
  const statusLabel = t(`spectator.home.phase.${phase}`);
  return (
    <li>
      <Link
        to={`/spectator/tournament/${tour.id}`}
        className="card"
        style={{ display: 'block', textDecoration: 'none', color: 'inherit', border: '2px solid #374151' }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.375rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>{tour.name}</span>
          <span style={{ padding: '0.15rem 0.6rem', borderRadius: '9999px', fontSize: '0.875rem', fontWeight: 'bold', backgroundColor: PHASE_COLOR[phase], color: '#fff', whiteSpace: 'nowrap' }}>
            <span className="sr-only">, </span>{statusLabel}
          </span>
        </span>
        <span style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', color: '#d1d5db', marginTop: '0.375rem', fontSize: '0.9375rem' }}>
          {tour.groupName && <span><span className="sr-only">, </span>{tour.groupName}</span>}
          <span><span className="sr-only">, </span>{tournamentDateRange(tour)}</span>
          {venue && <span><span className="sr-only">, </span>{t('spectator.home.venue', { venue })}</span>}
          <span><span className="sr-only">, </span>{t(`common.tournamentType.${tour.type}`)}</span>
          {phase === 'live' && <span><span className="sr-only">, </span><LiveCount tournamentId={tour.id} /></span>}
        </span>
      </Link>
    </li>
  );
}

export interface TournamentListProps {
  tournaments: Tournament[];
  query: string;
}

/** 묶음별 목록 (진행 중 → 예정 → 종료). 대회가 하나여도 자동으로 들어가지 않는다. */
export function TournamentList({ tournaments, query }: TournamentListProps) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupTournaments(tournaments, query), [tournaments, query]);
  if (groups.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
        <p style={{ fontSize: '1.125rem', color: '#d1d5db' }}>
          {query.trim() ? t('spectator.home.noSearchResults', { query: query.trim() }) : t('spectator.home.noTournaments')}
        </p>
      </div>
    );
  }
  return (
    <>
      {groups.map(g => (
        <section key={g.phase} aria-labelledby={`tour-phase-${g.phase}`} style={{ marginBottom: '1.5rem' }}>
          <h2 id={`tour-phase-${g.phase}`} style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>
            {t(`spectator.home.phaseHeading.${g.phase}`, { count: g.items.length })}
          </h2>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {g.items.map(tour => <TournamentListItem key={tour.id} tournament={tour} />)}
          </ul>
        </section>
      ))}
    </>
  );
}

export default function SpectatorHome() {
  const { tournaments, loading } = useTournaments(20);
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const visibleCount = useMemo(() => groupTournaments(tournaments, query).reduce((n, g) => n + g.items.length, 0), [tournaments, query]);

  useEffect(() => {
    document.title = t('spectator.home.pageTitle');
  }, [t]);

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', marginBottom: '0.5rem', textAlign: 'center' }}>
        {t('spectator.home.title')}
      </h1>
      <p style={{ color: '#d1d5db', textAlign: 'center', marginBottom: '1rem' }}>{t('spectator.home.intro')}</p>

      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor={searchId} style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>{t('spectator.home.searchLabel')}</label>
        <input
          id={searchId}
          type="search"
          className="input"
          style={{ width: '100%' }}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('spectator.home.searchPlaceholder')}
          autoComplete="off"
        />
        <p className="sr-only" role="status" aria-live="polite">
          {query.trim() ? t('spectator.home.searchCount', { count: visibleCount }) : ''}
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="status" aria-live="polite">
          <p style={{ fontSize: '1.5rem' }}>{t('common.loading')}</p>
        </div>
      ) : (
        <TournamentList tournaments={tournaments} query={query} />
      )}

      <Link
        to="/spectator/practice"
        className="card"
        style={{ display: 'block', border: '2px solid #7c3aed', textAlign: 'center', textDecoration: 'none', color: 'inherit' }}
      >
        <span style={{ display: 'block', fontSize: '1.25rem', fontWeight: 'bold', color: '#c084fc' }}>{t('spectator.home.practiceWatch')}</span>
        <span style={{ display: 'block', color: '#d1d5db', fontSize: '0.875rem', marginTop: '0.25rem' }}>{t('spectator.home.practiceWatchDescription')}</span>
      </Link>
    </div>
  );
}
