import { useState, useEffect, useRef } from 'react';
import { usePlayers } from '@shared/hooks/useFirebase';
import type { Player } from '@shared/types';

export default function Players() {
  const { players, loading, addPlayer, updatePlayer, deletePlayer } = usePlayers();
  const [showForm, setShowForm] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    club: '',
    class: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showForm) return;
    document.body.style.overflow = 'hidden';
    const el = modalRef.current;
    if (el) {
      const focusable = el.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])');
      if (focusable.length > 0) focusable[0].focus();
    }
    return () => { document.body.style.overflow = ''; };
  }, [showForm]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || submitting) return;
    setSubmitting(true);

    try {
      const data = {
        name: formData.name.trim(),
        club: formData.club.trim() || undefined,
        class: formData.class || undefined,
      };

      if (editingPlayer) {
        await updatePlayer(editingPlayer.id, data);
      } else {
        await addPlayer(data);
      }

      closeForm();
    } catch (error) {
      console.error('Failed to save player:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (player: Player) => {
    setEditingPlayer(player);
    setFormData({
      name: player.name,
      club: player.club || '',
      class: player.class || '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingPlayer(null);
    setFormData({ name: '', club: '', class: '' });
  };

  if (loading) {
    return <div className="text-center py-20 text-2xl" role="status" aria-live="polite">로딩 중...</div>;
  }

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-primary">선수 관리</h1>
        <button
          onClick={() => setShowForm(true)}
          className="btn btn-primary"
        >
          + 선수 등록
        </button>
      </div>

      {players.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400 mb-4">등록된 선수가 없습니다</p>
          <button
            onClick={() => setShowForm(true)}
            className="btn btn-accent"
          >
            첫 선수 등록하기
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {players.map(player => (
            <div
              key={player.id}
              className="card flex justify-between items-center"
            >
              <div>
                <h2 className="text-2xl font-bold">{player.name}</h2>
                <div className="flex gap-4 text-gray-400">
                  {player.club && <span>{player.club}</span>}
                  {player.class && (
                    <span className="bg-gray-700 px-2 rounded">{player.class}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openEdit(player)}
                  className="btn bg-gray-700 hover:bg-gray-600"
                  aria-label={`${player.name} 선수 수정`}
                >
                  수정
                </button>
                <button
                  onClick={() => {
                    if (confirm(`${player.name} 선수를 삭제하시겠습니까?`)) {
                      deletePlayer(player.id);
                    }
                  }}
                  className="btn btn-danger"
                  aria-label={`${player.name} 선수 삭제`}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 선수 등록/수정 모달 */}
      {showForm && (
        <div className="modal-backdrop" onClick={closeForm} onKeyDown={e => { if (e.key === 'Escape') closeForm(); }}>
          <div
            ref={modalRef}
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-form-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="player-form-title" className="text-2xl font-bold mb-6 text-primary">
              {editingPlayer ? '선수 수정' : '선수 등록'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-lg mb-2">이름 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="input"
                  placeholder="선수 이름"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-lg mb-2">소속</label>
                <input
                  type="text"
                  value={formData.club}
                  onChange={e => setFormData(prev => ({ ...prev, club: e.target.value }))}
                  className="input"
                  placeholder="예: 서울시각장애인복지관"
                />
              </div>

              <div>
                <label className="block text-lg mb-2">등급</label>
                <select
                  value={formData.class}
                  onChange={e => setFormData(prev => ({ ...prev, class: e.target.value }))}
                  className="input"
                >
                  <option value="">선택 안함</option>
                  <option value="B1">B1 (전맹)</option>
                  <option value="B2">B2 (저시력)</option>
                  <option value="B3">B3 (저시력)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button
                onClick={closeForm}
                className="btn flex-1 bg-gray-700 hover:bg-gray-600"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!formData.name.trim() || submitting}
                className="btn btn-primary flex-1"
              >
                {submitting ? '저장 중...' : editingPlayer ? '수정' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
