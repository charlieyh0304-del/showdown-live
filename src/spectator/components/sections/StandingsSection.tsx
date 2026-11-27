import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Match, Tournament } from '@shared/types';
import { resolveCompetitionRules, isTeamType } from '@shared/rules/competitionRules';
import { groupStageIdOf } from '@shared/utils/ranking';
import GroupsTab from '../tournament/GroupsTab';
import RankingTab from '../tournament/RankingTab';
import { describeStandingsRules } from '../../utils/rulesSentence';

export interface StandingsSectionProps {
  matches: Match[];
  tournament: Tournament;
  isFavorite: (id: string) => boolean;
  onSelectPlayer: (name: string) => void;
  /** 고른 부의 규칙 스테이지 (부별 규칙 덮어쓰기, divisions.rulesScopeStageId). 조별 예선이 있으면 그 스테이지가 우선 */
  rulesStageId?: string;
}

/**
 * 순위: 규칙 설명(대회의 유효 규칙에서 만든 문장) → 조별 순위(진행 중이면 '잠정') → 최종 순위.
 */
export default function StandingsSection({ matches, tournament, isFavorite, onSelectPlayer, rulesStageId }: StandingsSectionProps) {
  const { t } = useTranslation();
  const groupMatches = useMemo(() => matches.filter(m => m.groupId), [matches]);
  const hasGroups = groupMatches.length > 0;
  const team = isTeamType(tournament.type);
  const rulesText = useMemo(() => {
    const rules = resolveCompetitionRules(tournament, (hasGroups ? groupStageIdOf(groupMatches, tournament) : undefined) ?? rulesStageId);
    return describeStandingsRules(rules, t, { hasGroups, kind: team ? 'team' : 'individual' });
  }, [tournament, groupMatches, hasGroups, team, t, rulesStageId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section aria-labelledby="standings-rules-title" className="card">
        <h3 id="standings-rules-title" style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>{t('spectator.standings.rulesTitle')}</h3>
        <p style={{ color: '#e5e7eb' }}>{rulesText}</p>
      </section>

      {hasGroups && (
        <section aria-labelledby="standings-groups-title">
          <h3 id="standings-groups-title" style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t('spectator.standings.groupsTitle')}</h3>
          <GroupsTab matches={matches} onSelectPlayer={onSelectPlayer} isTeam={team} tournament={tournament} />
        </section>
      )}

      <section aria-labelledby="standings-final-title">
        <h3 id="standings-final-title" style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t('spectator.standings.finalTitle')}</h3>
        <RankingTab matches={matches} tournamentType={tournament.type} isFavorite={isFavorite} onSelectPlayer={onSelectPlayer} stageFilter="all" tournament={tournament} />
      </section>
    </div>
  );
}
