import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Match, ScheduleSlot, Tournament } from '@shared/types';
import { calculateGroupRanking, finalRankingRows, participantStats } from '@shared/utils/ranking';
import MatchListItem, { type SlotLabelFn } from './MatchListItem';
import { buildScheduleRows, groupProgress, matchesOfPlayer, matchesOfReferee, nextMatchRows } from '../../utils/spectatorData';
import type { PersonEntry } from '../../utils/peopleSearch';
import { divisionsOfPlayer, hasDivisionChoice, type Division } from '@shared/utils/divisions';

interface CommonProps {
  tournament: Tournament;
  tournamentId: string;
  matches: Match[];
  schedule: ScheduleSlot[];
  slotLabel: SlotLabelFn;
  now: number;
}

const h2Style = { fontSize: '1.5rem', fontWeight: 'bold', color: '#facc15' } as const;
const h3Style = { fontSize: '1.125rem', fontWeight: 'bold', margin: '1rem 0 0.5rem' } as const;

export interface PlayerDetailProps extends CommonProps {
  person: PersonEntry | null;
  playerKey: string;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, name?: string) => void;
  nameOf?: (name: string) => string;
  /** 대회의 부 목록: 둘 이상이면 이 선수가 나간 모든 부를 보여 준다 (matches는 부로 거르지 않은 전체 경기) */
  divisions?: ReadonlyArray<Division>;
}

/** 선수(팀) 상세: 지금 경기·다음 경기, 현재 순위(조 경기 중이면 잠정), 전적, 일정과 결과 */
export function PlayerDetail({ person, playerKey, tournament, tournamentId, matches, schedule, slotLabel, now, isFavorite, toggleFavorite, nameOf = n => n, divisions = [] }: PlayerDetailProps) {
  const { t } = useTranslation();
  const id = person?.id || playerKey;
  const name = person?.name || playerKey;
  const mine = useMemo(() => matchesOfPlayer(matches, id, name), [matches, id, name]);
  const rows = useMemo(() => buildScheduleRows(mine, schedule, tournament.date || ''), [mine, schedule, tournament.date]);
  const live = rows.find(r => r.match.status === 'in_progress');
  const next = useMemo(() => nextMatchRows(rows, now, { includeUntimed: true })[0], [rows, now]);
  const stats = useMemo(() => participantStats(mine, tournament).find(r => r.playerId === id), [mine, tournament, id]);

  const standing = useMemo(() => {
    const gid = mine.find(m => m.groupId)?.groupId;
    if (!gid) return null;
    const gm = matches.filter(m => m.groupId === gid);
    const row = calculateGroupRanking(gm, undefined, tournament, gid).find(r => r.playerId === id);
    const prog = groupProgress(gm)[0];
    return row ? { gid, rank: row.rank, tied: !!row.tied, provisional: !!prog?.provisional } : null;
  }, [mine, matches, tournament, id]);
  const playerDivisions = useMemo(() => (hasDivisionChoice(divisions) ? divisionsOfPlayer(mine, divisions) : []), [mine, divisions]);
  const finalPlace = useMemo(() => finalRankingRows(matches, tournament).find(r => r.id === id && r.place !== null), [matches, tournament, id]);

  if (mine.length === 0) {
    return (
      <div>
        <h2 style={h2Style} data-route-focus tabIndex={-1}>{name}</h2>
        <p style={{ color: '#d1d5db', marginTop: '0.5rem' }}>{t('spectator.person.notFound')}</p>
        <p style={{ marginTop: '1rem' }}><Link to={`/spectator/tournament/${tournamentId}/players`}>{t('spectator.person.backToPlayers')}</Link></p>
      </div>
    );
  }
  const fav = isFavorite(id);
  const pct = (stats?.wins ?? 0) + (stats?.losses ?? 0) > 0 ? Math.round(((stats?.wins ?? 0) / ((stats?.wins ?? 0) + (stats?.losses ?? 0))) * 100) : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={h2Style} data-route-focus data-route-title={t('spectator.person.pageTitle', { name, tournament: tournament.name })} tabIndex={-1}>{nameOf(name)}</h2>
        <button
          type="button"
          onClick={() => toggleFavorite(id, name)}
          aria-pressed={fav}
          aria-label={t('spectator.favorites.toggleLabel', { name })}
          style={{ background: 'none', border: 'none', fontSize: '1.75rem', cursor: 'pointer', minWidth: '48px', minHeight: '48px', color: 'var(--color-primary)' }}
        >
          <span aria-hidden="true">{fav ? '★' : '☆'}</span>
        </button>
      </div>
      {person && person.groups.length > 0 && <p style={{ color: '#d1d5db' }}>{person.groups.map(g => t('spectator.tournament.view.groupLabel', { id: g })).join(', ')}</p>}

      <dl className="card" style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.375rem 1rem' }}>
        {playerDivisions.length > 0 && <>
          <dt style={{ color: '#9ca3af' }}>{t('spectator.filters.division')}</dt>
          <dd>{playerDivisions.map(d => d.label || d.id).join(', ')}</dd>
        </>}
        <dt style={{ color: '#9ca3af' }}>{t('spectator.person.now')}</dt>
        <dd>{live ? t('spectator.person.playingNow', { court: live.court.name || '-' }) : next
          ? t('spectator.person.nextAt', { when: [next.time.date, next.time.time].filter(Boolean).join(' ') || t('spectator.schedule.timeTbd'), court: next.court.name || '-' })
          : t('spectator.person.noMore')}</dd>
        {standing && <>
          <dt style={{ color: '#9ca3af' }}>{t('spectator.person.standing')}</dt>
          <dd>
            {t('spectator.person.groupRank', { group: standing.gid, rank: standing.tied ? t('common.competitionRules.jointPlace', { place: standing.rank }) : t('common.competitionRules.place', { place: standing.rank }) })}
            {standing.provisional && <strong style={{ marginLeft: '0.5rem', color: '#fbbf24' }}>{t('spectator.person.provisional')}</strong>}
          </dd>
        </>}
        {finalPlace && <>
          <dt style={{ color: '#9ca3af' }}>{t('common.competitionRules.placeHeader')}</dt>
          <dd>{finalPlace.joint ? t('common.competitionRules.jointPlace', { place: finalPlace.place }) : t('common.competitionRules.place', { place: finalPlace.place })}</dd>
        </>}
        <dt style={{ color: '#9ca3af' }}>{t('spectator.tournament.playerRecord.record')}</dt>
        <dd>{t('spectator.players.record', { w: stats?.wins ?? 0, l: stats?.losses ?? 0 })}{pct !== null && ` (${t('spectator.person.winRate', { pct })})`}</dd>
      </dl>

      <h3 style={h3Style}>{t('spectator.person.matches', { count: rows.length })}</h3>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rows.map(r => <MatchListItem key={r.match.id} row={r} tournamentId={tournamentId} slotLabel={slotLabel} tournament={tournament} perspectiveKey={id} showDate />)}
      </ul>
      <p style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <Link to={`/spectator/player/${tournamentId}/${encodeURIComponent(name)}`}>{t('spectator.person.fullProfile', { name })}</Link>
        <Link to={`/spectator/tournament/${tournamentId}/players`}>{t('spectator.person.backToPlayers')}</Link>
      </p>
    </div>
  );
}

