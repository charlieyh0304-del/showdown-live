import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateGroupRanking } from '@shared/utils/ranking';
import type { Match } from '@shared/types';

export interface GroupsTabProps {
  matches: Match[];
  onSelectPlayer: (name: string) => void;
  isTeam?: boolean;
  isFullLeague?: boolean;
}

export default function GroupsTab({ matches, onSelectPlayer, isTeam = false, isFullLeague = false }: GroupsTabProps) {
  const { t } = useTranslation();
  const groupMatches = useMemo(() => matches.filter(m => m.groupId), [matches]);

  const groups = useMemo(() => {
    const map = new Map<string, Match[]>();
    groupMatches.forEach(m => {
      const gid = m.groupId || 'default';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [groupMatches]);

  if (groups.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.tabs.groups')} - {t('common.matchStatus.pending')}</p>
      </div>
    );
  }

  const totalCompleted = groupMatches.filter(m => m.status === 'completed').length;
  const totalMatches = groupMatches.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <p style={{ fontSize: '0.875rem', color: '#9ca3af', textAlign: 'center' }}>
        {isFullLeague ? t('spectator.tournament.view.fullLeagueProgress', { completed: totalCompleted, total: totalMatches }) : t('spectator.tournament.view.groupProgress', { groups: groups.length, completed: totalCompleted, total: totalMatches })}
      </p>
      {groups.map(([groupId, gMatches]) => {
        const completed = gMatches.filter(m => m.status === 'completed').length;
        const inProgress = gMatches.filter(m => m.status === 'in_progress').length;
        return (
          <div key={groupId} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#facc15' }}>
                {groupId === 'default' ? t('spectator.tournament.view.matchLabel') : t('spectator.tournament.view.groupLabel', { id: groupId })}
              </h3>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                {completed}/{gMatches.length} {t('common.matchStatus.completed')}
                {inProgress > 0 && (
                  <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>{inProgress} {t('common.matchStatus.inProgress')}</span>
                )}
              </span>
            </div>
            <GroupRankingTable matches={gMatches} onSelectPlayer={onSelectPlayer} isTeam={isTeam} />
          </div>
        );
      })}
    </div>
  );
}

function formatDiff(value: number): { text: string; color: string } {
  if (value > 0) return { text: `+${value}`, color: '#22c55e' };
  if (value < 0) return { text: `${value}`, color: '#ef4444' };
  return { text: '0', color: '#9ca3af' };
}

function GroupRankingTable({ matches, onSelectPlayer, isTeam = false }: { matches: Match[]; onSelectPlayer: (name: string) => void; isTeam?: boolean }) {
  const { t } = useTranslation();
  // 단일 소스: shared/utils/ranking.ts의 calculateGroupRanking 사용
  const rankings = useMemo(() => {
    const r = calculateGroupRanking(matches);
    return r.map(p => ({
      name: p.playerName || '',
      played: p.played,
      wins: p.wins,
      losses: p.losses,
      setsWon: p.setsWon,
      setsLost: p.setsLost,
      pointsFor: p.pointsFor,
      pointsAgainst: p.pointsAgainst,
    }));
  }, [matches]);

  if (rankings.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem' }}>
        <caption className="sr-only">{t('spectator.tournament.tabs.groups')}</caption>
        <thead>
          <tr style={{ borderBottom: '2px solid #374151' }}>
            <th scope="col" style={{ textAlign: 'left', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.rankLabel')}</th>
            <th scope="col" style={{ textAlign: 'left', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.nameLabel')}</th>
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.matchesLabel')}</th>
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.winsLabel')}</th>
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.lossesLabel')}</th>
            {!isTeam && <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.setWinsLosses')}</th>}
            {!isTeam && <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.setDiff')}</th>}
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.pointsDiff')}</th>
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.goalDiff')}</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r, i) => (
            <tr
              key={r.name}
              style={{
                borderBottom: '1px solid #1f2937',
                backgroundColor: i < 2 ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
              }}
            >
              <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{i + 1}</td>
              <td style={{ padding: '0.5rem', fontWeight: 600, color: '#fff' }}>
                <button
                  className="text-left hover:underline hover:text-yellow-400"
                  onClick={() => onSelectPlayer(r.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 600, padding: 0 }}
                >
                  {r.name}
                </button>
                {i < 2 && (
                  <span style={{
                    marginLeft: '0.5rem',
                    fontSize: '0.75rem',
                    backgroundColor: '#16a34a',
                    color: '#fff',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '0.25rem',
                  }}>
                    {t('spectator.tournament.view.advanceBadge')}
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.played}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: '#22c55e' }}><span className="sr-only">{t('spectator.tournament.view.srWins')}</span>{r.wins}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: '#ef4444' }}><span className="sr-only">{t('spectator.tournament.view.srLosses')}</span>{r.losses}</td>
              {!isTeam && <td style={{ textAlign: 'center', padding: '0.5rem' }}>{t('spectator.tournament.view.setWL', { w: r.setsWon, l: r.setsLost })}</td>}
              {!isTeam && <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(r.setsWon - r.setsLost).color, fontWeight: 'bold' }}>{(r.setsWon - r.setsLost) !== 0 && <span className="sr-only">{(r.setsWon - r.setsLost) > 0 ? t('spectator.tournament.view.srDiffPositive') : t('spectator.tournament.view.srDiffNegative')}</span>}{formatDiff(r.setsWon - r.setsLost).text}</td>}
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.pointsFor}-{r.pointsAgainst}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(r.pointsFor - r.pointsAgainst).color, fontWeight: 'bold' }}>{(r.pointsFor - r.pointsAgainst) !== 0 && <span className="sr-only">{(r.pointsFor - r.pointsAgainst) > 0 ? t('spectator.tournament.view.srDiffPositive') : t('spectator.tournament.view.srDiffNegative')}</span>}{formatDiff(r.pointsFor - r.pointsAgainst).text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
