import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTeamMatchGame, usePlayers, useReferees, useCourts } from '@shared/hooks/useFirebase';
import type { IndividualMatch } from '@shared/types';

export default function TeamMatchScoring() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { game, loading, updateIndividualMatch } = useTeamMatchGame(id || null);
  const { players } = usePlayers();
  const { referees } = useReferees();
  const { courts } = useCourts();

  const [scoringKey, setScoringKey] = useState<string | null>(null);
  const [iScoreP1, setIScoreP1] = useState(0);
  const [iScoreP2, setIScoreP2] = useState(0);

  const getPlayerName = (playerId: string) => players.find(p => p.id === playerId)?.name || '알 수 없음';

  const handleStartScoring = (matchIndex: number, m: IndividualMatch) => {
    setScoringKey(`${matchIndex}`);
    setIScoreP1(m.player1Score);
    setIScoreP2(m.player2Score);
  };

  const handleSaveScore = async (matchIndex: number) => {
    if (!game) return;
    const m = game.matches[matchIndex];
    const winnerId = iScoreP1 > iScoreP2 ? m.player1Id : iScoreP2 > iScoreP1 ? m.player2Id : undefined;
    await updateIndividualMatch(matchIndex, {
      player1Score: iScoreP1,
      player2Score: iScoreP2,
      winnerId,
      status: winnerId ? 'completed' : 'in_progress',
    }, game);
    setScoringKey(null);
  };

  if (loading) {
    return <div className="text-center py-20 text-2xl" role="status">로딩 중...</div>;
  }

  if (!game) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl text-gray-400 mb-4">팀전을 찾을 수 없습니다</p>
        <button onClick={() => navigate('/team-match')} className="btn btn-primary">목록으로</button>
      </div>
    );
  }

  const team1Wins = game.matches.filter(m => m.status === 'completed' && m.winnerId === m.player1Id).length;
  const team2Wins = game.matches.filter(m => m.status === 'completed' && m.winnerId === m.player2Id).length;

  const referee = game.refereeId ? referees.find(r => r.id === game.refereeId) : null;
  const court = game.courtId ? courts.find(c => c.id === game.courtId) : null;

  return (
    <div className="py-6 max-w-4xl mx-auto px-4">
      {/* 헤더 */}
      <div className="flex justify-between items-center mb-6">
        <button onClick={() => navigate('/team-match')} className="btn bg-gray-800" aria-label="뒤로가기">
          ← 뒤로
        </button>
        <div className="text-center">
          <h1 className="text-3xl font-bold">
            <span className="text-primary">{game.team1.name}</span>
            <span className="text-gray-500 mx-3">vs</span>
            <span className="text-secondary">{game.team2.name}</span>
          </h1>
          <div className="text-4xl font-bold text-cyan-400 mt-2">{team1Wins} - {team2Wins}</div>
          <div className="text-gray-400 text-sm mt-1">
            {game.teamMatchSettings.winScore}점제
            {referee && ` · 심판: ${referee.name}`}
            {court && ` · ${court.name}`}
          </div>
        </div>
        <div className="w-20">
          {game.winnerId && (
            <span className="bg-green-600 px-3 py-1 rounded font-bold text-sm">완료</span>
          )}
        </div>
      </div>

      {/* 승리 표시 */}
      {game.winnerId && (
        <div className="card text-center mb-6 bg-green-900/30 border-green-600">
          <div className="text-3xl font-bold text-green-400">
            {game.winnerId === game.team1.id ? game.team1.name : game.team2.name} 승리!
          </div>
        </div>
      )}

      {/* 팀 멤버 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card">
          <h3 className="text-xl font-bold text-primary mb-2">{game.team1.name}</h3>
          <div className="space-y-1">
            {game.team1.memberIds.map(id => (
              <div key={id} className="bg-gray-800 p-2 rounded text-sm">{getPlayerName(id)}</div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="text-xl font-bold text-secondary mb-2">{game.team2.name}</h3>
          <div className="space-y-1">
            {game.team2.memberIds.map(id => (
              <div key={id} className="bg-gray-800 p-2 rounded text-sm">{getPlayerName(id)}</div>
            ))}
          </div>
        </div>
      </div>

      {/* 개별 경기 목록 */}
      <h2 className="text-2xl font-bold mb-4">개별 경기</h2>
      <div className="space-y-2">
        {game.matches.map((m, mIdx) => {
          const key = `${mIdx}`;
          const isScoring = scoringKey === key;

          return (
            <div key={m.id} className="card flex justify-between items-center">
              <span className={`font-bold ${m.status === 'completed' && m.winnerId === m.player1Id ? 'text-primary' : ''}`}>
                {getPlayerName(m.player1Id)}
              </span>

              {isScoring ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={iScoreP1}
                    onChange={e => setIScoreP1(Math.max(0, Number(e.target.value)))}
                    className="input w-16 text-center"
                    aria-label={`${getPlayerName(m.player1Id)} 점수`}
                  />
                  <span className="text-gray-400 text-xl">-</span>
                  <input
                    type="number"
                    min={0}
                    value={iScoreP2}
                    onChange={e => setIScoreP2(Math.max(0, Number(e.target.value)))}
                    className="input w-16 text-center"
                    aria-label={`${getPlayerName(m.player2Id)} 점수`}
                  />
                  <button
                    onClick={() => handleSaveScore(mIdx)}
                    disabled={iScoreP1 === iScoreP2}
                    className="btn btn-success text-sm px-3 py-1"
                  >
                    저장
                  </button>
                  <button onClick={() => setScoringKey(null)} className="btn bg-gray-600 text-sm px-3 py-1">
                    취소
                  </button>
                </div>
              ) : m.status === 'completed' ? (
                <span className="text-2xl font-bold">{m.player1Score} - {m.player2Score}</span>
              ) : (
                <button
                  onClick={() => handleStartScoring(mIdx, m)}
                  disabled={game.status === 'completed'}
                  className="btn bg-gray-600 hover:bg-gray-500 text-sm"
                  aria-label={`${getPlayerName(m.player1Id)} vs ${getPlayerName(m.player2Id)} 점수입력`}
                >
                  점수입력
                </button>
              )}

              <span className={`font-bold ${m.status === 'completed' && m.winnerId === m.player2Id ? 'text-secondary' : ''}`}>
                {getPlayerName(m.player2Id)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
