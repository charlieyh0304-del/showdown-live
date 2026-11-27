import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Match, Referee } from '@shared/types';
import { rememberFocusKey } from '@shared/utils/focusReturn';
import { buildPeopleIndex } from '../../utils/peopleSearch';
import { matchesOfReferee } from '../../utils/spectatorData';
import { refereePath } from '../../utils/spectatorRoutes';

export interface RefereesTabProps {
  referees: Referee[];
  assignments: Record<string, { assignedMatchIds: string[] }>;
  matches: Match[];
  tournamentId: string;
}

/** 심판 명단: 이름을 누르면 그 심판이 맡은 경기 (주소가 있어 뒤로 가기로 돌아오면 누른 이름에 초점이 돌아온다) */
export default function RefereesTab({ referees, assignments, matches, tournamentId }: RefereesTabProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const list = useMemo(
    () => buildPeopleIndex(matches, referees, assignments)
      .filter(p => p.kind === 'referee')
      .map(p => {
        const ms = matchesOfReferee(matches, p.id, assignments[p.id]?.assignedMatchIds || []);
        return { ...p, total: ms.length, live: ms.filter(m => m.status === 'in_progress').length, done: ms.filter(m => m.status === 'completed').length };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [matches, referees, assignments],
  );

  if (list.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.referees.noReferees')}</p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: '#d1d5db', marginBottom: '0.75rem' }}>{t('spectator.referees.intro')}</p>
      <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{t('spectator.tournament.referees.count', { count: list.length })}</p>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {list.map(r => {
          const focusKey = `referee:${r.id}`;
          return (
            <li key={r.id}>
              <Link
                to={refereePath(tournamentId, r.id)}
                data-focus-key={focusKey}
                onClick={() => rememberFocusKey(location.key, focusKey)}
                className="card"
                style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', textDecoration: 'none', color: 'inherit', padding: '0.75rem 1rem' }}
              >
                <span style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#facc15' }}>{r.name}</span>
                <span style={{ color: '#d1d5db', fontSize: '0.875rem' }}>
                  <span className="sr-only">, </span>{t('spectator.tournament.referees.matchSummary', { completed: r.done, total: r.total })}
                  {r.live > 0 && <span style={{ color: '#fca5a5', marginLeft: '0.5rem' }}><span className="sr-only">, </span>{t('spectator.referees.liveNow', { count: r.live })}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
