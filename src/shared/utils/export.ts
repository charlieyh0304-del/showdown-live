import type { Match, Tournament, Player, Team } from '../types';
import { calculateIndividualRanking, calculateTeamRanking } from './ranking';

export function exportResultsCSV(tournament: Tournament, matches: Match[], players: Player[], _teams: Team[]): string {
  const isTeam = tournament.type === 'team' || tournament.type === 'randomTeamLeague';
  const lines: string[] = [];

  lines.push(`대회명,${tournament.name}`);
  lines.push(`날짜,${tournament.date}`);
  lines.push(`유형,${isTeam ? '팀전' : '개인전'}`);
  lines.push('');

  // Rankings
  lines.push('=== 순위표 ===');
  if (isTeam) {
    const rankings = calculateTeamRanking(matches);
    lines.push('순위,팀명,승,패,득점,실점,점수차');
    for (const r of rankings) {
      lines.push(`${r.rank},${r.teamName || r.teamId},${r.wins},${r.losses},${r.pointsFor},${r.pointsAgainst},${r.pointsFor - r.pointsAgainst}`);
    }
  } else {
    const rankings = calculateIndividualRanking(matches, ['set_difference', 'point_difference']);
    lines.push('순위,선수명,승,패,세트득,세트실,득점,실점');
    for (const r of rankings) {
      const player = players.find(p => p.id === r.playerId);
      lines.push(`${r.rank},${player?.name || r.playerId},${r.wins},${r.losses},${r.setsWon},${r.setsLost},${r.pointsFor},${r.pointsAgainst}`);
    }
  }

  lines.push('');
  lines.push('=== 경기 결과 ===');
  const completed = matches.filter(m => m.status === 'completed');
  if (isTeam) {
    lines.push('#,팀1,팀2,스코어,승자,부전승');
    completed.forEach((m, i) => {
      const scores = (m.sets || []).map(s => `${s.player1Score}-${s.player2Score}`).join(' / ');
      const winner = m.winnerId === m.team1Id ? (m.team1Name || '') : (m.team2Name || '');
      lines.push(`${i + 1},${m.team1Name || ''},${m.team2Name || ''},${scores},${winner},${(m as unknown as Record<string, unknown>).walkover ? 'Y' : ''}`);
    });
  } else {
    lines.push('#,선수1,선수2,세트스코어,승자,부전승');
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

export function exportPrintableHTML(tournament: Tournament, matches: Match[], players: Player[], _teams: Team[]): string {
  const isTeam = tournament.type === 'team' || tournament.type === 'randomTeamLeague';
  const completed = matches.filter(m => m.status === 'completed');

  let rankingHTML = '';
  if (isTeam) {
    const rankings = calculateTeamRanking(matches);
    rankingHTML = `
      <h2>팀 순위표</h2>
      <table>
        <thead>
          <tr>
            <th>순위</th><th>팀명</th><th>승</th><th>패</th><th>득점</th><th>실점</th><th>점수차</th>
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
      <h2>개인 순위표</h2>
      <table>
        <thead>
          <tr>
            <th>순위</th><th>선수명</th><th>승</th><th>패</th><th>세트득</th><th>세트실</th><th>득점</th><th>실점</th>
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
      <h2>경기 결과</h2>
      <table>
        <thead>
          <tr>
            <th>#</th><th>팀1</th><th>팀2</th><th>스코어</th><th>승자</th>
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
      <h2>경기 결과</h2>
      <table>
        <thead>
          <tr>
            <th>#</th><th>선수1</th><th>선수2</th><th>세트스코어</th><th>승자</th>
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
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${tournament.name} - 결과표</title>
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
  <button class="print-btn no-print" onclick="window.print()">인쇄하기</button>
  <h1>${tournament.name}</h1>
  <div class="meta">
    <p>${tournament.date} | ${isTeam ? '팀전' : '개인전'}</p>
  </div>
  <div class="summary">
    <span>전체 ${matches.length}경기</span>
    <span>완료 ${completed.length}경기</span>
    <span>진행중 ${matches.filter(m => m.status === 'in_progress').length}경기</span>
    <span>대기 ${matches.filter(m => m.status === 'pending').length}경기</span>
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