export interface RefereeDetailProps extends CommonProps {
  person: PersonEntry | null;
  refereeId: string;
  assignedIds: string[];
}

/** 심판 상세: 맡은 경기 (시간순) */
export function RefereeDetail({ person, refereeId, assignedIds, tournament, tournamentId, matches, schedule, slotLabel }: RefereeDetailProps) {
  const { t } = useTranslation();
  const name = person?.name || refereeId;
  const rows = useMemo(() => buildScheduleRows(matchesOfReferee(matches, refereeId, assignedIds), schedule, tournament.date || ''), [matches, refereeId, assignedIds, schedule, tournament.date]);
  return (
    <div>
      <h2 style={h2Style} data-route-focus data-route-title={t('spectator.person.refereePageTitle', { name, tournament: tournament.name })} tabIndex={-1}>{t('spectator.person.refereeHeading', { name })}</h2>
      <h3 style={h3Style}>{t('spectator.person.matches', { count: rows.length })}</h3>
      {rows.length === 0
        ? <p style={{ color: '#d1d5db' }}>{t('spectator.person.refereeNoMatches')}</p>
        : <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {rows.map(r => <MatchListItem key={r.match.id} row={r} tournamentId={tournamentId} slotLabel={slotLabel} tournament={tournament} showDate />)}
        </ul>}
      <p style={{ marginTop: '1rem' }}><Link to={`/spectator/tournament/${tournamentId}/referees`}>{t('spectator.person.backToReferees')}</Link></p>
    </div>
  );
}
