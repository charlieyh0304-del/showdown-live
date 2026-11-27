import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateGroupRanking, type QualifierMark, type RankingTournament } from '@shared/utils/ranking';
import type { Match } from '@shared/types';

/**
 * 조별(리그) 순위표 — 관전 화면 공용 (GroupsTab, RankingTab, BracketTab).
 * 순위는 대회 규칙의 동률 기준(calculateGroupRanking), 진출 표시는 본선 생성기와 같은 selectQualifiers 결과
 * (qualifierMarks: 조당 인원 + 명시적 와일드카드, 경계 동률은 '동률 결정 필요')로 보여 준다.
 */
export interface GroupRankingTableProps {
  matches: Match[];
  onSelectPlayer: (name: string) => void;
  isTeam?: boolean;
  tournament?: Partial<RankingTournament> | null;
  /** 동률 결정 범위 (조 ID). 조가 없으면 '' */
  scope?: string;
  /** 진출 표시 (예선 경기 전체로 계산한 qualifierMarks). 없으면 표시하지 않는다. */
  marks?: ReadonlyMap<string, QualifierMark>;
  /** 표 제목 (화면낭독기 caption). 잠정 순위면 그렇다고 적는다. */
  caption?: string;
}

function formatDiff(value: number): { text: string; color: string } {
  if (value > 0) return { text: `+${value}`, color: '#22c55e' };
  if (value < 0) return { text: `${value}`, color: '#ef4444' };
  return { text: '0', color: '#9ca3af' };
}

const thStyle = (align: 'left' | 'center'): React.CSSProperties => ({
  textAlign: align, padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1,
});

export default function GroupRankingTable({ matches, onSelectPlayer, isTeam = false, tournament, scope = '', marks, caption }: GroupRankingTableProps) {
  const { t } = useTranslation();
  const rankings = useMemo(() => calculateGroupRanking(matches, undefined, tournament, scope), [matches, tournament, scope]);

  if (rankings.length === 0) return null;

  const badge = (mark: QualifierMark | undefined) => {
    if (!mark) return null;
    const label = mark === 'tie'
      ? t('common.competitionRules.qualifierTie')
      : mark === 'wildcard' ? t('spectator.tournament.view.wildcardBadge') : t('spectator.tournament.view.advanceBadge');
    return (
      <span style={{
        marginLeft: '0.5rem',
        fontSize: '0.75rem',
        backgroundColor: mark === 'tie' ? '#92400e' : '#15803d',
        color: '#fff',
        padding: '0.125rem 0.375rem',
        borderRadius: '0.25rem',
      }}>
        {label}
      </span>
    );
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem' }}>
        <caption className="sr-only">{caption || t('spectator.tournament.tabs.groups')}</caption>
        <thead>
          <tr style={{ borderBottom: '2px solid #374151' }}>
            <th scope="col" style={thStyle('left')}>{t('spectator.tournament.view.rankLabel')}</th>
            <th scope="col" style={thStyle('left')}>{t('spectator.tournament.view.nameLabel')}</th>
            <th scope="col" style={thStyle('center')}>{t('spectator.tournament.view.matchesLabel')}</th>
            <th scope="col" style={thStyle('center')}>{t('spectator.tournament.view.winsLabel')}</th>
            <th scope="col" style={thStyle('center')}>{t('spectator.tournament.view.lossesLabel')}</th>
            {!isTeam && <th scope="col" style={thStyle('center')}>{t('spectator.tournament.view.setWinsLosses')}</th>}
            {!isTeam && <th scope="col" style={thStyle('center')}>{t('spectator.tournament.view.setDiff')}</th>}
            <th scope="col" style={thStyle('center')}>{t('spectator.tournament.view.pointsDiff')}</th>
            <th scope="col" style={thStyle('center')}>{t('spectator.tournament.view.goalDiff')}</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map(r => {
            const mark = marks?.get(r.playerId);
            const advancing = mark === 'qualified' || mark === 'wildcard';
            const name = r.playerName || '';
            const setDiff = r.setsWon - r.setsLost;
            const ptDiff = r.pointsFor - r.pointsAgainst;
            return (
              <tr
                key={r.playerId || name}
                style={{ borderBottom: '1px solid #1f2937', backgroundColor: advancing ? 'rgba(34, 197, 94, 0.1)' : 'transparent' }}
              >
                <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{r.tied ? t('common.competitionRules.jointPlace', { place: r.rank }) : r.rank}</td>
                <td style={{ padding: '0.5rem', fontWeight: 600, color: '#fff' }}>
                  <button
                    className="text-left hover:underline hover:text-yellow-400"
                    onClick={() => onSelectPlayer(name)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 600, padding: 0 }}
                  >
                    {name}
                  </button>
                  {badge(mark)}
                </td>
                <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.played}</td>
                <td style={{ textAlign: 'center', padding: '0.5rem', color: '#22c55e' }}><span className="sr-only">{t('spectator.tournament.view.srWins')}</span>{r.wins}</td>
                <td style={{ textAlign: 'center', padding: '0.5rem', color: '#ef4444' }}><span className="sr-only">{t('spectator.tournament.view.srLosses')}</span>{r.losses}</td>
                {!isTeam && <td style={{ textAlign: 'center', padding: '0.5rem' }}>{t('spectator.tournament.view.setWL', { w: r.setsWon, l: r.setsLost })}</td>}
                {!isTeam && <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(setDiff).color, fontWeight: 'bold' }}>{setDiff !== 0 && <span className="sr-only">{setDiff > 0 ? t('spectator.tournament.view.srDiffPositive') : t('spectator.tournament.view.srDiffNegative')}</span>}{formatDiff(setDiff).text}</td>}
                <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.pointsFor}-{r.pointsAgainst}</td>
                <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(ptDiff).color, fontWeight: 'bold' }}>{ptDiff !== 0 && <span className="sr-only">{ptDiff > 0 ? t('spectator.tournament.view.srDiffPositive') : t('spectator.tournament.view.srDiffNegative')}</span>}{formatDiff(ptDiff).text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
