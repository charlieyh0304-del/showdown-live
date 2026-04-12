import type { Match, Tournament, Player, Team } from '../types';
import { calculateIndividualRanking, calculateTeamRanking } from './ranking';
import type { TFunction } from 'i18next';

export function exportResultsCSV(tournament: Tournament, matches: Match[], players: Player[], _teams: Team[], t?: TFunction): string {
  const isTeam = tournament.type === 'team' || tournament.type === 'randomTeamLeague';
  const lines: string[] = [];
  const tr = (key: string, fallback: string) => t ? t(`common.export.${key}`) : fallback;

  lines.push(`${tr('tournamentName', 'Tournament Name')},${tournament.name}`);
  lines.push(`${tr('date', 'Date')},${tournament.date}`);
  lines.push(`${tr('type', 'Type')},${isTeam ? tr('teamType', 'Teams') : tr('individualType', 'Singles')}`);
  lines.push('');

  // Rankings
  lines.push(`=== ${tr('rankingTable', 'Rankings')} ===`);
  if (isTeam) {
    const rankings = calculateTeamRanking(matches);
    lines.push(`${tr('rank', 'Rank')},${tr('teamName', 'Team')},${tr('wins', 'W')},${tr('losses', 'L')},${tr('pointsFor', 'PF')},${tr('pointsAgainst', 'PA')},${tr('pointDiff', 'Diff')}`);
    for (const r of rankings) {
      lines.push(`${r.rank},${r.teamName || r.teamId},${r.wins},${r.losses},${r.pointsFor},${r.pointsAgainst},${r.pointsFor - r.pointsAgainst}`);
    }
  } else {
    const rankings = calculateIndividualRanking(matches, ['set_difference', 'point_difference']);
    lines.push(`${tr('rank', 'Rank')},${tr('playerName', 'Player')},${tr('wins', 'W')},${tr('losses', 'L')},${tr('setsWon', 'SW')},${tr('setsLost', 'SL')},${tr('pointsFor', 'PF')},${tr('pointsAgainst', 'PA')}`);
    for (const r of rankings) {
      const player = players.find(p => p.id === r.playerId);
      lines.push(`${r.rank},${player?.name || r.playerId},${r.wins},${r.losses},${r.setsWon},${r.setsLost},${r.pointsFor},${r.pointsAgainst}`);
    }
  }

  lines.push('');
  lines.push(`=== ${tr('matchResults', 'Match Results')} ===`);
  const completed = matches.filter(m => m.status === 'completed');
  if (isTeam) {
    lines.push(`${tr('matchNumber', '#')},${tr('team1', 'Team 1')},${tr('team2', 'Team 2')},${tr('score', 'Score')},${tr('winner', 'Winner')},${tr('walkover', 'Walkover')}`);
    completed.forEach((m, i) => {
      const scores = (m.sets || []).map(s => `${s.player1Score}-${s.player2Score}`).join(' / ');
      const winner = m.winnerId === m.team1Id ? (m.team1Name || '') : (m.team2Name || '');
      lines.push(`${i + 1},${m.team1Name || ''},${m.team2Name || ''},${scores},${winner},${(m as unknown as Record<string, unknown>).walkover ? 'Y' : ''}`);
    });
  } else {
    lines.push(`${tr('matchNumber', '#')},${tr('player1', 'Player 1')},${tr('player2', 'Player 2')},${tr('setScore', 'Set Score')},${tr('winner', 'Winner')},${tr('walkover', 'Walkover')}`);
    completed.forEach((m, i) => {
      const scores = (m.sets || []).map(s => `${s.player1Score}-${s.player2Score}`).join(' / ');
      const winner = m.winnerId === m.player1Id ? (m.player1Name || '') : (m.player2Name || '');
      lines.push(`${i + 1},${m.player1Name || ''},${m.player2Name || ''},${scores},${winner},${(m as unknown as Record<string, unknown>).walkover ? 'Y' : ''}`);
    });
  }
  return lines.join('\n');
}

