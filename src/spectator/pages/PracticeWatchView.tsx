import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PracticeMatch } from '@shared/types';

const STORAGE_KEY = 'showdown_practice_live';

export default function PracticeWatchView() {
  const navigate = useNavigate();
  const [practiceMatches, setPracticeMatches] = useState<PracticeMatch[]>([]);

  // localStorage에서 연습 경기 데이터를 주기적으로 읽음
  useEffect(() => {
    const loadMatches = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const matches = JSON.parse(stored) as PracticeMatch[];
          setPracticeMatches(matches.filter(m => m.status === 'in_progress'));
        } else {
          setPracticeMatches([]);
        }
      } catch {
        setPracticeMatches([]);
      }
    };

    loadMatches();
    const interval = setInterval(loadMatches, 2000); // 2초마다 갱신
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-yellow-400">연습 경기 관람</h1>
      <p className="text-gray-400">현재 진행 중인 연습 경기를 관람할 수 있습니다.</p>

      {practiceMatches.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">현재 진행 중인 연습 경기가 없습니다.</p>
          <p className="text-sm text-gray-500 mt-2">심판 모드에서 연습 경기를 시작하면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {practiceMatches.map(match => {
            const safeSets = Array.isArray(match.sets) ? match.sets : [];
            const currentSet = safeSets[match.currentSet];
            return (
              <div key={match.id} className="card p-6">
                <div className="flex items-center justify-between mb-3">
                  <span
                    style={{
                      backgroundColor: '#7c3aed',
                      color: '#fff',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                    }}
                  >
                    연습 경기
                  </span>
                  <span className="text-sm text-gray-400">
                    {match.type === 'individual' ? '개인전' : '팀전'}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-6" aria-live="polite">
                  <div className="text-center">
                    <div className="text-lg font-bold text-yellow-400">{match.player1Name}</div>
                    <div className="score-display text-yellow-400" style={{ fontSize: '4rem' }}>
                      {currentSet?.player1Score ?? 0}
                    </div>
                  </div>
                  <div className="text-2xl text-gray-500 font-bold">vs</div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-cyan-400">{match.player2Name}</div>
                    <div className="score-display text-cyan-400" style={{ fontSize: '4rem' }}>
                      {currentSet?.player2Score ?? 0}
                    </div>
                  </div>
                </div>

                {safeSets.length > 1 && (
                  <div className="flex justify-center gap-4 mt-3">
                    {safeSets.map((s, i) => (
                      <div key={i} className={`text-center px-2 py-1 rounded ${i === match.currentSet ? 'bg-gray-700' : ''}`}>
                        <div className="text-xs text-gray-500">세트 {i + 1}</div>
                        <div className="text-sm font-bold">
                          <span className="text-yellow-400">{s.player1Score}</span>
                          <span className="text-gray-500"> - </span>
                          <span className="text-cyan-400">{s.player2Score}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        className="btn btn-secondary w-full"
        onClick={() => navigate('/spectator')}
        aria-label="대회 목록으로"
      >
        대회 목록으로
      </button>
    </div>
  );
}
