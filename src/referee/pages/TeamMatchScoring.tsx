import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatch } from '@shared/hooks/useFirebase';
import { checkTeamMatchWinner } from '@shared/utils/scoring';
import type { IndividualMatch } from '@shared/types';

interface EditingState {
  index: number;
  player1Score: number;
  player2Score: number;
}

export default function TeamMatchScoring() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading, updateMatch } = useMatch(tournamentId ?? null, matchId ?? null);

  const [editing, setEditing] = useState<EditingState | null>(null);

  const handleStartEdit = useCallback((index: number, im: IndividualMatch) => {
    setEditing({
      index,
      player1Score: im.player1Score,
      player2Score: im.player2Score,
    });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditing(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editing || !match?.individualMatches || !match.team1Id || !match.team2Id) return;

    const individualMatches = match.individualMatches.map((im, i) => {
      if (i !== editing.index) return { ...im };
      const winnerId =
        editing.player1Score > editing.player2Score
          ? im.player1Id
          : editing.player2Score > editing.player1Score
            ? im.player2Id
            : undefined;
      return {
        ...im,
        player1Score: editing.player1Score,
        player2Score: editing.player2Score,
        winnerId,
        status: 'completed' as const,
      };
    });

    const teamWinnerId = checkTeamMatchWinner(individualMatches, match.team1Id, match.team2Id);

    if (teamWinnerId) {
      await updateMatch({
        individualMatches,
        winnerId: teamWinnerId,
        status: 'completed',
      });
    } else {
      await updateMatch({ individualMatches });
    }

    setEditing(null);
  }, [editing, match, updateMatch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-2xl text-gray-400 animate-pulse">경기 로딩 중...</p>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-2xl text-red-400">경기를 찾을 수 없습니다.</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>
          목록으로
        </button>
      </div>
    );
  }

  const team1Name = match.team1Name ?? '팀1';
  const team2Name = match.team2Name ?? '팀2';
  const individualMatches = match.individualMatches ?? [];

  const team1Wins = individualMatches.filter(
    im => im.status === 'completed' && im.winnerId === im.player1Id
  ).length;
  const team2Wins = individualMatches.filter(
    im => im.status === 'completed' && im.winnerId === im.player2Id
  ).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            className="btn btn-accent text-sm"
            onClick={() => navigate('/referee/games')}
            aria-label="목록으로"
          >
            ← 목록
          </button>
          <h1 className="text-xl font-bold text-yellow-400">팀전 점수 기록</h1>
          <div />
        </div>
      </div>

      {/* Team score */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-6">
        <div className="flex items-center justify-center gap-8">
          <div className="text-center">
            <div className="text-xl font-bold text-yellow-400">{team1Name}</div>
            <div className="score-display text-yellow-400" aria-label={`${team1Name} 승수 ${team1Wins}`}>
              {team1Wins}
            </div>
          </div>
          <div className="text-3xl text-gray-500 font-bold">vs</div>
          <div className="text-center">
            <div className="text-xl font-bold text-cyan-400">{team2Name}</div>
            <div className="score-display text-cyan-400" aria-label={`${team2Name} 승수 ${team2Wins}`}>
              {team2Wins}
            </div>
          </div>
        </div>

        {match.status === 'completed' && match.winnerId && (
          <div className="mt-4 text-center" aria-live="polite">
            <div className="text-3xl font-bold text-green-400">
              {match.winnerId === match.team1Id ? team1Name : team2Name} 승리!
            </div>
          </div>
        )}
      </div>

      {/* Individual matches */}
      <div className="flex-1 p-4">
        <h2 className="text-lg font-bold text-gray-300 mb-4">
          개별 경기 ({individualMatches.filter(im => im.status === 'completed').length}/{individualMatches.length})
        </h2>

        {individualMatches.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-gray-400">개별 경기가 없습니다.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {individualMatches.map((im, index) => {
              const isEditing = editing?.index === index;
              const p1Name = im.player1Name ?? '선수1';
              const p2Name = im.player2Name ?? '선수2';

              return (
                <div key={im.id} className="card">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-yellow-400 font-bold">{p1Name}</span>
                    <span className="text-gray-500">vs</span>
                    <span className="text-cyan-400 font-bold">{p2Name}</span>
                  </div>

                  {isEditing ? (
                    <div>
                      <div className="flex items-center justify-center gap-4 mb-4">
                        <div className="flex flex-col items-center">
                          <label className="text-sm text-gray-400 mb-1">{p1Name}</label>
                          <input
                            type="number"
                            min={0}
                            value={editing.player1Score}
                            onChange={e =>
                              setEditing(prev =>
                                prev ? { ...prev, player1Score: Math.max(0, parseInt(e.target.value) || 0) } : null
                              )
                            }
                            className="input text-center text-2xl w-24"
                            aria-label={`${p1Name} 점수`}
                          />
                        </div>
                        <span className="text-2xl text-gray-500 mt-6">-</span>
                        <div className="flex flex-col items-center">
                          <label className="text-sm text-gray-400 mb-1">{p2Name}</label>
                          <input
                            type="number"
                            min={0}
                            value={editing.player2Score}
                            onChange={e =>
                              setEditing(prev =>
                                prev ? { ...prev, player2Score: Math.max(0, parseInt(e.target.value) || 0) } : null
                              )
                            }
                            className="input text-center text-2xl w-24"
                            aria-label={`${p2Name} 점수`}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="btn btn-success flex-1"
                          onClick={handleSave}
                          disabled={editing.player1Score === editing.player2Score}
                          aria-label="저장"
                        >
                          저장
                        </button>
                        <button
                          className="btn btn-danger flex-1"
                          onClick={handleCancelEdit}
                          aria-label="취소"
                        >
                          취소
                        </button>
                      </div>
                      {editing.player1Score === editing.player2Score && (
                        <p className="text-sm text-red-400 mt-2 text-center">동점은 허용되지 않습니다.</p>
                      )}
                    </div>
                  ) : im.status === 'completed' ? (
                    <div className="text-center">
                      <div className="text-2xl font-bold">
                        <span className="text-yellow-400">{im.player1Score}</span>
                        <span className="text-gray-500"> - </span>
                        <span className="text-cyan-400">{im.player2Score}</span>
                      </div>
                      <div className="text-sm text-green-400 mt-1">
                        {im.winnerId === im.player1Id ? p1Name : p2Name} 승
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <button
                        className="btn btn-primary btn-large w-full"
                        onClick={() => handleStartEdit(index, im)}
                        disabled={match.status === 'completed'}
                        aria-label={`${p1Name} vs ${p2Name} 점수 입력`}
                      >
                        점수입력
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {match.status === 'completed' && (
        <div className="bg-gray-900 border-t border-gray-700 p-4">
          <button
            className="btn btn-primary btn-large w-full"
            onClick={() => navigate('/referee/games')}
            aria-label="목록으로 돌아가기"
          >
            목록으로
          </button>
        </div>
      )}
    </div>
  );
}
