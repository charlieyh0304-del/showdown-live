import type { Match, ScoreHistoryEntry, SetScore } from '../types';
import type { TFunction } from 'i18next';

// Lazy-loaded font cache
let cachedFontBase64: string | null = null;

async function loadKoreanFont(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;

  // Fetch Noto Sans KR Regular from Google Fonts CDN
  const res = await fetch(
    'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf'
  );
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  cachedFontBase64 = btoa(binary);
  return cachedFontBase64;
}

function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.keys(val).sort((a, b) => Number(a) - Number(b)).map(k => (val as Record<string, T>)[k]);
}

const META_TYPES = new Set([
  'pause', 'resume', 'timeout', 'timeout_player', 'timeout_medical', 'timeout_referee',
  'substitution', 'dead_ball', 'walkover', 'side_change', 'coin_toss', 'warmup_start',
  'match_start', 'player_rotation',
]);

export async function generateMatchPdf(
  match: Match,
  tournament: { name: string; date?: string } | null,
  t: TFunction,
): Promise<void> {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  // Load and register Korean font
  try {
    const fontBase64 = await loadKoreanFont();
    doc.addFileToVFS('NotoSansKR-Regular.otf', fontBase64);
    doc.addFont('NotoSansKR-Regular.otf', 'NotoSansKR', 'normal');
    doc.setFont('NotoSansKR');
  } catch {
    // Fallback to helvetica if font loading fails
    doc.setFont('helvetica');
  }

  const isTeam = match.type === 'team';
  const p1Name = isTeam ? (match.team1Name || 'Team 1') : (match.player1Name || 'Player 1');
  const p2Name = isTeam ? (match.team2Name || 'Team 2') : (match.player2Name || 'Player 2');
  const sets: SetScore[] = toArray(match.sets);
  const history: ScoreHistoryEntry[] = toArray(match.scoreHistory);

  function checkPage(needed: number) {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }

  // === HEADER ===
  doc.setFontSize(16);
  doc.setTextColor(0);
  const title = tournament?.name || t('common.pdf.matchScoresheet');
  doc.text(title, pageW / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(100);
  const subtitle = t('common.pdf.matchScoresheet');
  doc.text(subtitle, pageW / 2, y, { align: 'center' });
  y += 8;

  // === MATCH INFO ===
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  doc.setFontSize(9);
  doc.setTextColor(60);

  const infoLines: [string, string][] = [];
  if (tournament?.date) infoLines.push([t('common.pdf.date'), tournament.date]);
  if (match.scheduledDate) infoLines.push([t('common.pdf.matchDate'), `${match.scheduledDate} ${match.scheduledTime || ''}`]);
  if (match.courtName) infoLines.push([t('common.pdf.court'), match.courtName]);
  if (match.refereeName) infoLines.push([t('common.pdf.referee'), match.refereeName]);
  if (match.assistantRefereeName) infoLines.push([t('common.pdf.assistantReferee'), match.assistantRefereeName]);
  if (match.roundLabel) infoLines.push([t('common.pdf.round'), match.roundLabel]);

  for (const [label, value] of infoLines) {
    doc.setTextColor(100);
    doc.text(`${label}:`, margin, y);
    doc.setTextColor(0);
    doc.text(value.trim(), margin + 30, y);
    y += 5;
  }
  y += 3;

  // === PLAYERS ===
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y, contentW, 12, 'F');
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(p1Name, margin + contentW * 0.25, y + 8, { align: 'center' });
  doc.setTextColor(150);
  doc.text('vs', pageW / 2, y + 8, { align: 'center' });
  doc.setTextColor(0);
  doc.text(p2Name, margin + contentW * 0.75, y + 8, { align: 'center' });
  y += 14;

  // Coaches
  const p1Coach = match.player1Coach;
  const p2Coach = match.player2Coach;
  if (p1Coach || p2Coach) {
    doc.setFontSize(8);
    doc.setTextColor(100);
    if (p1Coach) doc.text(`${t('common.pdf.coach')}: ${p1Coach}`, margin + contentW * 0.25, y, { align: 'center' });
    if (p2Coach) doc.text(`${t('common.pdf.coach')}: ${p2Coach}`, margin + contentW * 0.75, y, { align: 'center' });
    y += 5;
  }

  // Coin toss
  if (match.coinTossWinner) {
    doc.setFontSize(8);
    doc.setTextColor(100);
    const tossWinner = match.coinTossWinner === 'player1' ? p1Name : p2Name;
    const tossChoice = match.coinTossChoice === 'serve' ? t('common.pdf.serve') : t('common.pdf.receive');
    doc.text(`${t('common.pdf.coinToss')}: ${tossWinner} - ${tossChoice}`, pageW / 2, y, { align: 'center' });
    y += 6;
  }

  y += 2;

  // === SET RESULTS TABLE ===
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text(t('common.pdf.setResults'), margin, y);
  y += 5;

  // Table header
  const colW = contentW / 4;
  doc.setFillColor(50, 50, 50);
  doc.rect(margin, y, contentW, 7, 'F');
  doc.setTextColor(255);
  doc.setFontSize(8);
  doc.text(t('common.pdf.setNum'), margin + colW * 0.5, y + 5, { align: 'center' });
  doc.text(p1Name, margin + colW * 1.5, y + 5, { align: 'center' });
  doc.text(p2Name, margin + colW * 2.5, y + 5, { align: 'center' });
  doc.text(t('common.pdf.winner'), margin + colW * 3.5, y + 5, { align: 'center' });
  y += 7;

  doc.setTextColor(0);
  sets.forEach((s, i) => {
    checkPage(7);
    const bg = i % 2 === 0 ? 250 : 240;
    doc.setFillColor(bg, bg, bg);
    doc.rect(margin, y, contentW, 6, 'F');
    doc.setFontSize(8);
    doc.text(`${i + 1}`, margin + colW * 0.5, y + 4.5, { align: 'center' });
    doc.text(`${s.player1Score}`, margin + colW * 1.5, y + 4.5, { align: 'center' });
    doc.text(`${s.player2Score}`, margin + colW * 2.5, y + 4.5, { align: 'center' });
    const winner = s.winnerId
      ? (s.player1Score > s.player2Score ? p1Name : p2Name)
      : '-';
    doc.text(winner, margin + colW * 3.5, y + 4.5, { align: 'center' });
    y += 6;
  });

  // Border around table
  doc.setDrawColor(200);
  doc.rect(margin, y - sets.length * 6 - 7, contentW, sets.length * 6 + 7);

  y += 4;

  // === FINAL RESULT ===
  if (match.winnerId) {
    checkPage(15);
    const winnerName = match.winnerId === (isTeam ? match.team1Id : match.player1Id) ? p1Name : p2Name;

    let p1SetWins = 0, p2SetWins = 0;
    sets.forEach(s => {
      if (s.winnerId) {
        if (s.player1Score > s.player2Score) p1SetWins++;
        else p2SetWins++;
      }
    });

    doc.setFillColor(34, 197, 94);
    doc.rect(margin, y, contentW, 10, 'F');
    doc.setTextColor(255);
    doc.setFontSize(11);
    doc.text(`${t('common.pdf.finalResult')}: ${winnerName}  (${p1SetWins} - ${p2SetWins})`, pageW / 2, y + 7, { align: 'center' });
    y += 14;
  }

  // === PLAY-BY-PLAY ===
  const meaningful = history.filter(h =>
    h.points > 0 || h.penaltyWarning || META_TYPES.has(h.actionType || '')
  );

  if (meaningful.length > 0) {
    checkPage(15);
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.text(t('common.pdf.playByPlay'), margin, y);
    y += 5;

    // Group by set
    const setGroups = new Map<number, ScoreHistoryEntry[]>();
    meaningful.forEach(h => {
      const s = h.set || 1;
      if (!setGroups.has(s)) setGroups.set(s, []);
      setGroups.get(s)!.push(h);
    });

    const cols = [15, 50, 15, 20, 20]; // time, action, pts, p1score, p2score
    const totalColW = cols.reduce((a, b) => a + b, 0);
    const scale = contentW / totalColW;
    const scaledCols = cols.map(c => c * scale);

    for (const [setNum, entries] of Array.from(setGroups.entries()).sort((a, b) => a[0] - b[0])) {
      checkPage(15);

      // Set header
      doc.setFillColor(30, 58, 95);
      doc.rect(margin, y, contentW, 6, 'F');
      doc.setTextColor(255);
      doc.setFontSize(8);
      doc.text(`${t('common.pdf.setNum')} ${setNum}`, margin + 3, y + 4.5);
      y += 6;

      // Column headers
      doc.setFillColor(70, 70, 70);
      doc.rect(margin, y, contentW, 5.5, 'F');
      doc.setTextColor(230);
      doc.setFontSize(7);
      let cx = margin;
      const headers = [t('common.pdf.time'), t('common.pdf.action'), t('common.pdf.pts'), p1Name, p2Name];
      headers.forEach((h, i) => {
        doc.text(h, cx + scaledCols[i] / 2, y + 4, { align: 'center', maxWidth: scaledCols[i] - 2 });
        cx += scaledCols[i];
      });
      y += 5.5;

      // Entries (oldest first for play-by-play)
      const sorted = [...entries].reverse();
      sorted.forEach((h, i) => {
        checkPage(5.5);
        const bg = i % 2 === 0 ? 252 : 244;
        doc.setFillColor(bg, bg, bg);
        doc.rect(margin, y, contentW, 5, 'F');
        doc.setTextColor(0);
        doc.setFontSize(6.5);

        cx = margin;
        const time = h.time || '';
        const action = h.actionLabel || h.actionType || '';
        const pts = h.points ? (h.points > 0 ? `+${h.points}` : `${h.points}`) : '';
        const p1s = h.scoreAfter ? `${h.scoreAfter.player1}` : '';
        const p2s = h.scoreAfter ? `${h.scoreAfter.player2}` : '';

        const vals = [time, action, pts, p1s, p2s];
        vals.forEach((v, vi) => {
          doc.text(v, cx + scaledCols[vi] / 2, y + 3.5, { align: 'center', maxWidth: scaledCols[vi] - 2 });
          cx += scaledCols[vi];
        });
        y += 5;
      });

      y += 3;
    }
  }

  // === FOOTER ===
  checkPage(10);
  y += 5;
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 4;
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(`${t('common.pdf.generatedAt')}: ${new Date().toLocaleString()}`, pageW / 2, y, { align: 'center' });

  // Download
  const filename = `${p1Name}_vs_${p2Name}_${match.scheduledDate || 'match'}.pdf`;
  doc.save(filename.replace(/[/\\?%*:|"<>]/g, '_'));
}
