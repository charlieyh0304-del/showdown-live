import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';

export default function PracticeHistory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sessions, clearHistory, getStats } = usePracticeHistory();
  const stats = getStats();

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return t('referee.practice.history.minutesSeconds', { minutes: m, seconds: s });
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>{t('referee.practice.history.title')}</h1>

      <div className="card text-center">
        <p className="text-2xl font-bold text-white">{t('referee.practice.history.totalSessions', { count: stats.totalSessions })}</p>
        {stats.avgAccuracy > 0 && (
          <p className="text-lg text-gray-300 mt-2">
            {t('referee.practice.history.avgAccuracy')}: <span className="text-green-400 font-bold">{stats.avgAccuracy}%</span>
            {stats.improvement !== 0 && (
              <span className={stats.improvement > 0 ? 'text-green-400' : 'text-red-400'} aria-label={`${stats.improvement > 0 ? t('referee.practice.history.improvement') : t('referee.practice.history.decline')} ${Math.abs(stats.improvement)}%`}>
                {' '}({stats.improvement > 0 ? '↑+' : '↓'}{stats.improvement}%)
              </span>
            )}
          </p>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-center text-gray-400 text-xl">{t('referee.practice.history.noHistory')}</p>
      ) : (
        <div className="space-y-3" role="list" aria-label={t('referee.practice.history.listAriaLabel')}>
          {sessions.map(session => (
            <div key={session.id} className="card" role="listitem">
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-400 text-sm">{formatDate(session.date)}</span>
                <span className="text-sm" style={{
                  backgroundColor: session.sessionType === 'scenario' ? '#1e3a5f' : '#1a1a2e',
                  color: session.sessionType === 'scenario' ? '#60a5fa' : '#9ca3af',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                }}>
                  {session.sessionType === 'scenario' ? t('referee.practice.history.scenario') : t('referee.practice.history.freePlay')}
                </span>
              </div>
              <p className="text-lg text-white font-bold">
                {session.scenarioName || (session.matchType === 'individual' ? t('referee.practice.history.individualPractice') : t('referee.practice.history.teamPractice'))}
              </p>
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-400">
                {session.accuracy !== undefined && (
                  <span>{t('referee.practice.history.accuracy')}: <span className="text-green-400 font-bold">{session.accuracy}%</span></span>
                )}
                <span>{t('referee.practice.history.duration')}: {formatDuration(session.duration)}</span>
                <span>{t('referee.practice.history.finalScore')}: {session.finalScore}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        <button className="btn btn-accent flex-1" onClick={() => navigate('/referee/practice')} aria-label={t('common.back')}>{t('common.back')}</button>
        {sessions.length > 0 && (
          <button className="btn btn-danger flex-1" onClick={() => { clearHistory(); localStorage.removeItem('showdown_practice_completed'); }} aria-label={t('referee.practice.history.deleteAllAriaLabel')}>{t('referee.practice.history.deleteAll')}</button>
        )}
      </div>
    </div>
  );
}
