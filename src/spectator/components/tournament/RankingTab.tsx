import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateGroupRanking, finalRankingRows, groupStageIdOf, type FinalRankingRow, type RankingTournament } from '@shared/utils/ranking';
import { resolveCompetitionRules } from '@shared/rules/competitionRules';
import type { Match } from '@shared/types';

type RulesTournament = Partial<RankingTournament> | null | undefined;

/** 최종 순위 표기 (공동 순위·미정 포함, 스크린리더도 같은 문장을 읽는다) */
function usePlaceLabel() {
  const { t } = useTranslation();
  return (r: FinalRankingRow): string => {
    if (r.place === null) return t('common.competitionRules.pendingPlace');
    return r.joint ? t('common.competitionRules.jointPlace', { place: r.place }) : String(r.place);
  };
}

export interface RankingTabProps {
  matches: Match[];
  tournamentType: string;
  isFavorite: (id: string) => boolean;
  onSelectPlayer: (name: string) => void;
  stageFilter: 'all' | 'qualifying' | 'finals' | 'ranking';
  /** 대회 규칙(점수·부전승·동률·최종 순위 정책)을 읽는다 */
  tournament?: RulesTournament;
}

function formatDiff(value: number): { text: string; color: string } {
  if (value > 0) return { text: `+${value}`, color: '#22c55e' };
  if (value < 0) return { text: `${value}`, color: '#ef4444' };
  return { text: '0', color: '#9ca3af' };
}

const thStyle: React.CSSProperties = {
  padding: '0.75rem 0.5rem',
  textAlign: 'center',
  fontWeight: 'bold',
  color: 'var(--color-primary)',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  backgroundColor: '#1f2937',
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 0.5rem',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

export default function RankingTab({
  matches,
  tournamentType,
  isFavorite,
  onSelectPlayer,
  stageFilter,
  tournament,
}: RankingTabProps) {
  if (stageFilter === 'qualifying') {
    return (
      <div>

        <TournamentResultsSummary matches={matches} tournamentType={tournamentType} tournament={tournament} />
        <GroupRankingView matches={matches} onSelectPlayer={onSelectPlayer} isTeam={tournamentType === 'team' || tournamentType === 'randomTeamLeague'} tournament={tournament} />
      </div>
    );
  }

  const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';

  if (isTeam) {
    return (
      <div>

        <TournamentResultsSummary matches={matches} tournamentType={tournamentType} tournament={tournament} />
        <TeamRankingTable matches={matches} onSelectPlayer={onSelectPlayer} tournament={tournament} />
      </div>
    );
  }

  return (
    <div>

      <TournamentResultsSummary matches={matches} tournamentType={tournamentType} tournament={tournament} />
      <IndividualRankingTable matches={matches} isFavorite={isFavorite} onSelectPlayer={onSelectPlayer} tournament={tournament} />
    </div>
  );
}

function GroupRankingView({ matches, onSelectPlayer, isTeam = false, tournament }: { matches: Match[]; onSelectPlayer: (name: string) => void; isTeam?: boolean; tournament?: RulesTournament }) {
  const { t } = useTranslation();
  const groups = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
      const gid = m.groupId || 'default';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [matches]);

  if (groups.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.stageFilter.qualifying')} - {t('common.matchStatus.pending')}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {groups.map(([groupId, groupMatches]) => (
        <div key={groupId} className="card">
          <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.75rem', textAlign: 'center' }}>
            {groupId === 'default' ? t('spectator.tournament.view.overallRanking') : t('spectator.tournament.view.groupRanking', { id: groupId })}
          </h3>
          <GroupRankingTable matches={groupMatches} onSelectPlayer={onSelectPlayer} isTeam={isTeam} tournament={tournament} scope={groupId === 'default' ? '' : groupId} />
        </div>
      ))}
    </div>
  );
}

