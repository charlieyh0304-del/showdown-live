import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PracticeMatch, SetScore } from '@shared/types';
import { countSetWins } from '@shared/utils/scoring';
import SetGroupedHistory from '@referee/components/SetGroupedHistory';

const LIVE_KEY = 'showdown_practice_live';
const COMPLETED_KEY = 'showdown_practice_completed';

export default function PracticeWatchView() {
  const navigate = useNavigate();
  const [liveMatches, setLiveMatches] = useState<PracticeMatch[]>([]);
  const [completedMatches, setCompletedMatches] = useState<PracticeMatch[]>([]);
  const [tab, setTab] = useState<'live' | 'completed'>('live');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    document.title = '연습 경기 관람 - 쇼다운';
  }, []);

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
      <div className="flex items-center justify-center gap-6" aria-live="polite" aria-atomic="true" aria-label={`${match.player1Name} ${currentSet?.player1Score ?? 0}점 대 ${match.player2Name} ${currentSet?.player2Score ?? 0}점`}>
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
            <div className="text-xs text-gray-400">세트 {i + 1}</div>
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
      <h1 className="text-3xl font-bold text-yellow-400">연습 경기 관람</h1>

      <div className="flex gap-2" role="tablist" aria-label="연습 경기 필터" onKeyDown={e => {
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
          진행중 ({liveMatches.length})
        </button>
        <button
          role="tab"
          aria-selected={tab === 'completed'}
          tabIndex={tab === 'completed' ? 0 : -1}
          className={`btn flex-1 ${tab === 'completed' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('completed')}
        >
          완료 ({completedMatches.length})
        </button>
      </div>

      {tab === 'live' && (
        <div role="tabpanel" aria-label="진행중 경기">
          {liveMatches.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-xl text-gray-300" role="status">진행 중인 연습 경기가 없습니다</p>
              <p className="text-sm text-gray-300 mt-2">심판 모드에서 연습 경기를 시작하면 여기에 표시됩니다</p>
            </div>
          ) : (
            <div className="space-y-4">
              {liveMatches.map(match => (
                <div key={match.id} className="card p-6">
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ backgroundColor: '#16a34a', color: '#fff', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                      실시간
                    </span>
                    <span className="text-sm text-gray-300">{match.type === 'individual' ? '개인전' : '팀전'}</span>
                  </div>
                  {renderScore(match)}
                  {renderSets(match.sets, match.currentSet)}
                  {match.currentServe && (
                    <div className="text-center text-sm text-blue-300 mt-2" role="status">
                      <span aria-hidden="true">{'🎾 '}</span>{match.currentServe === 'player1' ? match.player1Name : match.player2Name} 서브
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'completed' && (
        <div role="tabpanel" aria-label="완료된 경기">
          {completedMatches.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-xl text-gray-300" role="status">완료된 연습 경기가 없습니다</p>
            </div>
          ) : (
            <div className="space-y-4">
              {completedMatches.map(match => {
                const isExpanded = expandedId === match.id;
                const safeSets = Array.isArray(match.sets) ? match.sets : [];
                const winnerName = match.winnerId === 'player1' ? match.player1Name : match.player2Name;
                const setWins = countSetWins(safeSets, match.gameConfig);
                const completedDate = match.completedAt ? new Date(match.completedAt).toLocaleString('ko-KR') : '';
                return (
                  <div key={match.id} className="card">
                    <button
                      className="w-full text-left p-4"
                      onClick={() => setExpandedId(isExpanded ? null : match.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${match.player1Name} vs ${match.player2Name} 경기 결과 ${isExpanded ? '접기' : '펼치기'}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-green-400 font-bold">{winnerName} 승리</span>
                        <span className="text-sm text-gray-300">{match.type === 'individual' ? '개인전' : '팀전'}</span>
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
                            <span>세트 {i + 1}</span>
                            <span className="font-bold">
                              <span className="text-yellow-400">{s.player1Score}</span> - <span className="text-cyan-400">{s.player2Score}</span>
                            </span>
                          </div>
                        ))}
                        {/* 히스토리 */}
                        {Array.isArray(match.scoreHistory) && match.scoreHistory.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-gray-400 mb-2">경기 기록 ({match.scoreHistory.length})</h4>
                            <div className="max-h-60 overflow-y-auto">
                              <SetGroupedHistory history={match.scoreHistory} sets={safeSets} showAll />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                className="btn btn-secondary w-full text-sm"
                onClick={() => { localStorage.removeItem(COMPLETED_KEY); setCompletedMatches([]); }}
              >
                완료 기록 전체 삭제
              </button>
            </div>
          )}
        </div>
      )}

      <button className="btn btn-secondary w-full" onClick={() => navigate('/spectator')} aria-label="대회 목록으로">
        대회 목록으로
      </button>
    </div>
  );
}
