import { useTranslation } from 'react-i18next';
import type { Match } from '../types';

interface Props {
  match: Match;
  tournament?: { name: string; date?: string } | null;
  className?: string;
}

export default function PdfDownloadButton({ match, tournament, className }: Props) {
  const { t } = useTranslation();

  if (match.status !== 'completed') return null;

  const isTeam = match.type === 'team';
  const p1 = isTeam ? (match.team1Name || 'Team 1') : (match.player1Name || 'Player 1');
  const p2 = isTeam ? (match.team2Name || 'Team 2') : (match.player2Name || 'Player 2');
  const ariaLabel = `${t('common.pdf.download')} - ${p1} vs ${p2}`;

  const handleDownload = async () => {
    const { generateMatchHtml } = await import('../utils/matchPdf');
    const html = generateMatchHtml(match, tournament || null, t);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    } else {
      // Safari popup blocked - use download link as fallback
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scoresheet.html';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <button
      className={className || 'btn btn-secondary text-sm'}
      onClick={handleDownload}
      aria-label={ariaLabel}
    >
      {t('common.pdf.download')}
    </button>
  );
}
