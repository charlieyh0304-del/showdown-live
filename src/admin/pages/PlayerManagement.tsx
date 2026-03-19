import { useState, useCallback, useEffect, useRef } from 'react';
import { usePlayers } from '@shared/hooks/useFirebase';
import type { Player } from '@shared/types';

interface PlayerForm {
  name: string;
  club: string;
  class: string;
  gender: 'male' | 'female' | '';
}

const EMPTY_FORM: PlayerForm = { name: '', club: '', class: '', gender: '' };
const CLASS_OPTIONS = ['', 'B1', 'B2', 'B3'];

export default function PlayerManagement() {
  const { players, loading, addPlayer, updatePlayer, deletePlayer } = usePlayers();
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlayerForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Player | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modalMode) {
      nameInputRef.current?.focus();
    }
  }, [modalMode]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setError('');
    setModalMode('add');
  }, []);

  const openEdit = useCallback((player: Player) => {
    setForm({ name: player.name, club: player.club ?? '', class: player.class ?? '', gender: player.gender ?? '' });
    setEditId(player.id);
    setError('');
    setModalMode('edit');
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setError('');
  }, []);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('이름을 입력해주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data: Omit<Player, 'id' | 'createdAt'> = {
        name: form.name.trim(),
        ...(form.club ? { club: form.club.trim() } : {}),
        ...(form.class ? { class: form.class } : {}),
        ...(form.gender ? { gender: form.gender } : {}),
      };
      if (modalMode === 'edit' && editId) {
        await updatePlayer(editId, data);
      } else {
        await addPlayer(data);
      }
      closeModal();
    } catch {
      setError('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }, [form, modalMode, editId, addPlayer, updatePlayer, closeModal]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deletePlayer(deleteTarget.id);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deletePlayer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  }, [closeModal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">선수 목록 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-3xl font-bold text-yellow-400">선수 관리</h1>
        <button className="btn btn-primary" onClick={openAdd} aria-label="선수 추가">
          선수 추가
        </button>
      </div>

      {players.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">등록된 선수가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3" aria-label="선수 목록">
          {players.map(p => (
            <div key={p.id} className="card flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-bold text-lg">{p.name}</span>
                {p.gender && <span className="ml-2 text-xs text-gray-500">{p.gender === 'male' ? '남' : '여'}</span>}
                {p.club && <span className="ml-3 text-gray-400">({p.club})</span>}
                {p.class && <span className="ml-3 text-cyan-400">[{p.class}]</span>}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => openEdit(p)}
                  aria-label={`${p.name} 수정`}
                >
                  수정
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteTarget(p)}
                  aria-label={`${p.name} 삭제`}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalMode && (
        <div
          className="modal-backdrop"
          onClick={closeModal}
          onKeyDown={handleKeyDown}
          role="dialog"
          aria-modal="true"
          aria-label={modalMode === 'add' ? '선수 추가' : '선수 수정'}
        >
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-yellow-400 mb-4">
              {modalMode === 'add' ? '선수 추가' : '선수 수정'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="player-name" className="block mb-1 font-semibold">이름</label>
                <input
                  ref={nameInputRef}
                  id="player-name"
                  className="input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="선수 이름"
                  aria-label="선수 이름"
                />
              </div>
              <div>
                <label htmlFor="player-club" className="block mb-1 font-semibold">소속</label>
                <input
                  id="player-club"
                  className="input"
                  value={form.club}
                  onChange={e => setForm(f => ({ ...f, club: e.target.value }))}
                  placeholder="소속 (선택)"
                  aria-label="소속"
                />
              </div>
              <div>
                <label htmlFor="player-class" className="block mb-1 font-semibold">등급</label>
                <select
                  id="player-class"
                  className="input"
                  value={form.class}
                  onChange={e => setForm(f => ({ ...f, class: e.target.value }))}
                  aria-label="등급"
                >
                  {CLASS_OPTIONS.map(c => (
                    <option key={c} value={c}>{c || '미지정'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-semibold">성별</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`btn flex-1 ${form.gender === 'male' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                    onClick={() => setForm(f => ({ ...f, gender: 'male' }))}
                    aria-pressed={form.gender === 'male'}
                    aria-label="남성 선택"
                  >
                    남
                  </button>
                  <button
                    type="button"
                    className={`btn flex-1 ${form.gender === 'female' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                    onClick={() => setForm(f => ({ ...f, gender: 'female' }))}
                    aria-pressed={form.gender === 'female'}
                    aria-label="여성 선택"
                  >
                    여
                  </button>
                  <button
                    type="button"
                    className={`btn flex-1 ${form.gender === '' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                    onClick={() => setForm(f => ({ ...f, gender: '' }))}
                    aria-pressed={form.gender === ''}
                    aria-label="미지정"
                  >
                    미지정
                  </button>
                </div>
              </div>
              {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
              <div className="flex gap-4">
                <button type="submit" className="btn btn-primary flex-1" disabled={saving} aria-label="저장">
                  {saving ? '저장 중...' : '저장'}
                </button>
                <button type="button" className="btn btn-secondary flex-1" onClick={closeModal} aria-label="취소">
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="modal-backdrop"
          onClick={() => setDeleteTarget(null)}
          onKeyDown={e => { if (e.key === 'Escape') setDeleteTarget(null); }}
          role="dialog"
          aria-modal="true"
          aria-label="선수 삭제 확인"
        >
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-red-500 mb-4">선수 삭제</h2>
            <p className="text-lg mb-6">{deleteTarget.name} 선수를 삭제하시겠습니까?</p>
            <div className="flex gap-4">
              <button className="btn btn-danger flex-1" onClick={handleDelete} aria-label="삭제 확인">
                삭제
              </button>
              <button className="btn btn-secondary flex-1" onClick={() => setDeleteTarget(null)} aria-label="취소">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