function GroupRankingTable({ matches, onSelectPlayer, isTeam = false, tournament, scope = '' }: { matches: Match[]; onSelectPlayer: (name: string) => void; isTeam?: boolean; tournament?: RulesTournament; scope?: string }) {
  const { t } = useTranslation();
  // 진출 인원은 대회 규칙(조당 진출 인원)에서 읽는다
  const perGroup = resolveCompetitionRules(tournament, groupStageIdOf(matches, tournament)).qualification.perGroup;
  const rankings = useMemo(() => {
    const r = calculateGroupRanking(matches, undefined, tournament, scope);
    return r.map(p => ({
      rank: p.rank,
      tied: !!p.tied,
      name: p.playerName || '',
      played: p.played,
      wins: p.wins,
      losses: p.losses,
      setsWon: p.setsWon,
      setsLost: p.setsLost,
      pointsFor: p.pointsFor,
      pointsAgainst: p.pointsAgainst,
    }));
  }, [matches, tournament, scope]);

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
                backgroundColor: i < perGroup ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
              }}
            >
              <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{r.tied ? t('common.competitionRules.jointPlace', { place: r.rank }) : r.rank}</td>
              <td style={{ padding: '0.5rem', fontWeight: 600, color: '#fff' }}>
                <button
                  className="text-left hover:underline hover:text-yellow-400"
                  onClick={() => onSelectPlayer(r.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 600, padding: 0 }}
                >
                  {r.name}
                </button>
                {i < perGroup && (
                  <span style={{
                    marginLeft: '0.5rem',
                    fontSize: '0.75rem',
                    backgroundColor: '#15803d',
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

function IndividualRankingTable({
  matches,
  isFavorite,
  onSelectPlayer,
  tournament,
}: {
  matches: Match[];
  isFavorite: (id: string) => boolean;
  onSelectPlayer: (name: string) => void;
  tournament?: RulesTournament;
}) {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  // 최종 순위: 대진 결과(결승 → 3/4위전 → 순위결정전 → 라운드), 대진이 없으면 순위표 + 동률 규칙 (총 승수 아님)
  const rankings: FinalRankingRow[] = useMemo(() => finalRankingRows(matches, tournament), [matches, tournament]);

  if (rankings.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.tabs.ranking')} - {t('common.matchStatus.pending')}</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <caption className="sr-only">{t('spectator.tournament.tabs.ranking')}</caption>
        <thead>
          <tr style={{ backgroundColor: '#1f2937' }}>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.rankLabel')}</th>
            <th scope="col" style={{ ...thStyle, textAlign: 'left' }}>{t('spectator.tournament.view.nameLabel')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.matchesLabel')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.winsLabel')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.lossesLabel')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.setWinsLosses')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.setDiff')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.pointsDiff')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.goalDiff')}</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r) => (
            <tr
              key={r.id}
              style={{
                backgroundColor: isFavorite(r.id) ? '#1e3a5f' : 'transparent',
                borderBottom: '1px solid #1f2937',
              }}
            >
              <td style={tdStyle}>{placeLabel(r)}{r.unresolved && <span style={{ display: 'block', fontSize: '0.75rem', color: '#fb923c' }}>{t('common.competitionRules.tiedUnresolved')}</span>}</td>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold' }}>
                {isFavorite(r.id) && <span style={{ color: 'var(--color-primary)', marginRight: '0.25rem' }}>{'\u2605'}</span>}
                <button
                  onClick={() => onSelectPlayer(r.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                >
                  {r.name}
                </button>
              </td>
              <td style={tdStyle}>{r.played}</td>
              <td style={{ ...tdStyle, color: 'var(--color-success)' }}><span className="sr-only">{t('spectator.tournament.view.srWins')}</span>{r.wins}</td>
              <td style={{ ...tdStyle, color: 'var(--color-danger)' }}><span className="sr-only">{t('spectator.tournament.view.srLosses')}</span>{r.losses}</td>
              <td style={tdStyle}>{t('spectator.tournament.view.setWL', { w: r.setsWon, l: r.setsLost })}</td>
              <td style={{ ...tdStyle, color: formatDiff(r.setsWon - r.setsLost).color, fontWeight: 'bold' }}>{(r.setsWon - r.setsLost) !== 0 && <span className="sr-only">{(r.setsWon - r.setsLost) > 0 ? t('spectator.tournament.view.srDiffPositive') : t('spectator.tournament.view.srDiffNegative')}</span>}{formatDiff(r.setsWon - r.setsLost).text}</td>
              <td style={tdStyle}>{r.pointsFor}/{r.pointsAgainst}</td>
              <td style={{ ...tdStyle, color: formatDiff(r.pointsFor - r.pointsAgainst).color, fontWeight: 'bold' }}>{(r.pointsFor - r.pointsAgainst) !== 0 && <span className="sr-only">{(r.pointsFor - r.pointsAgainst) > 0 ? t('spectator.tournament.view.srDiffPositive') : t('spectator.tournament.view.srDiffNegative')}</span>}{formatDiff(r.pointsFor - r.pointsAgainst).text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamRankingTable({ matches, onSelectPlayer, tournament }: { matches: Match[]; onSelectPlayer: (name: string) => void; tournament?: RulesTournament }) {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const rankings: FinalRankingRow[] = useMemo(() => finalRankingRows(matches, tournament), [matches, tournament]);

  if (rankings.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.tabs.ranking')} - {t('common.matchStatus.pending')}</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <caption className="sr-only">{t('spectator.tournament.tabs.ranking')}</caption>
        <thead>
          <tr style={{ backgroundColor: '#1f2937' }}>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.rankLabel')}</th>
            <th scope="col" style={{ ...thStyle, textAlign: 'left' }}>{t('spectator.tournament.view.nameLabel')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.winsLabel')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.lossesLabel')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.pointsDiff')}</th>
            <th scope="col" style={thStyle}>{t('spectator.tournament.view.goalDiff')}</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #1f2937' }}>
              <td style={tdStyle}>{placeLabel(r)}{r.unresolved && <span style={{ display: 'block', fontSize: '0.75rem', color: '#fb923c' }}>{t('common.competitionRules.tiedUnresolved')}</span>}</td>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold' }}>
                <button
                  onClick={() => onSelectPlayer(r.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                >
                  {r.name}
                </button>
              </td>
              <td style={{ ...tdStyle, color: 'var(--color-success)' }}><span className="sr-only">{t('spectator.tournament.view.srWins')}</span>{r.wins}</td>
              <td style={{ ...tdStyle, color: 'var(--color-danger)' }}><span className="sr-only">{t('spectator.tournament.view.srLosses')}</span>{r.losses}</td>
              <td style={tdStyle}>{r.pointsFor}</td>
              <td style={tdStyle}>{r.pointsAgainst}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== Tournament Results Summary =====
function TournamentResultsSummary({
  matches,
  tournamentType,
  tournament,
}: {
  matches: Match[];
  tournamentType: string;
  tournament?: RulesTournament;
}) {
  const { t } = useTranslation();
  const summary = useMemo((): {
    top3: { name: string; rank: number; joint: boolean }[];
    totalMatches: number;
    completedCount: number;
    totalSets: number;
    highestMatch: { name: string; totalPoints: number } | null;
    isFinished: boolean;
  } => {
    const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';
    const completedMatches = matches.filter(m => m.status === 'completed');
    const totalMatches = matches.length;
    const completedCount = completedMatches.length;
    const isFinished = totalMatches > 0 && completedCount === totalMatches;

    // 시상대: 최종 순위 3위까지 (대진 결과 기준, 공동 3위 포함). 결승이 끝나기 전에는 정해진 순위만 보인다.
    const top3 = finalRankingRows(matches, tournament)
      .filter(r => r.place !== null && r.place <= 3)
      .map(r => ({ name: r.name, rank: r.place as number, joint: r.joint }));

    // Total sets played
    let totalSets = 0;
    completedMatches.forEach(m => {
      totalSets += (Array.isArray(m.sets) ? m.sets : []).length;
    });

    // Highest scoring match
    const highestMatch = completedMatches.reduce<{ name: string; totalPoints: number } | null>((best, m) => {
      const total = (Array.isArray(m.sets) ? m.sets : []).reduce((sum, s) => sum + s.player1Score + s.player2Score, 0);
      if (total <= 0) return best;
      if (best && total <= best.totalPoints) return best;
      const label = isTeam
        ? `${m.team1Name || '?'} vs ${m.team2Name || '?'}`
        : `${m.player1Name || '?'} vs ${m.player2Name || '?'}`;
      return { name: label, totalPoints: total };
    }, null);

    return { top3, totalMatches, completedCount, totalSets, highestMatch, isFinished };
  }, [matches, tournamentType, tournament]);

  if (summary.top3.length === 0) return null;

  const medalStyles: { bg: string; border: string; text: string; label: string }[] = [
    { bg: 'rgba(250, 204, 21, 0.15)', border: '#facc15', text: '#facc15', label: '1st' },
    { bg: 'rgba(192, 192, 192, 0.12)', border: '#a8a8a8', text: '#c0c0c0', label: '2nd' },
    { bg: 'rgba(205, 127, 50, 0.12)', border: '#cd7f32', text: '#cd7f32', label: '3rd' },
  ];

  return (
    <div style={{
      backgroundColor: '#1f2937',
      borderRadius: '0.75rem',
      padding: '1rem 1.25rem',
      marginBottom: '1.25rem',
      border: '1px solid #374151',
    }}>
      {/* Status badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#9ca3af' }}>{t('spectator.tournament.view.tournamentSummary')}</span>
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 'bold',
          padding: '0.25rem 0.625rem',
          borderRadius: '9999px',
          backgroundColor: summary.isFinished ? '#15803d' : '#b45309',
          color: '#fff',
        }}>
          {summary.isFinished ? t('common.matchStatus.completed') : t('common.matchStatus.inProgress')}
        </span>
      </div>

      {/* Podium */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {summary.top3.map((entry, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            backgroundColor: medalStyles[Math.min(entry.rank, 3) - 1].bg,
            border: `1px solid ${medalStyles[Math.min(entry.rank, 3) - 1].border}`,
            borderRadius: '0.5rem',
            padding: i === 0 ? '0.75rem 1rem' : '0.5rem 1rem',
          }}>
            <span style={{
              fontSize: i === 0 ? '1.5rem' : '1.125rem',
              fontWeight: 'bold',
              color: medalStyles[Math.min(entry.rank, 3) - 1].text,
              minWidth: '2rem',
              textAlign: 'center',
            }}>
              {medalStyles[Math.min(entry.rank, 3) - 1].label}{entry.joint && <span className="sr-only"> {t('common.competitionRules.jointPlace', { place: entry.rank })}</span>}
            </span>
            <span style={{
              fontSize: i === 0 ? '1.375rem' : '1rem',
              fontWeight: 'bold',
              color: i === 0 ? '#facc15' : '#d1d5db',
            }}>
              {entry.name}
            </span>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.5rem',
        textAlign: 'center',
        borderTop: '1px solid #374151',
        paddingTop: '0.75rem',
      }}>
        <div>
          <p style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#60a5fa' }}>
            {summary.completedCount}/{summary.totalMatches}
          </p>
          <p style={{ fontSize: '0.6875rem', color: '#9ca3af' }}>{t('spectator.tournament.view.matchesCompleted')}</p>
        </div>
        <div>
          <p style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#c084fc' }}>
            {summary.totalSets}
          </p>
          <p style={{ fontSize: '0.6875rem', color: '#9ca3af' }}>{t('spectator.tournament.view.totalSets')}</p>
        </div>
        <div>
          <p style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#f472b6' }}>
            {summary.highestMatch ? summary.highestMatch.totalPoints : '-'}
          </p>
          <p style={{ fontSize: '0.6875rem', color: '#9ca3af' }}>{t('spectator.tournament.view.highestScore')}</p>
        </div>
      </div>

      {/* Highest scoring match detail */}
      {summary.highestMatch && (
        <p style={{ fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center', marginTop: '0.375rem' }}>
          {t('spectator.tournament.view.highestMatchInfo', { name: summary.highestMatch.name, points: summary.highestMatch.totalPoints })}
        </p>
      )}
    </div>
  );
}
