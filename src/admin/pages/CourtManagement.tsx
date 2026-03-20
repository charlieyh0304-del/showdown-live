import { useState, useCallback, useEffect, useRef } from 'react';
import { useCourts, useReferees } from '@shared/hooks/useFirebase';
import type { Court } from '@shared/types';

interface CourtForm {
  name: string;
  location: string;
  assignedReferees: string[];
}

const EMPTY_FORM: CourtForm = { name: '', location: '', assignedReferees: [] };

export default function CourtManagement() {
  const { courts, loading, addCourt, updateCourt, deleteCourt } = useCourts();
  const { referees } = useReferees();
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<CourtForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Court | null>(null);
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

  const openEdit = useCallback((court: Court) => {
    setForm({
      name: court.name,
      location: court.location ?? '',
      assignedReferees: court.assignedReferees ?? [],
    });
    setEditId(court.id);
    setError('');
    setModalMode('edit');
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setError('');
  }, []);

  const toggleReferee = useCallback((refId: string) => {
    setForm(f => {
      const current = f.assignedReferees;
      if (current.includes(refId)) {
        return { ...f, assignedReferees: current.filter(id => id !== refId) };
      }
      if (current.length >= 2) return f; // max 2
      return { ...f, assignedReferees: [...current, refId] };
    });
  }, []);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('경기장 이름을 입력해주세요.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const data: Omit<Court, 'id' | 'createdAt'> = {
        name: form.name.trim(),
        ...(form.location ? { location: form.location.trim() } : {}),
        assignedReferees: form.assignedReferees,
      };
      if (modalMode === 'edit' && editId) {
        await updateCourt(editId, data);
      } else {
        await addCourt(data);
      }
      closeModal();
    } catch {
      setError('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }, [form, modalMode, editId, addCourt, updateCourt, closeModal]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteCourt(deleteTarget.id);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteCourt]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  }, [closeModal]);

  const getRefereeNames = useCallback((ids?: string[]) => {
    if (!ids || ids.length === 0) return '';
    return ids.map(id => referees.find(r => r.id === id)?.name ?? '알 수 없음').join(', ');
  }, [referees]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">경기장 목록 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-3xl font-bold text-yellow-400">경기장 관리</h1>
        <button className="btn btn-primary" onClick={openAdd} aria-label="경기장 추가">
          경기장 추가
        </button>
      </div>

      {courts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">등록된 경기장이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3" aria-label="경기장 목록">
          {courts.map(c => (
            <div key={c.id} className="card flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-bold text-lg">{c.name}</span>
                {c.location && <span className="ml-3 text-gray-400">({c.location})</span>}
                {(c.assignedReferees?.length ?? 0) > 0 && (
                  <span className="ml-3 text-cyan-400 text-sm">
                    심판: {getRefereeNames(c.assignedReferees)}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => openEdit(c)}
                  aria-label={`${c.name} 수정`}
                >
                  수정
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteTarget(c)}
                  aria-label={`${c.name} 삭제`}
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
          aria-label={modalMode === 'add' ? '경기장 추가' : '경기장 수정'}
        >
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-yellow-400 mb-4">
              {modalMode === 'add' ? '경기장 추가' : '경기장 수정'}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="court-name" className="block mb-1 font-semibold">경기장 이름</label>
                <input
                  ref={nameInputRef}
                  id="court-name"
                  className="input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="경기장 이름"
                  aria-label="경기장 이름"
                />
              </div>
              <div>
                <label htmlFor="court-location" className="block mb-1 font-semibold">위치</label>
                <input
                  id="court-location"
                  className="input"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="위치 (선택)"
                  aria-label="경기장 위치"
                />
              </div>
              <div>
                <p className="mb-2 font-semibold">심판 배정 (최대 2명)</p>
                {referees.length === 0 ? (
                  <p className="text-gray-400 text-sm">등록된 심판이 없습니다.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {referees.map(r => {
                      const selected = form.assignedReferees.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className={`btn text-sm ${selected ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                          onClick={() => toggleReferee(r.id)}
                          aria-pressed={selected}
                          aria-label={`${r.name} ${selected ? '배정됨' : '미배정'}`}
                        >
                          {r.name} ({r.role === 'main' ? '주심' : '부심'})
                        </button>
                      );
                    })}
                  </div>
                )}
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
          aria-label="경기장 삭제 확인"
        >
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-red-500 mb-4">경기장 삭제</h2>
            <p className="text-lg mb-6">{deleteTarget.name} 경기장을 삭제하시겠습니까?</p>
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
