import type { Match, ScoreHistoryEntry, SetScore } from '../types';
import type { TFunction } from 'i18next';

function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.keys(val).sort((a, b) => Number(a) - Number(b)).map(k => (val as Record<string, T>)[k]);
}

const META_TYPES = new Set([
  'pause', 'resume', 'timeout', 'timeout_player', 'timeout_medical', 'timeout_referee',
  'substitution', 'dead_ball', 'walkover', 'side_change', 'coin_toss', 'warmup_start',
  'match_start', 'player_rotation', 'lineup', 'serve',
]);

const ACTION_KEY_MAP: Record<string, string> = {
  goal: 'common.scoreActions.goal',
  irregular_serve: 'common.scoreActions.irregularServe',
  centerboard: 'common.scoreActions.centerboard',
  body_touch: 'common.scoreActions.bodyTouch',
  illegal_defense: 'common.scoreActions.illegalDefense',
  out: 'common.scoreActions.out',
  ball_holding: 'common.scoreActions.ballHolding',
  mask_touch: 'common.scoreActions.maskTouch',
  penalty: 'common.scoreActions.penalty',
  penalty_table_pushing: 'common.scoreActions.penaltyTablePushing',
  penalty_electronic: 'common.scoreActions.penaltyElectronic',
  penalty_talking: 'common.scoreActions.penaltyTalking',
  walkover: 'common.scoreActions.walkover',
  coin_toss: 'common.matchHistory.coinToss',
  warmup_start: 'common.matchHistory.warmup',
  match_start: 'common.matchHistory.matchStart',
  substitution: 'common.matchHistory.substitution',
  player_rotation: 'common.matchHistory.playerRotation',
  lineup: 'common.matchHistory.lineup',
  side_change: 'common.matchHistory.sideChange',
};

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function generateMatchHtml(
  match: Match,
  tournament: { name: string; date?: string } | null,
  t: TFunction,
): string {
  const isTeam = match.type === 'team';
  const p1 = escHtml(isTeam ? (match.team1Name || 'Team 1') : (match.player1Name || 'Player 1'));
  const p2 = escHtml(isTeam ? (match.team2Name || 'Team 2') : (match.player2Name || 'Player 2'));
  const sets: SetScore[] = toArray(match.sets);
  const history: ScoreHistoryEntry[] = toArray(match.scoreHistory);
  const lang = t('common.appName') === '쇼다운' ? 'ko' : 'en';

  // Match info rows
  const infoRows: string[] = [];
  if (tournament?.date) infoRows.push(`<dt>${escHtml(t('common.pdf.date'))}</dt><dd>${escHtml(tournament.date)}</dd>`);
  if (match.scheduledDate) infoRows.push(`<dt>${escHtml(t('common.pdf.matchDate'))}</dt><dd>${escHtml(match.scheduledDate)} ${escHtml(match.scheduledTime || '')}</dd>`);
  if (match.courtName) infoRows.push(`<dt>${escHtml(t('common.pdf.court'))}</dt><dd>${escHtml(match.courtName)}</dd>`);
  if (match.refereeName) infoRows.push(`<dt>${escHtml(t('common.pdf.referee'))}</dt><dd>${escHtml(match.refereeName)}</dd>`);
  if (match.assistantRefereeName) infoRows.push(`<dt>${escHtml(t('common.pdf.assistantReferee'))}</dt><dd>${escHtml(match.assistantRefereeName)}</dd>`);
  if (match.roundLabel) infoRows.push(`<dt>${escHtml(t('common.pdf.round'))}</dt><dd>${escHtml(match.roundLabel)}</dd>`);

  // Coaches
  const p1Coach = match.player1Coach ? escHtml(match.player1Coach) : '';
  const p2Coach = match.player2Coach ? escHtml(match.player2Coach) : '';

  // Coin toss
  let coinTossHtml = '';
  if (match.coinTossWinner) {
    const tossWinner = match.coinTossWinner === 'player1' ? p1 : p2;
    const tossLoser = match.coinTossWinner === 'player1' ? p2 : p1;
    const tossChoice = match.coinTossChoice === 'serve' ? t('common.pdf.serve') : t('common.pdf.receive');
    const courtChange = match.courtChangeByLoser ? t('common.pdf.courtChangeYes') : t('common.pdf.courtChangeNo');
    coinTossHtml = `<p class="coin-toss">${escHtml(t('common.pdf.coinToss'))}: ${tossWinner} - ${escHtml(tossChoice)} / ${escHtml(t('common.pdf.courtChange'))}: ${tossLoser} - ${escHtml(courtChange)}</p>`;
  }

  // Set results table
  const setRows = sets.map((s, i) => {
    const winner = s.winnerId
      ? (s.player1Score > s.player2Score ? p1 : p2)
      : '-';
    const winClass = s.winnerId ? ' class="winner"' : '';
    return `<tr>
      <td>${i + 1}</td>
      <td${s.player1Score > s.player2Score ? winClass : ''}>${s.player1Score}</td>
      <td${s.player2Score > s.player1Score ? winClass : ''}>${s.player2Score}</td>
      <td>${winner}</td>
    </tr>`;
  }).join('');

  // Final result
  let finalHtml = '';
  if (match.winnerId) {
    const winnerName = match.winnerId === (isTeam ? match.team1Id : match.player1Id) ? p1 : p2;
    let p1Wins = 0, p2Wins = 0;
    sets.forEach(s => {
      if (s.winnerId) {
        if (s.player1Score > s.player2Score) p1Wins++;
        else p2Wins++;
      }
    });
    finalHtml = `<div class="final-result" role="status" aria-label="${escHtml(t('common.pdf.finalResult'))}: ${winnerName} (${p1Wins}-${p2Wins})">
      <strong>${escHtml(t('common.pdf.finalResult'))}:</strong> ${winnerName} (${p1Wins} - ${p2Wins})
    </div>`;
  }

  // Play-by-play
  const meaningful = history.filter(h =>
    h.points > 0 || h.penaltyWarning || META_TYPES.has(h.actionType || '')
  );

  let playByPlayHtml = '';
  if (meaningful.length > 0) {
    const setGroups = new Map<number, ScoreHistoryEntry[]>();
    meaningful.forEach(h => {
      const s = h.set || 1;
      if (!setGroups.has(s)) setGroups.set(s, []);
      setGroups.get(s)!.push(h);
    });

    const sections = Array.from(setGroups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([setNum, entries]) => {
        const sorted = [...entries].reverse();
        const rows = sorted.map(h => {
          const time = escHtml(h.time || '');
          const actionKey = ACTION_KEY_MAP[h.actionType || ''];
          let actionText: string;
          if (actionKey) {
            actionText = t(actionKey);
          } else if (h.actionType === 'dead_ball') {
            actionText = t('common.matchHistory.deadBall', { server: h.server || '' });
          } else if (h.actionType === 'timeout_player') {
            actionText = t('common.matchHistory.playerTimeout', { player: h.actionPlayer || '' });
          } else if (h.actionType === 'timeout_medical') {
            actionText = t('common.matchHistory.medicalTimeout', { player: h.actionPlayer || '' });
          } else if (h.actionType === 'timeout_referee') {
            actionText = t('common.matchHistory.refereeTimeout');
          } else if (h.actionType === 'pause') {
            actionText = t('common.matchHistory.pause', { player: h.actionPlayer || '' });
          } else if (h.actionType === 'resume') {
            actionText = h.actionPlayer || 'Resume';
          } else {
            actionText = h.actionType || '';
          }
          const action = escHtml(actionText);
          const isMeta = META_TYPES.has(h.actionType || '');
          // 파울류 액션은 actionPlayer(파울한 자) 표시, 그 외는 scoringPlayer(득점자) 표시
          const FOUL_TYPES = new Set(['foul', 'irregular_serve', 'centerboard', 'body_touch', 'illegal_defense', 'out', 'ball_holding', 'mask_touch', 'penalty', 'penalty_table_pushing', 'penalty_electronic', 'penalty_talking', 'serve_miss']);
          const isFoulAction = FOUL_TYPES.has(h.actionType || '');
          const displayName = !isMeta ? escHtml((isFoulAction ? h.actionPlayer : h.scoringPlayer) || '') : '';
          const pts = !isMeta && h.points ? (h.points > 0 ? `+${h.points}` : `${h.points}`) : '';
          // 서브 기준: 서버 점수를 왼쪽에 표시
          const isP2Server = h.serverSide === 'player2';
          const leftScore = !isMeta && h.scoreAfter ? `${isP2Server ? h.scoreAfter.player2 : h.scoreAfter.player1}` : '';
          const rightScore = !isMeta && h.scoreAfter ? `${isP2Server ? h.scoreAfter.player1 : h.scoreAfter.player2}` : '';
          const p1s = leftScore;
          const p2s = rightScore;
          const isServeEvent = (h.actionType as string) === 'serve';
          const displayAction = isMeta ? (h.actionLabel ? escHtml(h.actionLabel) : action) : `${displayName} ${action}`;
          return `<tr${isMeta ? ' style="background:#f9f9f9;color:#666"' : ''}${isServeEvent ? ' style="background:#e8f4fd;font-weight:bold"' : ''}>
            <td>${time}</td>
            <td>${displayAction}</td>
            <td>${pts}</td>
            <td>${p1s}</td>
            <td>${p2s}</td>
          </tr>`;
        }).join('');

        // 세트 첫 서버 결정
        const firstEntry = sorted.find(h => h.serverSide);
        const setFirstServer = firstEntry?.serverSide || 'player1';
        const serverName = setFirstServer === 'player1' ? p1 : p2;
        const receiverName = setFirstServer === 'player1' ? p2 : p1;

        return `<h3>${escHtml(t('common.pdf.setNum'))} ${setNum}</h3>
        <table aria-label="${escHtml(t('common.pdf.playByPlay'))} - ${escHtml(t('common.pdf.setNum'))} ${setNum}">
          <thead><tr>
            <th scope="col">${escHtml(t('common.pdf.time'))}</th>
            <th scope="col">${escHtml(t('common.pdf.action'))}</th>
            <th scope="col">${escHtml(t('common.pdf.pts'))}</th>
            <th scope="col">${serverName}</th>
            <th scope="col">${receiverName}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      }).join('');

    playByPlayHtml = `<section aria-label="${escHtml(t('common.pdf.playByPlay'))}">
      <h2>${escHtml(t('common.pdf.playByPlay'))}</h2>
      ${sections}
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(t('common.pdf.matchScoresheet'))} - ${p1} vs ${p2}</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      @page { margin: 15mm; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif;
      max-width: 800px; margin: 0 auto; padding: 2rem;
      color: #111; background: #fff; line-height: 1.6;
    }
    h1 { font-size: 1.5rem; border-bottom: 3px solid #333; padding-bottom: 0.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.15rem; margin-top: 1.5rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
    h3 { font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #1e3a5f; }
    .actions { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .actions button {
      padding: 0.5rem 1.5rem; border: none; border-radius: 0.25rem;
      cursor: pointer; font-size: 0.9rem; color: #fff;
    }
    .btn-print { background: #333; }
    .btn-print:hover { background: #555; }
    .btn-pdf { background: #1e40af; }
    .btn-pdf:hover { background: #1e3a8a; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0.5rem 0 1rem; }
    dt { font-weight: bold; color: #555; }
    dd { margin: 0; }
    .players {
      display: flex; align-items: center; justify-content: center; gap: 1.5rem;
      background: #f5f5f5; padding: 1rem; border-radius: 0.5rem; margin: 1rem 0;
      font-size: 1.25rem; font-weight: bold;
    }
    .players .vs { color: #999; font-size: 1rem; }
    .coach { font-size: 0.85rem; font-weight: normal; color: #666; }
    .coin-toss { text-align: center; color: #555; font-size: 0.9rem; margin: 0.5rem 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.85rem; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: center; }
    th { background: #f0f0f0; font-weight: bold; }
    .winner { font-weight: bold; color: #16a34a; }
    .final-result {
      background: #16a34a; color: #fff; text-align: center;
      padding: 0.75rem; border-radius: 0.5rem; font-size: 1.1rem; margin: 1rem 0;
    }
    footer { margin-top: 2rem; padding-top: 0.5rem; border-top: 1px solid #ccc; font-size: 0.75rem; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="actions no-print">
    <button class="btn-print" onclick="window.print()" aria-label="${escHtml(t('common.pdf.printButton') || 'Print')}">${escHtml(t('common.pdf.printButton') || 'Print')}</button>
  </div>

  <main>
    <h1>${escHtml(tournament?.name || t('common.pdf.matchScoresheet'))}</h1>
    <p style="color:#666; margin-top:0;">${escHtml(t('common.pdf.matchScoresheet'))}</p>

    ${infoRows.length > 0 ? `<dl>${infoRows.join('')}</dl>` : ''}

    <div class="players" aria-label="${p1} vs ${p2}">
      <div>
        ${p1}
        ${p1Coach ? `<div class="coach">${escHtml(t('common.pdf.coach'))}: ${p1Coach}</div>` : ''}
      </div>
      <span class="vs">vs</span>
      <div>
        ${p2}
        ${p2Coach ? `<div class="coach">${escHtml(t('common.pdf.coach'))}: ${p2Coach}</div>` : ''}
      </div>
    </div>

    ${coinTossHtml}

    <section aria-label="${escHtml(t('common.pdf.setResults'))}">
      <h2>${escHtml(t('common.pdf.setResults'))}</h2>
      <table aria-label="${escHtml(t('common.pdf.setResults'))}">
        <thead><tr>
          <th scope="col">${escHtml(t('common.pdf.setNum'))}</th>
          <th scope="col">${p1}</th>
          <th scope="col">${p2}</th>
          <th scope="col">${escHtml(t('common.pdf.winner'))}</th>
        </tr></thead>
        <tbody>${setRows}</tbody>
      </table>
    </section>

    ${finalHtml}

    ${playByPlayHtml}
  </main>

  <footer>${escHtml(t('common.pdf.generatedAt'))}: ${new Date().toLocaleString()}</footer>
</body>
</html>`;
}
