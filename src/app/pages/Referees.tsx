import { useState, useEffect, useRef } from 'react';
import { useReferees } from '@shared/hooks/useFirebase';
import type { Referee } from '@shared/types';

export default function Referees() {
  const { referees, loading, addReferee, updateReferee, deleteReferee } = useReferees();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'main' | 'assistant'>('main');

  const [submitting, setSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAdd) return;
    document.body.style.overflow = 'hidden';
    const el = modalRef.current;
    if (el) {
      const focusable = el.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])');
      if (focusable.length > 0) focusable[0].focus();
    }
    return () => { document.body.style.overflow = ''; };
  }, [showAdd]);

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);

    try {
      if (editingId) {
        await updateReferee(editingId, { name: name.trim(), role });
        setEditingId(null);
      } else {
        await addReferee({ name: name.trim(), role });
      }

      setName('');
      setRole('main');
      setShowAdd(false);
    } catch (error) {
      console.error('Failed to save referee:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (referee: Referee) => {
    setEditingId(referee.id);
    setName(referee.name);
    setRole(referee.role);
    setShowAdd(true);
  };

  const handleCancel = () => {
    setShowAdd(false);
    setEditingId(null);
    setName('');
    setRole('main');
  };

  if (loading) {
    return <div className="text-center py-20 text-2xl" role="status" aria-live="polite">로딩 중...</div>;
  }

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-primary">심판 관리</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="btn btn-primary"
        >
          + 심판 추가
        </button>
      </div>

      {referees.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400 mb-4">등록된 심판이 없습니다</p>
          <button
            onClick={() => setShowAdd(true)}
            className="btn btn-accent"
          >
            첫 심판 등록하기
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {referees.map(referee => (
            <div
              key={referee.id}
              className="card flex justify-between items-center"
            >
              <div>
                <h2 className="text-2xl font-bold">{referee.name}</h2>
                <span className={`inline-block mt-2 px-3 py-1 rounded text-sm font-bold ${
                  referee.role === 'main' ? 'bg-yellow-600' : 'bg-blue-600'
                }`}>
                  {referee.role === 'main' ? '주심' : '부심'}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(referee)}
                  className="btn btn-secondary"
                  aria-label={`${referee.name} 심판 수정`}
                >
                  수정
                </button>
                <button
                  onClick={() => {
                    if (confirm('정말 삭제하시겠습니까?')) {
                      deleteReferee(referee.id);
                    }
                  }}
                  className="btn btn-danger"
                  aria-label={`${referee.name} 심판 삭제`}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 심판 추가/수정 모달 */}
      {showAdd && (
        <div className="modal-backdrop" onClick={handleCancel} onKeyDown={e => { if (e.key === 'Escape') handleCancel(); }}>
          <div
            ref={modalRef}
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="referee-form-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="referee-form-title" className="text-2xl font-bold mb-6 text-primary">
              {editingId ? '심판 수정' : '심판 추가'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-lg mb-2">이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="input"
                  placeholder="심판 이름"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-lg mb-2">역할</label>
                <div className="flex gap-4">
                  <button
                    onClick={() => setRole('main')}
                    aria-pressed={role === 'main'}
                    className={`flex-1 p-4 rounded-lg text-center font-bold transition-all ${
                      role === 'main'
                        ? 'bg-yellow-600 text-white'
                        : 'bg-gray-800 hover:bg-gray-700'
                    }`}
                  >
                    주심
                  </button>
                  <button
                    onClick={() => setRole('assistant')}
                    aria-pressed={role === 'assistant'}
                    className={`flex-1 p-4 rounded-lg text-center font-bold transition-all ${
                      role === 'assistant'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 hover:bg-gray-700'
                    }`}
                  >
                    부심
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button
                onClick={handleCancel}
                className="btn flex-1 bg-gray-700 hover:bg-gray-600"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!name.trim() || submitting}
                className="btn btn-primary flex-1"
              >
                {submitting ? '저장 중...' : editingId ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
