import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';

export default function PracticeHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getStats } = usePracticeHistory();
  const stats = getStats();

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>
        {t('referee.practice.home.title')}
      </h1>
      <p className="text-center text-gray-400 text-lg">
        {t('referee.practice.home.description')}
      </p>

      {stats.totalSessions > 0 && (
        <div className="card text-center">
          <p className="text-gray-400">
            {t('referee.practice.home.totalSessions', { count: stats.totalSessions })}
          </p>
        </div>
      )}

      <div className="grid gap-4">
        <button
          className="card hover:bg-gray-800 transition-colors text-left p-6 border-2 border-transparent hover:border-gray-600"
          style={{ borderLeftColor: '#22c55e', borderLeftWidth: '8px' }}
          onClick={() => navigate('/referee/practice/setup')}
          aria-label={t('referee.practice.home.startAriaLabel')}
        >
          <h2 className="text-2xl font-bold" style={{ color: '#22c55e' }}>{t('referee.practice.home.startPractice')}</h2>
          <p className="text-gray-400 mt-1">{t('referee.practice.home.startDescription')}</p>
        </button>
        <button
          className="card hover:bg-gray-800 transition-colors text-left p-6 border-2 border-transparent hover:border-gray-600"
          style={{ borderLeftColor: '#f59e0b', borderLeftWidth: '8px' }}
          onClick={() => navigate('/referee/practice/history')}
          aria-label={t('referee.practice.home.historyAriaLabel')}
        >
          <h2 className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{t('referee.practice.home.history')}</h2>
          <p className="text-gray-400 mt-1">{t('referee.practice.home.historyDescription')}</p>
        </button>
      </div>
    </div>
  );
}
