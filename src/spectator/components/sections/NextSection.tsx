import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '@shared/types';
import MatchListItem, { type SlotLabelFn } from './MatchListItem';
import { involves, nextMatchRows, type ScheduleRow } from '../../utils/spectatorData';

export interface NextSectionProps {
  rows: ScheduleRow[];
  now: number;
  tournament: Tournament;
  tournamentId: string;
  slotLabel: SlotLabelFn;
  favoriteIds: string[];
}

/**
 * 다음 경기: 지금부터 이른 순서. 대진이 아직 정해지지 않은 본선 경기는 라운드 이름·시각과 함께
 * '미정 (4강 1경기 승자)'처럼 어느 경기의 승자가 오는지 보여 준다.
 */
export default function NextSection({ rows, now, tournament, tournamentId, slotLabel, favoriteIds }: NextSectionProps) {
  const { t } = useTranslation();
  const uid = useId();
  const [favOnly, setFavOnly] = useState(false);
  const list = useMemo(() => {
    const next = nextMatchRows(rows, now, { includeUntimed: true });
    return favOnly ? next.filter(r => involves(r.match, favoriteIds)) : next;
  }, [rows, now, favOnly, favoriteIds]);

  return (
    <div>
      <p style={{ color: '#d1d5db', marginBottom: '0.75rem' }}>{t('spectator.next.intro')}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <input id={`${uid}-fav`} type="checkbox" checked={favOnly} onChange={e => setFavOnly(e.target.checked)} style={{ width: '1.5rem', height: '1.5rem', minHeight: 0 }} />
        <label htmlFor={`${uid}-fav`}>{t('spectator.filters.favoritesOnly')}</label>
      </div>
      <p role="status" aria-live="polite" style={{ color: '#9ca3af', marginBottom: '0.5rem' }}>{t('spectator.next.count', { count: list.length })}</p>
      {list.length === 0
        ? <p className="card" style={{ textAlign: 'center', color: '#d1d5db' }}>{t('spectator.next.empty')}</p>
        : <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {list.map(r => <MatchListItem key={r.match.id} row={r} tournamentId={tournamentId} slotLabel={slotLabel} tournament={tournament} showDate />)}
        </ul>}
    </div>
  );
}
