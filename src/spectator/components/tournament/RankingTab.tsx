import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateIndividualRanking, calculateTeamRanking, calculateGroupRanking } from '@shared/utils/ranking';
import type { Match, PlayerRanking, TeamRanking } from '@shared/types';

export interface RankingTabProps {
  matches: Match[];
  tournamentType: string;
  isFavorite: (id: string) => boolean;
  onSelectPlayer: (name: string) => void;
  stageFilter: 'all' | 'qualifying' | 'finals' | 'ranking';
  tournament?: { rankingMatchConfig?: { thirdPlace?: boolean; fifthToEighth?: boolean; classificationGroups?: boolean; rankingUpTo?: number } };
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

        <TournamentResultsSummary matches={matches} tournamentType={tournamentType} />
        <GroupRankingView matches={matches} onSelectPlayer={onSelectPlayer} isTeam={tournamentType === 'team' || tournamentType === 'randomTeamLeague'} />
      </div>
    );
  }

  const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';

  if (isTeam) {
    return (
      <div>

        <TournamentResultsSummary matches={matches} tournamentType={tournamentType} />
        <TeamRankingTable matches={matches} onSelectPlayer={onSelectPlayer} />
      </div>
    );
  }

  return (
    <div>

      <TournamentResultsSummary matches={matches} tournamentType={tournamentType} />
      <IndividualRankingTable matches={matches} isFavorite={isFavorite} onSelectPlayer={onSelectPlayer} tournament={tournament} />
    </div>
  );
}

function GroupRankingView({ matches, onSelectPlayer, isTeam = false }: { matches: Match[]; onSelectPlayer: (name: string) => void; isTeam?: boolean }) {
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
          <GroupRankingTable matches={groupMatches} onSelectPlayer={onSelectPlayer} isTeam={isTeam} />
        </div>
      ))}
    </div>
  );
}

