import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRandomTeamLeagues, usePlayers } from '@shared/hooks/useFirebase';
import type { TeamMatchSettings } from '@shared/types';

export default function RandomTeamLeagues() {
  const navigate = useNavigate();
  const { leagues, loading, addLeague, deleteLeague } = useRandomTeamLeagues();
  const { players } = usePlayers();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
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

  const handleCreate = async () => {
    if (!newName.trim() || selectedPlayers.length < 6 || submitting) return;
    setSubmitting(true);

    try {
      const teamMatchSettings: TeamMatchSettings = {
        setsToWin: 1,
        winScore,
        minLead: 2,
      };

      const id = await addLeague({
        name: newName.trim(),
        date: newDate,
        status: 'draft',
        playerIds: selectedPlayers,
        teamMatchSettings,
      });

      setShowCreate(false);
      setNewName('');
      setSelectedPlayers([]);
      setWinScore(11);
      if (id) navigate(`/random-league/${id}`);
    } catch (error) {
      console.error('Failed to create league:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const togglePlayer = (playerId: string) => {
    setSelectedPlayers(prev =>
      prev.includes(playerId)
        ? prev.filter(id => id !== playerId)
        : [...prev, playerId]
    );
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'draft': return '준비';
      case 'team_assignment': return '팀 배정';
      case 'in_progress': return '진행중';
      case 'completed': return '완료';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-600';
      case 'in_progress': return 'bg-orange-600';
      case 'team_assignment': return 'bg-blue-600';
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
          <button onClick={() => navigate('/')} className="btn bg-gray-800" aria-label="홈으로">← 홈</button>
          <h1 className="text-3xl font-bold text-primary">랜덤 팀 리그전</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-primary"
        >
          + 새 리그전
        </button>
      </div>

      {leagues.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400 mb-4">등록된 리그전이 없습니다</p>
          <button
            onClick={() => setShowCreate(true)}
            className="btn btn-accent"
          >
            첫 리그전 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {leagues.map(league => (
            <div
              key={league.id}
              className="card flex justify-between items-center"
            >
              <div>
                <h2 className="text-2xl font-bold">{league.name}</h2>
                <p className="text-gray-400">
                  {league.date} · {league.playerIds?.length || 0}명 · {league.teamMatchSettings?.winScore || 11}점제
                </p>
                <span className={`inline-block mt-2 px-3 py-1 rounded text-sm font-bold ${getStatusColor(league.status)}`}>
                  {getStatusText(league.status)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/random-league/${league.id}`)}
                  className="btn btn-secondary"
                  aria-label={`${league.name} 리그전 열기`}
                >
                  열기
                </button>
                <button
                  onClick={() => {
                    if (confirm('정말 삭제하시겠습니까?')) {
                      deleteLeague(league.id);
                    }
                  }}
                  className="btn btn-danger"
                  aria-label={`${league.name} 리그전 삭제`}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 리그전 생성 모달 */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)} onKeyDown={e => { if (e.key === 'Escape') setShowCreate(false); }}>
          <div
            ref={modalRef}
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-league-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="create-league-title" className="text-2xl font-bold mb-6 text-primary">새 랜덤 팀 리그전</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-lg mb-2">대회명</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="input"
                  placeholder="예: 2024 친선 팀 리그전"
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
                <label className="block text-lg mb-2">승점 (1세트)</label>
                <div className="flex gap-4">
                  {([11, 21, 31] as const).map(score => (
                    <button
                      key={score}
                      onClick={() => setWinScore(score)}
                      aria-pressed={winScore === score}
                      className={`flex-1 p-4 rounded-lg text-center font-bold text-xl transition-all ${
                        winScore === score
                          ? 'bg-primary text-black'
                          : 'bg-gray-800 hover:bg-gray-700'
                      }`}
                    >
                      {score}점
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-lg mb-2">
                  참가 선수 ({selectedPlayers.length}명, 최소 6명 필요)
                </label>
                <p className="text-gray-400 text-sm mb-2">
                  3명씩 팀을 구성합니다. 6의 배수로 선택하는 것을 권장합니다.
                </p>
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
                        aria-pressed={selectedPlayers.includes(player.id)}
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
                disabled={!newName.trim() || selectedPlayers.length < 6 || submitting}
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
