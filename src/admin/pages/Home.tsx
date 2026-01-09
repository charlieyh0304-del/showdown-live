import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTournaments, usePlayers } from '@shared/hooks/useFirebase';

export default function Home() {
  const navigate = useNavigate();
  const { tournaments, loading, addTournament, deleteTournament } = useTournaments();
  const { players } = usePlayers();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);

  const handleCreate = async () => {
    if (!newName.trim() || selectedPlayers.length < 2) return;

    const id = await addTournament({
      name: newName.trim(),
      date: newDate,
      status: 'draft',
      playerIds: selectedPlayers,
    });

    setShowCreate(false);
    setNewName('');
    setSelectedPlayers([]);
    if (id) navigate(`/tournament/${id}`);
  };

  const togglePlayer = (playerId: string) => {
    setSelectedPlayers(prev =>
      prev.includes(playerId)
        ? prev.filter(id => id !== playerId)
        : [...prev, playerId]
    );
  };

  if (loading) {
    return <div className="text-center py-20 text-2xl">로딩 중...</div>;
  }

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-primary">대회 관리</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-primary"
        >
          + 새 대회
        </button>
      </div>

      {tournaments.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400 mb-4">등록된 대회가 없습니다</p>
          <button
            onClick={() => setShowCreate(true)}
            className="btn btn-accent"
          >
            첫 대회 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {tournaments.map(tournament => (
            <div
              key={tournament.id}
              className="card flex justify-between items-center"
            >
              <div>
                <h2 className="text-2xl font-bold">{tournament.name}</h2>
                <p className="text-gray-400">
                  {tournament.date} · {tournament.playerIds?.length || 0}명
                </p>
                <span className={`inline-block mt-2 px-3 py-1 rounded text-sm font-bold ${
                  tournament.status === 'completed' ? 'bg-green-600' :
                  tournament.status === 'in_progress' ? 'bg-orange-600' :
                  'bg-gray-600'
                }`}>
                  {tournament.status === 'completed' ? '완료' :
                   tournament.status === 'in_progress' ? '진행중' : '준비'}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/tournament/${tournament.id}`)}
                  className="btn btn-secondary"
                >
                  열기
                </button>
                <button
                  onClick={() => {
                    if (confirm('정말 삭제하시겠습니까?')) {
                      deleteTournament(tournament.id);
                    }
                  }}
                  className="btn btn-danger"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 대회 생성 모달 */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold mb-6 text-primary">새 대회 만들기</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-lg mb-2">대회명</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="input"
                  placeholder="예: 2024 전국 쇼다운 대회"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-lg mb-2">날짜</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={e => setNewDate(e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-lg mb-2">
                  참가 선수 ({selectedPlayers.length}명)
                </label>
                {players.length === 0 ? (
                  <p className="text-gray-400">
                    먼저 선수를 등록해주세요
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                    {players.map(player => (
                      <button
                        key={player.id}
                        onClick={() => togglePlayer(player.id)}
                        className={`p-3 rounded-lg text-left transition-all ${
                          selectedPlayers.includes(player.id)
                            ? 'bg-primary text-black'
                            : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        <div className="font-bold">{player.name}</div>
                        {player.club && (
                          <div className="text-sm opacity-70">{player.club}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowCreate(false)}
                className="btn flex-1 bg-gray-700 hover:bg-gray-600"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || selectedPlayers.length < 2}
                className="btn btn-primary flex-1"
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