function GroupRankingTable({ matches, onSelectPlayer, isTeam = false }: { matches: Match[]; onSelectPlayer: (name: string) => void; isTeam?: boolean }) {
  const { t } = useTranslation();
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
              <td style={{ textAlign: 'center', padding: '0.5rem', color: '#22c55e' }}>{r.wins}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: '#ef4444' }}>{r.losses}</td>
              {!isTeam && <td style={{ textAlign: 'center', padding: '0.5rem' }}>{t('spectator.tournament.view.setWL', { w: r.setsWon, l: r.setsLost })}</td>}
              {!isTeam && <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(r.setsWon - r.setsLost).color, fontWeight: 'bold' }}>{formatDiff(r.setsWon - r.setsLost).text}</td>}
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.pointsFor}-{r.pointsAgainst}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(r.pointsFor - r.pointsAgainst).color, fontWeight: 'bold' }}>{formatDiff(r.pointsFor - r.pointsAgainst).text}</td>
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
  tournament?: { rankingMatchConfig?: { thirdPlace?: boolean; fifthToEighth?: boolean; classificationGroups?: boolean; rankingUpTo?: number } };
}) {
  const { t } = useTranslation();
  const allRankingsRaw: PlayerRanking[] = useMemo(() => calculateIndividualRanking(matches), [matches]);
  // 본선/순위결정전 참가자만 추출
  const finalsParticipantIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of matches) {
      const isFinals = (m.stageId?.includes('finals') || m.stageId?.includes('ranking') || m.roundLabel?.includes('\uacb0\uc815\uc804'));
      if (!isFinals) continue;
      const a = m.player1Id || m.team1Id;
      const b = m.player2Id || m.team2Id;
      if (a) ids.add(a);
      if (b) ids.add(b);
    }
    return ids;
  }, [matches]);
  const hasFinalsStage = finalsParticipantIds.size > 0;
  // 본선 참가자만 1~N위 (본선 없으면 전체)
  const rankedOnly = hasFinalsStage
    ? allRankingsRaw.filter(r => finalsParticipantIds.has(r.playerId)).map((r, i) => ({ ...r, rank: i + 1 }))
    : allRankingsRaw;
  const rkCfg = tournament?.rankingMatchConfig;
  let maxRankSpec = rankedOnly.length;
  if (rkCfg) {
    if (rkCfg.rankingUpTo && rkCfg.rankingUpTo > 0) maxRankSpec = rkCfg.rankingUpTo;
    else if (rkCfg.classificationGroups) maxRankSpec = rankedOnly.length;
    else if (rkCfg.fifthToEighth) maxRankSpec = 8;
    else if (rkCfg.thirdPlace) maxRankSpec = 4;
  }
  const rankings: PlayerRanking[] = rankedOnly.slice(0, maxRankSpec);

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
              key={r.playerId}
              style={{
                backgroundColor: isFavorite(r.playerId) ? '#1e3a5f' : 'transparent',
                borderBottom: '1px solid #1f2937',
              }}
            >
              <td style={tdStyle}>{r.rank}</td>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold' }}>
                {isFavorite(r.playerId) && <span style={{ color: 'var(--color-primary)', marginRight: '0.25rem' }}>{'\u2605'}</span>}
                <button
                  onClick={() => onSelectPlayer(r.playerName)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                >
                  {r.playerName}
                </button>
              </td>
              <td style={tdStyle}>{r.played}</td>
              <td style={{ ...tdStyle, color: 'var(--color-success)' }}>{r.wins}</td>
              <td style={{ ...tdStyle, color: 'var(--color-danger)' }}>{r.losses}</td>
              <td style={tdStyle}>{t('spectator.tournament.view.setWL', { w: r.setsWon, l: r.setsLost })}</td>
              <td style={{ ...tdStyle, color: formatDiff(r.setsWon - r.setsLost).color, fontWeight: 'bold' }}>{formatDiff(r.setsWon - r.setsLost).text}</td>
              <td style={tdStyle}>{r.pointsFor}/{r.pointsAgainst}</td>
              <td style={{ ...tdStyle, color: formatDiff(r.pointsFor - r.pointsAgainst).color, fontWeight: 'bold' }}>{formatDiff(r.pointsFor - r.pointsAgainst).text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamRankingTable({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const { t } = useTranslation();
  const rankings: TeamRanking[] = useMemo(() => calculateTeamRanking(matches), [matches]);

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
            <tr key={r.teamId} style={{ borderBottom: '1px solid #1f2937' }}>
              <td style={tdStyle}>{r.rank}</td>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold' }}>
                <button
                  onClick={() => onSelectPlayer(r.teamName)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                >
                  {r.teamName}
                </button>
              </td>
              <td style={{ ...tdStyle, color: 'var(--color-success)' }}>{r.wins}</td>
              <td style={{ ...tdStyle, color: 'var(--color-danger)' }}>{r.losses}</td>
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
}: {
  matches: Match[];
  tournamentType: string;
}) {
  const { t } = useTranslation();
  const summary = useMemo((): {
    top3: { name: string; rank: number }[];
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

    // Calculate rankings to find top 3
    let top3: { name: string; rank: number }[] = [];
    if (isTeam) {
      const rankings = calculateTeamRanking(matches);
      top3 = rankings.slice(0, 3).map(r => ({ name: r.teamName, rank: r.rank }));
    } else {
      const rankings = calculateIndividualRanking(matches);
      top3 = rankings.slice(0, 3).map(r => ({ name: r.playerName, rank: r.rank }));
    }

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
  }, [matches, tournamentType]);

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
          backgroundColor: summary.isFinished ? '#16a34a' : '#d97706',
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
            backgroundColor: medalStyles[i].bg,
            border: `1px solid ${medalStyles[i].border}`,
            borderRadius: '0.5rem',
            padding: i === 0 ? '0.75rem 1rem' : '0.5rem 1rem',
          }}>
            <span style={{
              fontSize: i === 0 ? '1.5rem' : '1.125rem',
              fontWeight: 'bold',
              color: medalStyles[i].text,
              minWidth: '2rem',
              textAlign: 'center',
            }}>
              {medalStyles[i].label}
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
