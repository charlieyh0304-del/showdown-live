import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Match } from '../types';

interface Props {
  match: Match;
  tournament?: { name: string; date?: string } | null;
  className?: string;
}

export default function PdfDownloadButton({ match, tournament, className }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  if (match.status !== 'completed') return null;

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { generateMatchPdf } = await import('../utils/matchPdf');
      await generateMatchPdf(match, tournament || null, t);
    } catch (e) {
      console.error('PDF generation failed:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={className || 'btn btn-secondary text-sm'}
      onClick={handleDownload}
      disabled={loading}
      aria-label={t('common.pdf.download')}
    >
      {loading ? t('common.pdf.generating') : t('common.pdf.download')}
    </button>
  );
}
