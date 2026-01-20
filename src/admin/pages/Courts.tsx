import { useState } from 'react';
import { useCourts, useReferees } from '@shared/hooks/useFirebase';
import type { Court } from '@shared/types';

export default function Courts() {
  const { courts, loading, addCourt, updateCourt, deleteCourt } = useCourts();
  const { referees } = useReferees();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [assignedReferees, setAssignedReferees] = useState<string[]>([]);

  const handleSubmit = async () => {
    if (!name.trim()) return;

    const courtData = {
      name: name.trim(),
      location: location.trim() || undefined,
      assignedReferees,
    };

    if (editingId) {
      await updateCourt(editingId, courtData);
      setEditingId(null);
    } else {
      await addCourt(courtData as Omit<Court, 'id' | 'createdAt'>);
    }

    resetForm();
  };

  const handleEdit = (court: Court) => {
    setEditingId(court.id);
    setName(court.name);
    setLocation(court.location || '');
    setAssignedReferees(court.assignedReferees || []);
    setShowAdd(true);
  };

  const resetForm = () => {
    setShowAdd(false);
    setEditingId(null);
    setName('');
    setLocation('');
    setAssignedReferees([]);
  };

  const toggleReferee = (refereeId: string) => {
    setAssignedReferees(prev => {
      if (prev.includes(refereeId)) {
        return prev.filter(id => id !== refereeId);
      }
      // 최대 2명까지만 선택 가능
      if (prev.length >= 2) {
        return prev;
      }
      return [...prev, refereeId];
    });
  };

  const getRefereeNames = (refereeIds: string[]) => {
    return refereeIds
      .map(id => referees.find(r => r.id === id)?.name)
      .filter(Boolean)
      .join(', ');
  };

  if (loading) {
    return <div className="text-center py-20 text-2xl">로딩 중...</div>;
  }

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-primary">경기장 관리</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="btn btn-primary"
        >
          + 경기장 추가
        </button>
      </div>

      {courts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400 mb-4">등록된 경기장이 없습니다</p>
          <button
            onClick={() => setShowAdd(true)}
            className="btn btn-accent"
          >
            첫 경기장 등록하기
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {courts.map(court => (
            <div
              key={court.id}
              className="card flex justify-between items-center"
            >
              <div>
                <h2 className="text-2xl font-bold">{court.name}</h2>
                {court.location && (
                  <p className="text-gray-400">{court.location}</p>
                )}
                {court.assignedReferees && court.assignedReferees.length > 0 && (
                  <p className="text-cyan-400 mt-1">
                    심판: {getRefereeNames(court.assignedReferees)}
                  </p>
                )}
                <span className={`inline-block mt-2 px-3 py-1 rounded text-sm font-bold ${
                  court.assignedReferees?.length === 2 ? 'bg-green-600' :
                  court.assignedReferees?.length === 1 ? 'bg-yellow-600' :
                  'bg-gray-600'
                }`}>
                  {court.assignedReferees?.length || 0}명 배정
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(court)}
                  className="btn btn-secondary"
                >
                  수정
                </button>
                <button
                  onClick={() => {
                    if (confirm('정말 삭제하시겠습니까?')) {
                      deleteCourt(court.id);
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

      {/* 경기장 추가/수정 모달 */}
      {showAdd && (
        <div className="modal-backdrop" onClick={resetForm}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold mb-6 text-primary">
              {editingId ? '경기장 수정' : '경기장 추가'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-lg mb-2">경기장 이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="input"
                  placeholder="예: 1번 테이블"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-lg mb-2">위치 (선택)</label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className="input"
                  placeholder="예: A구역"
                />
              </div>

              <div>
                <label className="block text-lg mb-2">
                  담당 심판 (최대 2명, 현재 {assignedReferees.length}명 선택)
                </label>
                {referees.length === 0 ? (
                  <p className="text-gray-400">
                    먼저 심판을 등록해주세요
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                    {referees.map(referee => (
                      <button
                        key={referee.id}
                        onClick={() => toggleReferee(referee.id)}
                        disabled={!assignedReferees.includes(referee.id) && assignedReferees.length >= 2}
                        className={`p-3 rounded-lg text-left transition-all ${
                          assignedReferees.includes(referee.id)
                            ? 'bg-primary text-black'
                            : assignedReferees.length >= 2
                            ? 'bg-gray-800 opacity-50 cursor-not-allowed'
                            : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        <div className="font-bold">{referee.name}</div>
                        <div className={`text-sm ${
                          assignedReferees.includes(referee.id) ? 'text-gray-700' : 'text-gray-400'
                        }`}>
                          {referee.role === 'main' ? '주심' : '부심'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button
                onClick={resetForm}
                className="btn flex-1 bg-gray-700 hover:bg-gray-600"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!name.trim()}
                className="btn btn-primary flex-1"
              >
                {editingId ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