export function downloadCSV(content: string, filename: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportPrintableHTML(tournament: Tournament, matches: Match[], players: Player[], _teams: Team[], t?: TFunction): string {
  const isTeam = tournament.type === 'team' || tournament.type === 'randomTeamLeague';
  const completed = matches.filter(m => m.status === 'completed');
  const tr = (key: string, fallback: string) => t ? t(`common.export.${key}`) : fallback;
  const lang = t ? (t('common.appName') === '쇼다운' ? 'ko' : 'en') : 'ko';

  let rankingHTML = '';
  if (isTeam) {
    const rankings = calculateTeamRanking(matches);
    rankingHTML = `
      <h2>${tr('teamRankingTitle', 'Team Rankings')}</h2>
      <table>
        <thead>
          <tr>
            <th>${tr('rank', 'Rank')}</th><th>${tr('teamName', 'Team')}</th><th>${tr('wins', 'W')}</th><th>${tr('losses', 'L')}</th><th>${tr('pointsFor', 'PF')}</th><th>${tr('pointsAgainst', 'PA')}</th><th>${tr('pointDiff', 'Diff')}</th>
          </tr>
        </thead>
        <tbody>
          ${rankings.map(r => `
            <tr${r.rank <= 3 ? ' class="top-rank"' : ''}>
              <td class="center">${r.rank}</td>
              <td>${r.teamName || r.teamId}</td>
              <td class="center">${r.wins}</td>
              <td class="center">${r.losses}</td>
              <td class="center">${r.pointsFor}</td>
              <td class="center">${r.pointsAgainst}</td>
              <td class="center">${r.pointsFor - r.pointsAgainst}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    const rankings = calculateIndividualRanking(matches, ['set_difference', 'point_difference']);
    rankingHTML = `
      <h2>${tr('individualRankingTitle', 'Individual Rankings')}</h2>
      <table>
        <thead>
          <tr>
            <th>${tr('rank', 'Rank')}</th><th>${tr('playerName', 'Player')}</th><th>${tr('wins', 'W')}</th><th>${tr('losses', 'L')}</th><th>${tr('setsWon', 'SW')}</th><th>${tr('setsLost', 'SL')}</th><th>${tr('pointsFor', 'PF')}</th><th>${tr('pointsAgainst', 'PA')}</th>
          </tr>
        </thead>
        <tbody>
          ${rankings.map(r => {
            const player = players.find(p => p.id === r.playerId);
            return `
              <tr${r.rank <= 3 ? ' class="top-rank"' : ''}>
                <td class="center">${r.rank}</td>
                <td>${player?.name || r.playerId}</td>
                <td class="center">${r.wins}</td>
                <td class="center">${r.losses}</td>
                <td class="center">${r.setsWon}</td>
                <td class="center">${r.setsLost}</td>
                <td class="center">${r.pointsFor}</td>
                <td class="center">${r.pointsAgainst}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  let matchesHTML = '';
  if (isTeam) {
    matchesHTML = `
      <h2>${tr('matchResults', 'Match Results')}</h2>
      <table>
        <thead>
          <tr>
            <th>${tr('matchNumber', '#')}</th><th>${tr('team1', 'Team 1')}</th><th>${tr('team2', 'Team 2')}</th><th>${tr('score', 'Score')}</th><th>${tr('winner', 'Winner')}</th>
          </tr>
        </thead>
        <tbody>
          ${completed.map((m, i) => {
            const scores = (m.sets || []).map(s => `${s.player1Score}-${s.player2Score}`).join(' / ');
            const winner = m.winnerId === m.team1Id ? (m.team1Name || '') : (m.team2Name || '');
            return `
              <tr>
                <td class="center">${i + 1}</td>
                <td>${m.team1Name || ''}</td>
                <td>${m.team2Name || ''}</td>
                <td class="center">${scores}</td>
                <td>${winner}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } else {
    matchesHTML = `
      <h2>${tr('matchResults', 'Match Results')}</h2>
      <table>
        <thead>
          <tr>
            <th>${tr('matchNumber', '#')}</th><th>${tr('player1', 'Player 1')}</th><th>${tr('player2', 'Player 2')}</th><th>${tr('setScore', 'Set Score')}</th><th>${tr('winner', 'Winner')}</th>
          </tr>
        </thead>
        <tbody>
          ${completed.map((m, i) => {
            const scores = (m.sets || []).map(s => `${s.player1Score}-${s.player2Score}`).join(' / ');
            const winner = m.winnerId === m.player1Id ? (m.player1Name || '') : (m.player2Name || '');
            return `
              <tr>
                <td class="center">${i + 1}</td>
                <td>${m.player1Name || ''}</td>
                <td>${m.player2Name || ''}</td>
                <td class="center">${scores}</td>
                <td>${winner}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${tournament.name} - ${tr('resultSheet', 'Results')}</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
    body {
      font-family: 'Malgun Gothic', '맑은 고딕', sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
      color: #111;
      background: #fff;
    }
    h1 {
      font-size: 1.75rem;
      border-bottom: 3px solid #333;
      padding-bottom: 0.5rem;
      margin-bottom: 0.25rem;
    }
    .meta {
      color: #555;
      margin-bottom: 2rem;
      font-size: 0.95rem;
    }
    h2 {
      font-size: 1.25rem;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid #ccc;
      padding-bottom: 0.25rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 0.5rem 0.75rem;
    }
    th {
      background-color: #f0f0f0;
      font-weight: bold;
      text-align: center;
    }
    td.center { text-align: center; }
    tr.top-rank { background-color: #fffde7; }
    .print-btn {
      display: inline-block;
      margin-bottom: 1.5rem;
      padding: 0.5rem 1.5rem;
      background: #333;
      color: #fff;
      border: none;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 1rem;
    }
    .print-btn:hover { background: #555; }
    .summary {
      display: flex;
      gap: 2rem;
      margin-bottom: 1rem;
      font-size: 0.95rem;
    }
    .summary span { color: #555; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">${tr('printButton', 'Print')}</button>
  <h1>${tournament.name}</h1>
  <div class="meta">
    <p>${tournament.date} | ${isTeam ? tr('teamType', 'Teams') : tr('individualType', 'Singles')}</p>
  </div>
  <div class="summary">
    <span>${tr('totalMatches', `Total ${matches.length} matches`).replace('{{count}}', String(matches.length))}</span>
    <span>${tr('completedMatches', `Completed ${completed.length} matches`).replace('{{count}}', String(completed.length))}</span>
    <span>${tr('inProgressMatches', `In progress ${matches.filter(m => m.status === 'in_progress').length} matches`).replace('{{count}}', String(matches.filter(m => m.status === 'in_progress').length))}</span>
    <span>${tr('pendingMatches', `Pending ${matches.filter(m => m.status === 'pending').length} matches`).replace('{{count}}', String(matches.filter(m => m.status === 'pending').length))}</span>
  </div>
  ${rankingHTML}
  ${matchesHTML}
</body>
</html>`;
}

export function openPrintView(html: string): void {
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
