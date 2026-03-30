import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';
import { loadSavedPracticeMatch, clearSavedPracticeMatch } from '../../hooks/usePracticeMatch';
import type { PracticeMatch } from '@shared/types';

export default function PracticeHome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getStats } = usePracticeHistory();
  const stats = getStats();

  // Check for in-progress match
  const [savedMatch, setSavedMatch] = useState<PracticeMatch | null>(null);
  const [completedMatches, setCompletedMatches] = useState<PracticeMatch[]>([]);

  useEffect(() => {
    setSavedMatch(loadSavedPracticeMatch());
    try {
      const stored = localStorage.getItem('showdown_practice_completed');
      setCompletedMatches(stored ? JSON.parse(stored) : []);
    } catch { setCompletedMatches([]); }
  }, []);

  const handleResume = () => {
    navigate('/referee/practice/play?resume=true');
  };

  const handleDiscardSaved = () => {
    if (!confirm(t('referee.practice.home.deleteMatchConfirm'))) return;
    clearSavedPracticeMatch();
    localStorage.removeItem('showdown_practice_live');
    setSavedMatch(null);
  };

  const handleDeleteCompleted = (index: number) => {
    if (!confirm(t('referee.practice.home.deleteMatchConfirm'))) return;
    const updated = completedMatches.filter((_, i) => i !== index);
    setCompletedMatches(updated);
    localStorage.setItem('showdown_practice_completed', JSON.stringify(updated));
  };

  const handleDeleteAllCompleted = () => {
    if (!confirm(t('referee.practice.home.deleteAllConfirm'))) return;
    setCompletedMatches([]);
    localStorage.removeItem('showdown_practice_completed');
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <button
        className="btn btn-accent mb-4"
        onClick={() => navigate('/referee/games')}
        aria-label={t('common.back')}
      >
        ← {t('common.back')}
      </button>

      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>
        {t('referee.practice.home.title')}
      </h1>
      <p className="text-center text-gray-400 text-lg">
        {t('referee.practice.home.description')}
      </p>

      {/* Resume in-progress match */}
      {savedMatch && savedMatch.status === 'in_progress' && (
        <div className="card border-2 border-yellow-500 space-y-3" role="alert">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-yellow-400">{t('referee.practice.home.resumeMatch')}</h2>
              <p className="text-gray-300 text-sm">
                {t('referee.practice.home.resumeDescription', {
                  p1: savedMatch.player1Name,
                  p2: savedMatch.player2Name,
                })}
              </p>
              <p className="text-gray-400 text-xs mt-1">
                {savedMatch.sets?.map((s, i) => `S${i + 1}: ${s.player1Score}-${s.player2Score}`).join(' / ')}
              </p>
            </div>
            <button
              className="btn bg-red-700 hover:bg-red-600 text-white text-sm px-3 py-1"
              onClick={handleDiscardSaved}
              aria-label={t('referee.practice.home.deleteMatch')}
              style={{ minHeight: '44px' }}
            >
              {t('referee.practice.home.deleteMatch')}
            </button>
          </div>
          <button
            className="btn btn-primary w-full text-lg py-4"
            onClick={handleResume}
            aria-label={t('referee.practice.home.resumeAriaLabel')}
          >
            {t('referee.practice.home.resumeMatch')}
          </button>
        </div>
      )}

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

      {/* Completed practice matches */}
      {completedMatches.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-300">{t('referee.practice.home.completedMatches')}</h2>
            <button
              className="btn bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-1"
              onClick={handleDeleteAllCompleted}
              style={{ minHeight: '44px' }}
            >
              {t('referee.practice.home.deleteAll')}
            </button>
          </div>
          {completedMatches.map((m, i) => (
            <div key={m.id || i} className="card flex items-center justify-between py-3 px-4">
              <div>
                <span className="font-bold text-sm">{m.player1Name} vs {m.player2Name}</span>
                <p className="text-gray-400 text-xs">
                  {m.sets?.map((s, si) => `S${si + 1}: ${s.player1Score}-${s.player2Score}`).join(' / ')}
                </p>
              </div>
              <button
                className="btn bg-red-700 hover:bg-red-600 text-white text-xs px-2 py-1"
                onClick={() => handleDeleteCompleted(i)}
                aria-label={`${t('referee.practice.home.deleteMatch')} - ${m.player1Name} vs ${m.player2Name}`}
                style={{ minHeight: '44px' }}
              >
                {t('referee.practice.home.deleteMatch')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
