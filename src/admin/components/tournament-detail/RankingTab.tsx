import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { finalRankingRows, type FinalRankingRow } from '@shared/utils/ranking';
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


  // 최종 순위는 총 승수가 아니라 대진 결과(결승 → 3/4위전 → 순위결정전 → 라운드)로, 대진이 없으면 순위표 + 동률 규칙으로 정한다.
  // 모두 대회 규칙(tournament.rules 등)에서 계산하므로 규칙을 바꾸면 바로 다시 계산된다. 정해지지 않은 순위는 '—'.
  const rows: FinalRankingRow[] = finalRankingRows(matches, tournament);
  const placeLabel = (r: FinalRankingRow): string => {
    if (r.place === null) return '\u2014';
    return r.joint ? t('common.competitionRules.jointPlace', { place: r.place }) : String(r.place);
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

    rows.forEach(r => {
      lines.push(isTeamType
        ? `${placeLabel(r)}: ${r.name} (${r.wins}W ${r.losses}L, ${formatDiff(r.pointsFor - r.pointsAgainst)})`
        : `${placeLabel(r)}: ${r.name} (${r.wins}W ${r.losses}L)`);
    });

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
    const rankings = rows;
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
                  <tr key={r.id} className={r.place !== null && r.place <= 3 ? 'bg-gray-800' : ''}>
                    <td className="border border-gray-600 p-3 text-center font-bold text-yellow-400">{placeLabel(r)}{r.unresolved && <span className="block text-xs text-orange-400">{t('common.competitionRules.tiedUnresolved')}</span>}</td>
                    <td className="border border-gray-600 p-3 font-semibold">{r.name}</td>
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

  const rankings = rows;
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
                <tr key={r.id} className={r.place !== null && r.place <= 3 ? 'bg-gray-800' : ''}>
                  <td className="border border-gray-600 p-3 text-center font-bold text-yellow-400">{placeLabel(r)}{r.unresolved && <span className="block text-xs text-orange-400">{t('common.competitionRules.tiedUnresolved')}</span>}</td>
                  <td className="border border-gray-600 p-3 font-semibold">{r.name}</td>
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
