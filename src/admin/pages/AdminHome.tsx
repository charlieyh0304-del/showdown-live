import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTournaments } from '@shared/hooks/useFirebase';
import type { TournamentStatus, TournamentType } from '@shared/types';

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: '초안',
  registration: '접수중',
  in_progress: '진행중',
  paused: '일시정지',
  completed: '완료',
};

const STATUS_COLORS: Record<TournamentStatus, string> = {
  draft: 'bg-gray-600 text-white',
  registration: 'bg-blue-600 text-white',
  in_progress: 'bg-orange-500 text-black',
  paused: 'bg-red-600 text-white',
  completed: 'bg-green-600 text-white',
};

const TYPE_LABELS: Record<TournamentType, string> = {
  individual: '개인전',
  team: '팀전',
  randomTeamLeague: '랜덤 팀리그전',
};

export default function AdminHome() {
  const { tournaments, loading, deleteTournament } = useTournaments();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTournament(deleteTarget);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteTournament]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">대회 목록 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-3xl font-bold text-yellow-400">대시보드</h1>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/admin/tournament/new')}
          aria-label="새 대회 만들기"
        >
          새 대회 만들기
        </button>
      </div>

      {tournaments.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">등록된 대회가 없습니다.</p>
          <p className="text-gray-500 mt-2">새 대회를 만들어 시작하세요.</p>
        </div>
      ) : (
        <div className="space-y-4" aria-label="대회 목록">
          {tournaments.map(t => (
            <div key={t.id} className="card flex items-center justify-between flex-wrap gap-4">
              <div
                className="flex-1 cursor-pointer min-w-0"
                onClick={() => navigate(`/admin/tournament/${t.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') navigate(`/admin/tournament/${t.id}`); }}
                aria-label={`${t.name} 대회 상세보기`}
              >
                <h2 className="text-xl font-bold truncate">{t.name}</h2>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="text-gray-400">{t.date}</span>
                  <span className="text-cyan-400">{TYPE_LABELS[t.type]}</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[t.status]}`}>
                    {STATUS_LABELS[t.status]}
                  </span>
                </div>
              </div>
              <button
                className="btn btn-danger"
                onClick={() => setDeleteTarget(t.id)}
                aria-label={`${t.name} 대회 삭제`}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}

// ===== 삭제 확인 모달 (포커스 트랩 포함) =====
function DeleteConfirmModal({ onConfirm, onCancel, deleting }: { onConfirm: () => void; onCancel: () => void; deleting: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // 모달 열릴 때 포커스 저장 및 이동
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    confirmBtnRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  // 포커스 트랩 + Escape 키 처리
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="modal-content"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
      >
        <h2 id="delete-modal-title" className="text-2xl font-bold text-red-500 mb-4">대회 삭제</h2>
        <p className="text-lg mb-6">이 대회를 정말 삭제하시겠습니까? 관련된 모든 데이터가 삭제됩니다.</p>
        <div className="flex gap-4">
          <button
            ref={confirmBtnRef}
            className="btn btn-danger flex-1"
            onClick={onConfirm}
            disabled={deleting}
            aria-label="삭제 확인"
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
          <button
            className="btn btn-secondary flex-1"
            onClick={onCancel}
            aria-label="취소"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
