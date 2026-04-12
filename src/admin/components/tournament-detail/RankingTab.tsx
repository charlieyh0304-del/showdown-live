import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateIndividualRanking, calculateTeamRanking } from '@shared/utils/ranking';
import { exportResultsCSV, downloadCSV } from '@shared/utils/export';
import type { Match, Tournament } from '@shared/types';

export interface RankingTabProps {
  tournament: Tournament;
  matches: Match[];
  isTeamType: boolean;
}

export default function RankingTab({ tournament, matches, isTeamType }: RankingTabProps) {
  const { t } = useTranslation();
  const [copySuccess, setCopySuccess] = useState(false);
  const completedMatches = matches.filter(m => m.status === 'completed');


  // 본선/순위결정전에 참가한 인원만 최종 순위로 인정 (예: 5-8위전까지만 → 9위 이하 숨김)
  // 본선/순위결정전이 없으면(풀리그 등) 전체 표시
  const finalsParticipantIds = (() => {
    const ids = new Set<string>();
    for (const m of matches) {
      const isFinals = (m.stageId?.includes('finals') || m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전'));
      if (!isFinals) continue;
      const a = m.player1Id || m.team1Id;
      const b = m.player2Id || m.team2Id;
      if (a) ids.add(a);
      if (b) ids.add(b);
    }
    return ids;
  })();
  const hasFinalsStage = finalsParticipantIds.size > 0;
  // 본선 진출자만 순위 산출(1..k), 미진출자는 rank=0(미산출)으로 두고 뒤에 배치
  const assignRanks = <T extends { rank: number }>(arr: T[], idOf: (r: T) => string): T[] => {
    if (!hasFinalsStage) return arr;
    const ranked = arr.filter(r => finalsParticipantIds.has(idOf(r)));
    const unranked = arr.filter(r => !finalsParticipantIds.has(idOf(r)));
    ranked.forEach((r, i) => { r.rank = i + 1; });
    unranked.forEach(r => { r.rank = 0; });
    return [...ranked, ...unranked];
  };
  const totalPoints = completedMatches.reduce((sum, m) => {
    return sum + (m.sets || []).reduce((s, set) => s + set.player1Score + set.player2Score, 0);
  }, 0);
  const avgPointsPerMatch = completedMatches.length > 0 ? (totalPoints / completedMatches.length).toFixed(1) : '0';

  // Completed matches sorted by most recent first
  const completedMatchesSorted = [...completedMatches].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const formatDiff = (val: number) => val > 0 ? `+${val}` : `${val}`;

  const handleExportCSV = () => {
    const csv = exportResultsCSV(tournament as Parameters<typeof exportResultsCSV>[0], matches, [], [], t);
    const filename = `${tournament.name}_${t('admin.tournamentDetail.tabs.ranking')}_${tournament.date || 'export'}.csv`;
    downloadCSV(csv, filename);
  };

  const handleCopyResults = async () => {
    const lines: string[] = [];
    lines.push(`[${tournament.name}] ${t('admin.tournamentDetail.rankingTab.resultText')}`);
    lines.push(`${tournament.date}${tournament.endDate ? ` ~ ${tournament.endDate}` : ''}`);
    lines.push(`${isTeamType ? t('admin.tournamentDetail.rankingTab.typeTeam') : t('admin.tournamentDetail.rankingTab.typeIndividual')}`);
    lines.push('');

    if (isTeamType) {
      const teamRankings = assignRanks(calculateTeamRanking(matches), r => r.teamId);
      teamRankings.forEach(r => {
        lines.push(`${r.rank > 0 ? r.rank : '\u2014'}: ${r.teamName || r.teamId} (${r.wins}W ${r.losses}L, ${formatDiff(r.pointsFor - r.pointsAgainst)})`);
      });
    } else {
      const indivRankings = assignRanks(calculateIndividualRanking(matches), r => r.playerId);
      indivRankings.forEach(r => {
        lines.push(`${r.rank > 0 ? r.rank : '\u2014'}: ${r.playerName || r.playerId} (${r.wins}W ${r.losses}L)`);
      });
    }

    lines.push('');
    lines.push(t('admin.tournamentDetail.rankingTab.totalCompleted', { completed: completedMatches.length, total: matches.length }));

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = lines.join('\n');
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const exportButtons = (
    <div className="card flex items-center gap-3 flex-wrap">
      <span className="font-semibold text-gray-300">{t('admin.tournamentDetail.rankingTab.exportLabel')}</span>
      <button
        className="btn btn-secondary"
        onClick={handleExportCSV}
        disabled={completedMatches.length === 0}
        aria-label={t('admin.tournamentDetail.rankingTab.csvExport')}
      >
        {t('admin.tournamentDetail.rankingTab.csvExport')}
      </button>
      <button
        className="btn btn-secondary"
        onClick={handleCopyResults}
        disabled={completedMatches.length === 0}
        aria-label={t('admin.tournamentDetail.rankingTab.copyResults')}
      >
        {copySuccess ? t('admin.tournamentDetail.rankingTab.copied') : t('admin.tournamentDetail.rankingTab.copyResults')}
      </button>
    </div>
  );

  if (isTeamType) {
    const rankings = assignRanks(calculateTeamRanking(matches), r => r.teamId);
    return (
      <div className="space-y-6">

        {exportButtons}

        {/* Summary stats */}
        <div className="card flex gap-6 flex-wrap">
          <div>
            <span className="text-gray-400 text-sm">{t('admin.tournamentDetail.rankingTab.matchProgress')}</span>
            <p className="text-lg font-bold">{completedMatches.length} / {matches.length}</p>
          </div>
          <div>
            <span className="text-gray-400 text-sm">{t('admin.tournamentDetail.rankingTab.avgPointsPerMatch')}</span>
            <p className="text-lg font-bold">{avgPointsPerMatch}</p>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="text-xl font-bold mb-4 text-center">{t('admin.tournamentDetail.rankingTab.teamRankingTitle')}</h2>
          {rankings.length === 0 ? (
            <p className="text-gray-400 text-center">{t('admin.tournamentDetail.rankingTab.noCompletedMatches')}</p>
          ) : (
            <table className="w-full border-collapse" aria-label={t('admin.tournamentDetail.rankingTab.teamRankingAriaLabel')}>
              <thead>
                <tr>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.rankHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">{t('admin.tournamentDetail.rankingTab.teamNameHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.matchCountHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.winsHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.lossesHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.pointsHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.pointDiffHeader')}</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map(r => (
                  <tr key={r.teamId} className={r.rank > 0 && r.rank <= 3 ? 'bg-gray-800' : ''}>
                    <td className="border border-gray-600 p-3 text-center font-bold text-yellow-400">{r.rank > 0 ? r.rank : '\u2014'}</td>
                    <td className="border border-gray-600 p-3 font-semibold">{r.teamName}</td>
                    <td className="border border-gray-600 p-3 text-center">{r.played}</td>
                    <td className="border border-gray-600 p-3 text-center text-green-400">{r.wins}</td>
                    <td className="border border-gray-600 p-3 text-center text-red-400">{r.losses}</td>
                    <td className="border border-gray-600 p-3 text-center">{r.pointsFor}-{r.pointsAgainst}</td>
                    <td className="border border-gray-600 p-3 text-center">{formatDiff(r.pointsFor - r.pointsAgainst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Completed matches list (most recent first) */}
        {completedMatchesSorted.length > 0 && (
          <div className="card">
            <h2 className="text-xl font-bold mb-4 text-center">{t('admin.tournamentDetail.rankingTab.completedMatchesTitle')}</h2>
            <div className="space-y-2">
              {completedMatchesSorted.map(match => (
                <div key={match.id} className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <span className="font-semibold">{match.team1Name ?? '?'} vs {match.team2Name ?? '?'}</span>
                  <div className="flex gap-2">
                    {(() => {
                      const isP2W = match.winnerId === (match.player2Id || match.team2Id);
                      return (match.sets || []).map((s, i) => (
                        <span key={i} className="px-2 py-0.5 bg-gray-700 rounded text-sm font-mono">
                          {isP2W ? s.player2Score : s.player1Score}-{isP2W ? s.player1Score : s.player2Score}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const allRankings = assignRanks(calculateIndividualRanking(matches), r => r.playerId);
  // 1차: rank=0 (본선/순위결정전 미참가자) 제외 → 본선 진출자만
  // 2차: 대회 설정에 따라 추가 제한
  const rankedOnly = hasFinalsStage ? allRankings.filter(r => r.rank > 0) : allRankings;
  const rankCfg = tournament.rankingMatchConfig as { thirdPlace?: boolean; fifthToEighth?: boolean; classificationGroups?: boolean; rankingUpTo?: number } | undefined;
  let maxRank = rankedOnly.length; // 기본: 본선 참가자 전체
  if (rankCfg) {
    if (rankCfg.rankingUpTo && rankCfg.rankingUpTo > 0) {
      maxRank = rankCfg.rankingUpTo;
    } else if (rankCfg.classificationGroups) {
      maxRank = rankedOnly.length;
    } else if (rankCfg.fifthToEighth) {
      maxRank = 8;
    } else if (rankCfg.thirdPlace) {
      maxRank = 4;
    }
  }
  const rankings = rankedOnly.slice(0, maxRank);
  return (
    <div className="space-y-6">

      {exportButtons}

      {/* Summary stats */}
      <div className="card flex gap-6 flex-wrap">
        <div>
          <span className="text-gray-400 text-sm">{t('admin.tournamentDetail.rankingTab.matchProgress')}</span>
          <p className="text-lg font-bold">{completedMatches.length} / {matches.length}</p>
        </div>
        <div>
          <span className="text-gray-400 text-sm">{t('admin.tournamentDetail.rankingTab.avgPointsPerMatch')}</span>
          <p className="text-lg font-bold">{avgPointsPerMatch}</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="text-xl font-bold mb-4 text-center">{t('admin.tournamentDetail.rankingTab.individualRankingTitle')}</h2>
        {rankings.length === 0 ? (
          <p className="text-gray-400 text-center">{t('admin.tournamentDetail.rankingTab.noCompletedMatches')}</p>
        ) : (
          <table className="w-full border-collapse" aria-label={t('admin.tournamentDetail.rankingTab.individualRankingAriaLabel')}>
            <thead>
              <tr>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.rankHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">{t('admin.tournamentDetail.rankingTab.nameHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.matchCountHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.winsHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.lossesHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.setWonLostHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.setDiffHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.pointWonLostHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.pointDiffHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(r => (
                <tr key={r.playerId} className={r.rank > 0 && r.rank <= 3 ? 'bg-gray-800' : ''}>
                  <td className="border border-gray-600 p-3 text-center font-bold text-yellow-400">{r.rank > 0 ? r.rank : '\u2014'}</td>
                  <td className="border border-gray-600 p-3 font-semibold">{r.playerName}</td>
                  <td className="border border-gray-600 p-3 text-center">{r.played}</td>
                  <td className="border border-gray-600 p-3 text-center text-green-400">{r.wins}</td>
                  <td className="border border-gray-600 p-3 text-center text-red-400">{r.losses}</td>
                  <td className="border border-gray-600 p-3 text-center">{r.setsWon}-{r.setsLost}</td>
                  <td className="border border-gray-600 p-3 text-center">{formatDiff(r.setsWon - r.setsLost)}</td>
                  <td className="border border-gray-600 p-3 text-center">{r.pointsFor}-{r.pointsAgainst}</td>
                  <td className="border border-gray-600 p-3 text-center">{formatDiff(r.pointsFor - r.pointsAgainst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
