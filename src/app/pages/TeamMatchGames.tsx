import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeamMatchGames, usePlayers, useReferees, useCourts } from '@shared/hooks/useFirebase';
import type { TeamMatchSettings, IndividualMatch, Team } from '@shared/types';

export default function TeamMatchGames() {
  const navigate = useNavigate();
  const { games, loading, addGame, deleteGame } = useTeamMatchGames();
  const { players } = usePlayers();
  const { referees } = useReferees();
  const { courts } = useCourts();

  const [showCreate, setShowCreate] = useState(false);
  const [team1Name, setTeam1Name] = useState('1팀');
  const [team2Name, setTeam2Name] = useState('2팀');
  const [team1Players, setTeam1Players] = useState<string[]>([]);
  const [team2Players, setTeam2Players] = useState<string[]>([]);
  const [refereeId, setRefereeId] = useState('');
  const [courtId, setCourtId] = useState('');
  const [winScore, setWinScore] = useState<11 | 21 | 31>(11);
  const [submitting, setSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCreate) return;
    document.body.style.overflow = 'hidden';
    const el = modalRef.current;
    if (el) {
      const focusable = el.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])');
      if (focusable.length > 0) focusable[0].focus();
    }
    return () => { document.body.style.overflow = ''; };
  }, [showCreate]);

  const toggleTeamPlayer = (teamSetter: React.Dispatch<React.SetStateAction<string[]>>, playerId: string) => {
    teamSetter(prev =>
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  };

  const handleCreate = async () => {
    if (team1Players.length < 2 || team2Players.length < 2 || submitting) return;
    setSubmitting(true);

    try {
      const team1: Team = { id: 'team-1', name: team1Name || '1팀', memberIds: team1Players };
      const team2: Team = { id: 'team-2', name: team2Name || '2팀', memberIds: team2Players };

      // NxN 개별 경기 생성
      const matches: IndividualMatch[] = [];
      let matchIndex = 0;
      for (const p1 of team1.memberIds) {
        for (const p2 of team2.memberIds) {
          matches.push({
            id: `match-${matchIndex++}`,
            player1Id: p1,
            player2Id: p2,
            player1Score: 0,
            player2Score: 0,
            status: 'pending',
          });
        }
      }

      const teamMatchSettings: TeamMatchSettings = { setsToWin: 1, winScore, minLead: 2 };

      const id = await addGame({
        team1,
        team2,
        matches,
        status: 'pending',
        refereeId: refereeId || undefined,
        courtId: courtId || undefined,
        teamMatchSettings,
        createdAt: Date.now(),
      });

      setShowCreate(false);
      resetForm();
      if (id) navigate(`/team-match/${id}`);
    } catch (error) {
      console.error('Failed to create team match:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTeam1Name('1팀');
    setTeam2Name('2팀');
    setTeam1Players([]);
    setTeam2Players([]);
    setRefereeId('');
    setCourtId('');
    setWinScore(11);
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '대기';
      case 'in_progress': return '진행중';
      case 'completed': return '완료';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-600';
      case 'in_progress': return 'bg-orange-600';
      default: return 'bg-gray-600';
    }
  };

  if (loading) {
    return <div className="text-center py-20 text-2xl" role="status" aria-live="polite">로딩 중...</div>;
  }

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="btn bg-gray-800" aria-label="홈으로">
            ← 홈
          </button>
          <h1 className="text-3xl font-bold text-secondary">팀전</h1>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">
          + 새 팀전
        </button>
      </div>

      {games.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400 mb-4">등록된 팀전이 없습니다</p>
          <button onClick={() => setShowCreate(true)} className="btn btn-accent">
            첫 팀전 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {games.map(game => {
            const team1Wins = game.matches.filter(m => m.status === 'completed' && m.winnerId === m.player1Id).length;
            const team2Wins = game.matches.filter(m => m.status === 'completed' && m.winnerId === m.player2Id).length;

            return (
              <div key={game.id} className="card flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">
                    {game.team1.name} vs {game.team2.name}
                  </h2>
                  <p className="text-lg text-cyan-400 font-bold">{team1Wins} - {team2Wins}</p>
                  <p className="text-gray-400">{game.teamMatchSettings.winScore}점제</p>
                  {game.winnerId && (
                    <p className="text-green-400 font-bold">
                      {game.winnerId === game.team1.id ? game.team1.name : game.team2.name} 승리
                    </p>
                  )}
                  <span className={`inline-block mt-2 px-3 py-1 rounded text-sm font-bold ${getStatusColor(game.status)}`}>
                    {getStatusText(game.status)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate(`/team-match/${game.id}`)}
                    className="btn btn-secondary"
                  >
                    {game.status === 'completed' ? '보기' : '점수 기록'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('이 팀전을 삭제하시겠습니까?')) deleteGame(game.id);
                    }}
                    className="btn btn-danger"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 팀전 생성 모달 */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)} onKeyDown={e => { if (e.key === 'Escape') setShowCreate(false); }}>
          <div
            ref={modalRef}
            className="modal-content max-w-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-team-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="create-team-title" className="text-2xl font-bold mb-6 text-secondary">새 팀전</h2>

            <div className="space-y-4">
              {/* 팀 1 */}
              <div>
                <label className="block text-lg mb-2">팀 1 이름</label>
                <input type="text" value={team1Name} onChange={e => setTeam1Name(e.target.value)} className="input" placeholder="1팀" />
              </div>
              <div>
                <label className="block text-lg mb-2">팀 1 선수 ({team1Players.length}명, 최소 2명)</label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {players.filter(p => !team2Players.includes(p.id)).map(p => (
                    <button
                      key={p.id}
                      onClick={() => toggleTeamPlayer(setTeam1Players, p.id)}
                      aria-pressed={team1Players.includes(p.id)}
                      className={`p-2 rounded text-left text-sm transition-all ${
                        team1Players.includes(p.id) ? 'bg-primary text-black' : 'bg-gray-800 hover:bg-gray-700'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 팀 2 */}
              <div>
                <label className="block text-lg mb-2">팀 2 이름</label>
                <input type="text" value={team2Name} onChange={e => setTeam2Name(e.target.value)} className="input" placeholder="2팀" />
              </div>
              <div>
                <label className="block text-lg mb-2">팀 2 선수 ({team2Players.length}명, 최소 2명)</label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {players.filter(p => !team1Players.includes(p.id)).map(p => (
                    <button
                      key={p.id}
                      onClick={() => toggleTeamPlayer(setTeam2Players, p.id)}
                      aria-pressed={team2Players.includes(p.id)}
                      className={`p-2 rounded text-left text-sm transition-all ${
                        team2Players.includes(p.id) ? 'bg-secondary text-black' : 'bg-gray-800 hover:bg-gray-700'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 승점 */}
              <div>
                <label className="block text-lg mb-2">승점</label>
                <div className="flex gap-4">
                  {([11, 21, 31] as const).map(score => (
                    <button
                      key={score}
                      onClick={() => setWinScore(score)}
                      aria-pressed={winScore === score}
                      className={`flex-1 p-3 rounded-lg text-center font-bold transition-all ${
                        winScore === score ? 'bg-primary text-black' : 'bg-gray-800 hover:bg-gray-700'
                      }`}
                    >
                      {score}점
                    </button>
                  ))}
                </div>
              </div>

              {/* 심판 */}
              <div>
                <label className="block text-lg mb-2">심판</label>
                <select value={refereeId} onChange={e => setRefereeId(e.target.value)} className="input">
                  <option value="">선택 안함</option>
                  {referees.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* 경기장 */}
              <div>
                <label className="block text-lg mb-2">경기장</label>
                <select value={courtId} onChange={e => setCourtId(e.target.value)} className="input">
                  <option value="">선택 안함</option>
                  {courts.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button onClick={() => { setShowCreate(false); resetForm(); }} className="btn flex-1 bg-gray-700 hover:bg-gray-600">
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={team1Players.length < 2 || team2Players.length < 2 || submitting}
                className="btn btn-primary flex-1"
              >
                {submitting ? '생성 중...' : '생성'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
