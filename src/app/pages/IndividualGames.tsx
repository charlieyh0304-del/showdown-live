import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIndividualGames, usePlayers, useReferees, useCourts } from '@shared/hooks/useFirebase';
import { createEmptySet } from '@shared/types';
import type { GameConfig } from '@shared/types';

export default function IndividualGames() {
  const navigate = useNavigate();
  const { games, loading, addGame, deleteGame } = useIndividualGames();
  const { players } = usePlayers();
  const { referees } = useReferees();
  const { courts } = useCourts();

  const [showCreate, setShowCreate] = useState(false);
  const [player1Id, setPlayer1Id] = useState('');
  const [player2Id, setPlayer2Id] = useState('');
  const [refereeId, setRefereeId] = useState('');
  const [courtId, setCourtId] = useState('');
  const [winScore, setWinScore] = useState<11 | 21 | 31>(11);
  const [setsToWin, setSetsToWin] = useState(2);
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

  const getPlayerName = (id: string) => players.find(p => p.id === id)?.name || '알 수 없음';
  const getRefereeName = (id?: string) => id ? referees.find(r => r.id === id)?.name : null;
  const getCourtName = (id?: string) => id ? courts.find(c => c.id === id)?.name : null;

  const handleCreate = async () => {
    if (!player1Id || !player2Id || player1Id === player2Id || submitting) return;
    setSubmitting(true);

    try {
      const gameConfig: GameConfig = { winScore, setsToWin };
      const id = await addGame({
        player1Id,
        player2Id,
        sets: [createEmptySet()],
        currentSet: 0,
        winnerId: null,
        status: 'pending',
        refereeId: refereeId || undefined,
        courtId: courtId || undefined,
        gameConfig,
        player1Timeouts: 0,
        player2Timeouts: 0,
        activeTimeout: null,
        createdAt: Date.now(),
      });

      setShowCreate(false);
      resetForm();
      if (id) navigate(`/individual/${id}`);
    } catch (error) {
      console.error('Failed to create game:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setPlayer1Id('');
    setPlayer2Id('');
    setRefereeId('');
    setCourtId('');
    setWinScore(11);
    setSetsToWin(2);
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
          <h1 className="text-3xl font-bold text-primary">개인전</h1>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">
          + 새 경기
        </button>
      </div>

      {games.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400 mb-4">등록된 경기가 없습니다</p>
          <button onClick={() => setShowCreate(true)} className="btn btn-accent">
            첫 경기 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {games.map(game => (
            <div key={game.id} className="card flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">
                  {getPlayerName(game.player1Id)} vs {getPlayerName(game.player2Id)}
                </h2>
                <p className="text-gray-400">
                  {game.gameConfig.winScore}점 · {game.gameConfig.setsToWin}세트 선승
                  {getRefereeName(game.refereeId) && ` · 심판: ${getRefereeName(game.refereeId)}`}
                  {getCourtName(game.courtId) && ` · ${getCourtName(game.courtId)}`}
                </p>
                {game.status === 'completed' && game.winnerId && (
                  <p className="text-green-400 font-bold">{getPlayerName(game.winnerId)} 승리</p>
                )}
                <span className={`inline-block mt-2 px-3 py-1 rounded text-sm font-bold ${getStatusColor(game.status)}`}>
                  {getStatusText(game.status)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/individual/${game.id}`)}
                  className="btn btn-secondary"
                  aria-label={`${getPlayerName(game.player1Id)} vs ${getPlayerName(game.player2Id)} 경기 열기`}
                >
                  {game.status === 'completed' ? '보기' : '점수 기록'}
                </button>
                <button
                  onClick={() => {
                    if (confirm('이 경기를 삭제하시겠습니까?')) {
                      deleteGame(game.id);
                    }
                  }}
                  className="btn btn-danger"
                  aria-label="경기 삭제"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 경기 생성 모달 */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)} onKeyDown={e => { if (e.key === 'Escape') setShowCreate(false); }}>
          <div
            ref={modalRef}
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-game-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="create-game-title" className="text-2xl font-bold mb-6 text-primary">새 개인전</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-lg mb-2">선수 1 *</label>
                <select value={player1Id} onChange={e => setPlayer1Id(e.target.value)} className="input">
                  <option value="">선수 선택</option>
                  {players.filter(p => p.id !== player2Id).map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.club ? ` (${p.club})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-lg mb-2">선수 2 *</label>
                <select value={player2Id} onChange={e => setPlayer2Id(e.target.value)} className="input">
                  <option value="">선수 선택</option>
                  {players.filter(p => p.id !== player1Id).map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.club ? ` (${p.club})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-lg mb-2">승점</label>
                <div className="flex gap-4">
                  {([11, 21, 31] as const).map(score => (
                    <button
                      key={score}
                      onClick={() => setWinScore(score)}
                      aria-pressed={winScore === score}
                      className={`flex-1 p-4 rounded-lg text-center font-bold text-xl transition-all ${
                        winScore === score ? 'bg-primary text-black' : 'bg-gray-800 hover:bg-gray-700'
                      }`}
                    >
                      {score}점
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-lg mb-2">세트 선승</label>
                <div className="flex gap-4">
                  {[1, 2, 3].map(sets => (
                    <button
                      key={sets}
                      onClick={() => setSetsToWin(sets)}
                      aria-pressed={setsToWin === sets}
                      className={`flex-1 p-4 rounded-lg text-center font-bold text-xl transition-all ${
                        setsToWin === sets ? 'bg-primary text-black' : 'bg-gray-800 hover:bg-gray-700'
                      }`}
                    >
                      {sets}세트
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-lg mb-2">심판</label>
                <select value={refereeId} onChange={e => setRefereeId(e.target.value)} className="input">
                  <option value="">선택 안함</option>
                  {referees.map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.role === 'main' ? '주심' : '부심'})</option>
                  ))}
                </select>
              </div>

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
                disabled={!player1Id || !player2Id || player1Id === player2Id || submitting}
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
