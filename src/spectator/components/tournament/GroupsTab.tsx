import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { qualifierMarks, type RankingTournament } from '@shared/utils/ranking';
import type { Match } from '@shared/types';
import GroupRankingTable from './GroupRankingTable';
import { isPlayableMatch } from '../../utils/spectatorData';

export interface GroupsTabProps {
  matches: Match[];
  onSelectPlayer: (name: string) => void;
  isTeam?: boolean;
  isFullLeague?: boolean;
  /** 대회 규칙(점수·부전승·동률·진출 인원)을 읽는다 */
  tournament?: Partial<RankingTournament> | null;
}

export default function GroupsTab({ matches, onSelectPlayer, isTeam = false, isFullLeague = false, tournament }: GroupsTabProps) {
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
  // 진출 표시: 본선 생성기와 같은 진출자 선정(조당 인원 + 와일드카드 + 동률 규칙)
  const marks = useMemo(() => qualifierMarks(groupMatches, tournament), [groupMatches, tournament]);

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
        const playable = gMatches.filter(isPlayableMatch);
        const completed = playable.filter(m => m.status === 'completed').length;
        const inProgress = playable.filter(m => m.status === 'in_progress').length;
        // 조 경기가 다 끝나기 전 순위는 잠정이다 (진행 중 경기는 끝난 경기만으로 계산)
        const provisional = completed < playable.length;
        const groupName = groupId === 'default' ? t('spectator.tournament.view.matchLabel') : t('spectator.tournament.view.groupLabel', { id: groupId });
        const status = provisional
          ? t('spectator.standings.provisional', { completed, total: playable.length })
          : t('spectator.standings.final');
        return (
          <section key={groupId} className="card" aria-labelledby={`group-${groupId}-title`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h3 id={`group-${groupId}-title`} style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#facc15' }}>
                {groupName}
              </h3>
              <span style={{ fontSize: '0.875rem', fontWeight: 'bold', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', backgroundColor: provisional ? '#92400e' : '#15803d', color: '#fff' }}>
                {status}
                {inProgress > 0 && ` · ${t('spectator.standings.inProgressCount', { count: inProgress })}`}
              </span>
            </div>
            <GroupRankingTable matches={gMatches} onSelectPlayer={onSelectPlayer} isTeam={isTeam} tournament={tournament} scope={groupId === 'default' ? '' : groupId} marks={marks} caption={`${groupName}, ${status}`} />
          </section>
        );
      })}
    </div>
  );
}
