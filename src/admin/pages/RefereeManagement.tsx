import { useState, useCallback, useEffect, useRef } from 'react';
import { useReferees } from '@shared/hooks/useFirebase';
import { hashPin } from '@shared/utils/crypto';
import type { Referee } from '@shared/types';

interface RefereeForm {
  name: string;
  role: 'main' | 'assistant';
  pin: string;
}

const EMPTY_FORM: RefereeForm = { name: '', role: 'main', pin: '' };

export default function RefereeManagement() {
  const { referees, loading, addReferee, updateReferee, deleteReferee } = useReferees();
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RefereeForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Referee | null>(null);
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

  const openEdit = useCallback((referee: Referee) => {
    setForm({ name: referee.name, role: referee.role, pin: '' });
    setEditId(referee.id);
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
    if (modalMode === 'add' && form.pin.length < 4) {
      setError('PIN은 4자리 이상이어야 합니다.');
      return;
    }
    if (modalMode === 'edit' && form.pin && form.pin.length < 4) {
      setError('PIN은 4자리 이상이어야 합니다.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const hashedPin = form.pin ? await hashPin(form.pin) : undefined;
      if (modalMode === 'edit' && editId) {
        const updateData: Partial<Referee> = {
          name: form.name.trim(),
          role: form.role,
        };
        if (hashedPin) {
          updateData.pin = hashedPin;
        }
        await updateReferee(editId, updateData);
      } else {
        await addReferee({
          name: form.name.trim(),
          role: form.role,
          pin: hashedPin,
        });
      }
      closeModal();
    } catch {
      setError('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }, [form, modalMode, editId, addReferee, updateReferee, closeModal]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteReferee(deleteTarget.id);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteReferee]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  }, [closeModal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">심판 목록 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-3xl font-bold text-yellow-400">심판 관리</h1>
        <button className="btn btn-primary" onClick={openAdd} aria-label="심판 추가">
          심판 추가
        </button>
      </div>

      {referees.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">등록된 심판이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3" aria-label="심판 목록">
          {referees.map(r => (
            <div key={r.id} className="card flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-bold text-lg">{r.name}</span>
                <span className={`ml-3 px-2 py-0.5 rounded text-sm font-bold ${
                  r.role === 'main' ? 'bg-yellow-800 text-yellow-300' : 'bg-gray-600 text-gray-300'
                }`}>
                  {r.role === 'main' ? '주심' : '부심'}
                </span>
                {r.pin && <span className="ml-2 text-green-400 text-sm">PIN 설정됨</span>}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => openEdit(r)}
                  aria-label={`${r.name} 수정`}
                >
                  수정
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteTarget(r)}
                  aria-label={`${r.name} 삭제`}
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
          aria-label={modalMode === 'add' ? '심판 추가' : '심판 수정'}
        >
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-yellow-400 mb-4">
              {modalMode === 'add' ? '심판 추가' : '심판 수정'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="referee-name" className="block mb-1 font-semibold">이름</label>
                <input
                  ref={nameInputRef}
                  id="referee-name"
                  className="input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="심판 이름"
                  aria-label="심판 이름"
                />
              </div>
              <div>
                <label htmlFor="referee-role" className="block mb-1 font-semibold">역할</label>
                <select
                  id="referee-role"
                  className="input"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as 'main' | 'assistant' }))}
                  aria-label="심판 역할"
                >
                  <option value="main">주심</option>
                  <option value="assistant">부심</option>
                </select>
              </div>
              <div>
                <label htmlFor="referee-pin" className="block mb-1 font-semibold">
                  PIN (4자리 이상){modalMode === 'edit' && ' - 변경 시에만 입력'}
                </label>
                <input
                  id="referee-pin"
                  type="password"
                  className="input"
                  value={form.pin}
                  onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                  placeholder={modalMode === 'edit' ? '변경 시에만 입력' : 'PIN 입력'}
                  autoComplete="new-password"
                  aria-label="심판 PIN"
                />
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
          aria-label="심판 삭제 확인"
        >
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-red-500 mb-4">심판 삭제</h2>
            <p className="text-lg mb-6">{deleteTarget.name} 심판을 삭제하시겠습니까?</p>
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
