import { useId, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '@shared/types';
import MatchListItem, { type SlotLabelFn } from './MatchListItem';
import { useStageKeyLabel } from '../../hooks/useStageLabels';
import { filterFromParams, filterScheduleRows, filterToParams, scheduleFilterOptions, type ScheduleFilter, type ScheduleRow } from '../../utils/spectatorData';

export interface ScheduleSectionProps {
  rows: ScheduleRow[];
  tournament: Tournament;
  tournamentId: string;
  slotLabel: SlotLabelFn;
  favoriteIds: string[];
}

/**
 * 경기 일정: 날짜·단계·코트·상태·즐겨찾기만 보기로 거른다. 필터는 주소(검색 파라미터)에 남아 뒤로 가기·공유가 된다.
 * 결과 수는 polite로 알린다.
 */
export default function ScheduleSection({ rows, tournament, tournamentId, slotLabel, favoriteIds }: ScheduleSectionProps) {
  const { t } = useTranslation();
  const uid = useId();
  const [params, setParams] = useSearchParams();
  const filter = filterFromParams(params);
  const options = useMemo(() => scheduleFilterOptions(rows), [rows]);
  const visible = useMemo(() => filterScheduleRows(rows, filter, favoriteIds), [rows, filter, favoriteIds]);
  const stageLabel = useStageKeyLabel();

  const set = (patch: Partial<ScheduleFilter>) => setParams(filterToParams({ ...filter, ...patch }), { replace: true });
  const selectStyle = { width: '100%' } as const;

  // 날짜가 여러 날이면 날짜별로 묶는다
  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const r of visible) {
      const k = r.time.date || '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <div>
      <fieldset className="card" style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
        <legend style={{ fontWeight: 'bold', padding: '0 0.25rem' }}>{t('spectator.filters.legend')}</legend>
        {options.dates.length > 1 && (
          <div>
            <label htmlFor={`${uid}-date`} style={{ display: 'block' }}>{t('spectator.filters.date')}</label>
            <select id={`${uid}-date`} className="input" style={selectStyle} value={filter.date} onChange={e => set({ date: e.target.value })}>
              <option value="">{t('spectator.filters.all')}</option>
              {options.dates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}
        {options.stages.length > 1 && (
          <div>
            <label htmlFor={`${uid}-stage`} style={{ display: 'block' }}>{t('spectator.filters.stage')}</label>
            <select id={`${uid}-stage`} className="input" style={selectStyle} value={filter.stage} onChange={e => set({ stage: e.target.value })}>
              <option value="">{t('spectator.filters.all')}</option>
              {options.stages.map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
            </select>
          </div>
        )}
        {options.courts.length > 1 && (
          <div>
            <label htmlFor={`${uid}-court`} style={{ display: 'block' }}>{t('spectator.filters.court')}</label>
            <select id={`${uid}-court`} className="input" style={selectStyle} value={filter.court} onChange={e => set({ court: e.target.value })}>
              <option value="">{t('spectator.filters.all')}</option>
              {options.courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${uid}-status`} style={{ display: 'block' }}>{t('spectator.filters.status')}</label>
          <select id={`${uid}-status`} className="input" style={selectStyle} value={filter.status || 'all'} onChange={e => set({ status: e.target.value as ScheduleFilter['status'] })}>
            <option value="all">{t('spectator.filters.all')}</option>
            <option value="remaining">{t('spectator.filters.remaining')}</option>
            <option value="completed">{t('spectator.filters.completed')}</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input id={`${uid}-fav`} type="checkbox" checked={filter.favoritesOnly} onChange={e => set({ favoritesOnly: e.target.checked })} style={{ width: '1.5rem', height: '1.5rem', minHeight: 0 }} />
          <label htmlFor={`${uid}-fav`}>{t('spectator.filters.favoritesOnly')}</label>
        </div>
      </fieldset>

      <p role="status" aria-live="polite" style={{ color: '#d1d5db', marginBottom: '0.75rem' }}>
        {t('spectator.schedule.count', { count: visible.length, total: rows.length })}
      </p>

      {visible.length === 0 ? (
        <p className="card" style={{ textAlign: 'center', color: '#d1d5db' }}>
          {filter.favoritesOnly && favoriteIds.length === 0 ? t('spectator.schedule.noFavorites') : t('spectator.schedule.empty')}
        </p>
      ) : byDate.map(([date, list]) => (
        <div key={date || 'none'} style={{ marginBottom: '1rem' }}>
          {byDate.length > 1 && <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{date || t('spectator.schedule.dateTbd')}</h3>}
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {list.map(r => <MatchListItem key={r.match.id} row={r} tournamentId={tournamentId} slotLabel={slotLabel} tournament={tournament} />)}
          </ul>
        </div>
      ))}
    </div>
  );
}
