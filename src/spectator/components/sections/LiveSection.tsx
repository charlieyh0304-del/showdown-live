import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Match, Tournament } from '@shared/types';
import { matchSetWins } from '@shared/utils/scoring';
import LiveTab from '../tournament/LiveTab';
import MatchListItem, { type SlotLabelFn } from './MatchListItem';
import { courtBoard, liveOverview, type ScheduleRow } from '../../utils/spectatorData';

export interface LiveSectionProps {
  rows: ScheduleRow[];
  matches: Match[];
  now: number;
  tournament: Tournament;
  tournamentId: string;
  slotLabel: SlotLabelFn;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, name?: string) => void;
  navigate: Parameters<typeof LiveTab>[0]['navigate'];
}

/** 실시간 현황: 코트 현황판 → 진행 중(점수·시계) → 곧 시작 → 방금 끝남 */
export default function LiveSection({ rows, matches, now, tournament, tournamentId, slotLabel, isFavorite, toggleFavorite, navigate }: LiveSectionProps) {
  const { t } = useTranslation();
  const overview = useMemo(() => liveOverview(rows, now), [rows, now]);
  const board = useMemo(() => courtBoard(rows, now), [rows, now]);

  const label = (m: Match) => {
    const a = slotLabel(m, 1), b = slotLabel(m, 2);
    return `${a.undecided ? a.srText : a.text} ${t('spectator.schedule.versus')} ${b.undecided ? b.srText : b.text}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <p style={{ color: '#d1d5db' }}>
        {t('spectator.live.summary', { live: overview.live.length, upcoming: overview.upcoming.length, recent: overview.recent.length })}
      </p>

      {board.length > 0 && (
        <section aria-labelledby="live-courts-title">
          <h3 id="live-courts-title" style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t('spectator.live.courtBoard')}</h3>
          <ul style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', gap: '0.75rem' }}>
            {board.map(e => {
              const cur = e.current?.match;
              const sets = cur && Array.isArray(cur.sets) ? cur.sets : [];
              const curSet = cur ? (sets[cur.currentSet ?? sets.length - 1] ?? sets[sets.length - 1]) : undefined;
              const wins = cur && sets.length ? matchSetWins(cur, tournament) : null;
              return (
                <li key={e.court.id} className="card" style={{ border: `2px solid ${cur ? '#ef4444' : '#374151'}` }}>
                  <h4 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>{e.court.name || e.court.id}</h4>
                  {cur ? (
                    <p>
                      <Link to={`/spectator/match/${tournamentId}/${cur.id}`} style={{ color: '#fff' }}>
                        {t('spectator.live.courtNow', { match: label(cur) })}
                        {curSet && <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                          {t('spectator.live.courtScore', { set: (cur.currentSet ?? 0) + 1, s1: curSet.player1Score, s2: curSet.player2Score, w1: wins?.player1 ?? 0, w2: wins?.player2 ?? 0 })}
                        </span>}
                      </Link>
                    </p>
                  ) : <p style={{ color: '#9ca3af' }}>{t('spectator.live.courtIdle')}</p>}
                  {e.next && (
                    <p style={{ color: '#d1d5db', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                      {t('spectator.live.courtNext', { time: e.next.time.time || t('spectator.schedule.timeTbd'), match: label(e.next.match) })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="live-now-title">
        <h3 id="live-now-title" style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t('spectator.live.inProgress', { count: overview.live.length })}</h3>
        <LiveTab matches={matches} isFavorite={isFavorite} toggleFavorite={toggleFavorite} navigate={navigate} tournamentId={tournamentId} tournament={tournament} />
      </section>

      <section aria-labelledby="live-soon-title">
        <h3 id="live-soon-title" style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t('spectator.live.upcoming', { count: overview.upcoming.length })}</h3>
        {overview.upcoming.length === 0
          ? <p style={{ color: '#9ca3af' }}>{t('spectator.live.noUpcoming')}</p>
          : <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {overview.upcoming.map(r => <MatchListItem key={r.match.id} row={r} tournamentId={tournamentId} slotLabel={slotLabel} tournament={tournament} />)}
          </ul>}
      </section>

      <section aria-labelledby="live-recent-title">
        <h3 id="live-recent-title" style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t('spectator.live.recent', { count: overview.recent.length })}</h3>
        {overview.recent.length === 0
          ? <p style={{ color: '#9ca3af' }}>{t('spectator.live.noRecent')}</p>
          : <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {overview.recent.map(r => <MatchListItem key={r.match.id} row={r} tournamentId={tournamentId} slotLabel={slotLabel} tournament={tournament} />)}
          </ul>}
      </section>
    </div>
  );
}
