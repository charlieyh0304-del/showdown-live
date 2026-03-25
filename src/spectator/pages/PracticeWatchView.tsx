import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PracticeMatch, SetScore } from '@shared/types';
import { countSetWins } from '@shared/utils/scoring';
import { formatDateTime } from '@shared/utils/locale';
import { useAuth } from '@shared/hooks/useAuth';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';

const LIVE_KEY = 'showdown_practice_live';
const COMPLETED_KEY = 'showdown_practice_completed';

export default function PracticeWatchView() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [liveMatches, setLiveMatches] = useState<PracticeMatch[]>([]);
  const [completedMatches, setCompletedMatches] = useState<PracticeMatch[]>([]);
  const [tab, setTab] = useState<'live' | 'completed'>('live');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleDeleteMatch = (matchId: string) => {
    if (!isAdmin) return;
    const updated = completedMatches.filter(m => m.id !== matchId);
    setCompletedMatches(updated);
    localStorage.setItem(COMPLETED_KEY, JSON.stringify(updated));
  };

  const handleDeleteAll = () => {
    if (!isAdmin) return;
    localStorage.removeItem(COMPLETED_KEY);
    setCompletedMatches([]);
  };

  useEffect(() => {
    document.title = t('spectator.practiceWatch.pageTitle');
  }, [t]);

  useEffect(() => {
    const load = () => {
      try {
        const live = JSON.parse(localStorage.getItem(LIVE_KEY) || '[]') as PracticeMatch[];
        setLiveMatches(live.filter(m => m.status === 'in_progress'));
      } catch { setLiveMatches([]); }
      try {
        const done = JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]') as PracticeMatch[];
        setCompletedMatches(done);
      } catch { setCompletedMatches([]); }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  const renderScore = (match: PracticeMatch) => {
    const safeSets = Array.isArray(match.sets) ? match.sets : [];
    const currentSet = safeSets[match.currentSet] || safeSets[safeSets.length - 1];
    return (
      <div className="flex items-center justify-center gap-6" aria-live="polite" aria-atomic="true" aria-label={t('spectator.liveMatch.scoreAriaLabel', { p1: match.player1Name, p1Score: currentSet?.player1Score ?? 0, p2: match.player2Name, p2Score: currentSet?.player2Score ?? 0 })}>
        <div className="text-center">
          <div className="text-lg font-bold text-yellow-400">{match.player1Name}</div>
          <div className="text-yellow-400" style={{ fontSize: '3.5rem', fontWeight: 'bold' }}>
            {currentSet?.player1Score ?? 0}
          </div>
        </div>
        <div className="text-2xl text-gray-300 font-bold" aria-hidden="true">vs</div>
        <div className="text-center">
          <div className="text-lg font-bold text-cyan-400">{match.player2Name}</div>
          <div className="text-cyan-400" style={{ fontSize: '3.5rem', fontWeight: 'bold' }}>
            {currentSet?.player2Score ?? 0}
          </div>
        </div>
      </div>
    );
  };

  const renderSets = (sets: SetScore[], currentSetIdx: number) => {
    if (sets.length <= 1) return null;
    return (
      <div className="flex justify-center gap-4 mt-2">
        {sets.map((s, i) => (
          <div key={i} className={`text-center px-2 py-1 rounded ${i === currentSetIdx ? 'bg-gray-700' : ''}`}>
            <div className="text-xs text-gray-400">{t('common.matchHistory.setLabel', { num: i + 1 })}</div>
            <div className="text-sm font-bold">
              <span className="text-yellow-400">{s.player1Score}</span>
              <span className="text-gray-400"> - </span>
              <span className="text-cyan-400">{s.player2Score}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-yellow-400">{t('spectator.practiceWatch.title')}</h1>

      <div className="flex gap-2" role="tablist" aria-label={t('spectator.practiceWatch.filterAriaLabel')} onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const tabs: Array<'live' | 'completed'> = ['live', 'completed'];
          const idx = tabs.indexOf(tab);
          const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
          setTab(tabs[next]);
          e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
        }
      }}>
        <button
          role="tab"
          aria-selected={tab === 'live'}
          tabIndex={tab === 'live' ? 0 : -1}
          className={`btn flex-1 ${tab === 'live' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('live')}
        >
          {t('spectator.practiceWatch.liveTab')} ({liveMatches.length})
        </button>
        <button
          role="tab"
          aria-selected={tab === 'completed'}
          tabIndex={tab === 'completed' ? 0 : -1}
          className={`btn flex-1 ${tab === 'completed' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('completed')}
        >
          {t('spectator.practiceWatch.completedTab')} ({completedMatches.length})
        </button>
      </div>

      {tab === 'live' && (
        <div role="tabpanel" aria-label={t('spectator.practiceWatch.livePanel')}>
          {liveMatches.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-xl text-gray-300" role="status">{t('spectator.practiceWatch.noLiveMatches')}</p>
              <p className="text-sm text-gray-300 mt-2">{t('spectator.practiceWatch.noLiveHint')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {liveMatches.map(match => (
                <div key={match.id} className="card p-6">
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ backgroundColor: '#16a34a', color: '#fff', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                      {t('spectator.practiceWatch.liveTag')}
                    </span>
                    <span className="text-sm text-gray-300">{match.type === 'individual' ? t('spectator.practiceWatch.individualMatch') : t('spectator.practiceWatch.teamMatch')}</span>
                  </div>
                  {renderScore(match)}
                  {renderSets(match.sets, match.currentSet)}
                  {match.currentServe && (
                    <div className="text-center text-sm text-blue-300 mt-2" role="status">
                      <span aria-hidden="true">{'🎾 '}</span>{match.currentServe === 'player1' ? match.player1Name : match.player2Name} {t('spectator.practiceWatch.serve')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'completed' && (
        <div role="tabpanel" aria-label={t('spectator.practiceWatch.completedPanel')}>
          {completedMatches.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-xl text-gray-300" role="status">{t('spectator.practiceWatch.noCompletedMatches')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {completedMatches.map(match => {
                const isExpanded = expandedId === match.id;
                const safeSets = Array.isArray(match.sets) ? match.sets : [];
                const winnerName = match.winnerId === 'player1' ? match.player1Name : match.player2Name;
                const setWins = countSetWins(safeSets, match.gameConfig);
                const completedDate = match.completedAt ? formatDateTime(new Date(match.completedAt)) : '';
                return (
                  <div key={match.id} className="card">
                    {isAdmin && (
                      <div className="flex justify-end px-3 pt-2">
                        <button
                          className="btn bg-red-900 hover:bg-red-800 text-red-300 text-xs px-2 py-1"
                          onClick={(e) => { e.stopPropagation(); handleDeleteMatch(match.id); }}
                          aria-label={t('spectator.practiceWatch.deleteMatch', { p1: match.player1Name, p2: match.player2Name })}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    )}
                    <button
                      className="w-full text-left p-4"
                      onClick={() => setExpandedId(isExpanded ? null : match.id)}
                      aria-expanded={isExpanded}
                      aria-label={t('spectator.practiceWatch.expandAriaLabel', { p1: match.player1Name, p2: match.player2Name, state: isExpanded ? t('spectator.practiceWatch.collapse') : t('spectator.practiceWatch.expand') })}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-green-400 font-bold">{t('spectator.practiceWatch.winner', { name: winnerName })}</span>
                        <span className="text-sm text-gray-300">{match.type === 'individual' ? t('spectator.practiceWatch.individualMatch') : t('spectator.practiceWatch.teamMatch')}</span>
                      </div>
                      <div className="flex items-center justify-center gap-4 text-lg">
                        <span className="text-yellow-400 font-bold">{match.player1Name}</span>
                        {match.type === 'individual' ? (
                          <span className="font-bold">{setWins.player1} - {setWins.player2}</span>
                        ) : (
                          <span className="font-bold">{safeSets[0]?.player1Score ?? 0} - {safeSets[0]?.player2Score ?? 0}</span>
                        )}
                        <span className="text-cyan-400 font-bold">{match.player2Name}</span>
                      </div>
                      {completedDate && <p className="text-xs text-gray-300 text-center mt-1">{completedDate}</p>}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-700 p-4 space-y-3">
                        {/* 세트 상세 */}
                        {safeSets.map((s: SetScore, i: number) => (
                          <div key={i} className="flex justify-between bg-gray-800 rounded p-2 text-sm">
                            <span>{t('common.matchHistory.setLabel', { num: i + 1 })}</span>
                            <span className="font-bold">
                              <span className="text-yellow-400">{s.player1Score}</span> - <span className="text-cyan-400">{s.player2Score}</span>
                            </span>
                          </div>
                        ))}
                        {/* 히스토리 */}
                        {Array.isArray(match.scoreHistory) && match.scoreHistory.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-gray-400 mb-2">{t('spectator.practiceWatch.historyTitle')} ({match.scoreHistory.length})</h4>
                            <div className="max-h-60 overflow-y-auto">
                              <ScoreHistoryView history={match.scoreHistory} sets={safeSets} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {isAdmin && (
                <button
                  className="btn btn-danger w-full text-sm"
                  onClick={handleDeleteAll}
                >
                  {t('spectator.practiceWatch.deleteCompleted')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <button className="btn btn-secondary w-full" onClick={() => navigate('/spectator')} aria-label={t('spectator.practiceWatch.backToTournaments')}>
        {t('spectator.practiceWatch.backToTournaments')}
      </button>
    </div>
  );
}
