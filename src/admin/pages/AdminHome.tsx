import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ref, get } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { useTournaments } from '@shared/hooks/useFirebase';
import { useAuth } from '@shared/hooks/useAuth';
import { verifyPin, createRateLimiter } from '@shared/utils/crypto';
import type { TournamentStatus, TournamentType } from '@shared/types';

const STATUS_KEYS: Record<TournamentStatus, string> = {
  draft: 'common.tournamentStatus.draft',
  registration: 'common.tournamentStatus.registration',
  in_progress: 'common.tournamentStatus.inProgress',
  paused: 'common.tournamentStatus.paused',
  completed: 'common.tournamentStatus.completed',
};

const STATUS_ICONS: Record<TournamentStatus, string> = {
  draft: '\u270E',
  registration: '\u{1F4CB}',
  in_progress: '\u25B6',
  paused: '\u23F8',
  completed: '\u2713',
};

const STATUS_COLORS: Record<TournamentStatus, string> = {
  draft: 'bg-gray-600 text-white',
  registration: 'bg-blue-600 text-white',
  in_progress: 'bg-orange-500 text-black',
  paused: 'bg-red-600 text-white',
  completed: 'bg-green-600 text-white',
};

const TYPE_KEYS: Record<TournamentType, string> = {
  individual: 'common.tournamentType.individual',
  team: 'common.tournamentType.team',
  randomTeamLeague: 'common.tournamentType.randomTeamLeague',
};

export default function AdminHome() {
  const { t } = useTranslation();
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
        <p className="text-2xl text-yellow-400 animate-pulse">{t('admin.home.loadingTournaments')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('admin.home.title')}</h1>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/admin/tournament/new')}
          aria-label={t('admin.home.createTournament')}
        >
          {t('admin.home.createTournament')}
        </button>
      </div>

      {tournaments.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">{t('admin.home.noTournaments')}</p>
          <p className="text-gray-400 mt-2">{t('admin.home.startPrompt')}</p>
        </div>
      ) : (
        <div className="space-y-4" aria-label={t('admin.home.tournamentListLabel')}>
          {tournaments.map(tour => (
            <div key={tour.id} className="card flex items-center justify-between flex-wrap gap-4">
              <div
                className="flex-1 cursor-pointer min-w-0"
                onClick={() => navigate(`/admin/tournament/${tour.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') navigate(`/admin/tournament/${tour.id}`); }}
                aria-label={t('admin.home.tournamentDetailAriaLabel', { name: tour.name })}
              >
                <h2 className="text-xl font-bold truncate">{tour.name}</h2>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="text-gray-400">{tour.date}</span>
                  <span className="text-cyan-400">{t(TYPE_KEYS[tour.type])}</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[tour.status]}`}>
                    {STATUS_ICONS[tour.status]} {t(STATUS_KEYS[tour.status])}
                  </span>
                </div>
              </div>
              <button
                className="btn btn-danger"
                onClick={() => setDeleteTarget(tour.id)}
                aria-label={t('admin.home.deleteTournamentAriaLabel', { name: tour.name })}
              >
                {t('common.delete')}
              </button>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          tournamentName={tournaments.find(tour => tour.id === deleteTarget)?.name || ''}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}

// ===== 삭제 확인 모달 (포커스 트랩 + Firebase PIN 검증 + 레이트 리미팅) =====
function DeleteConfirmModal({ tournamentName, onConfirm, onCancel, deleting }: { tournamentName: string; onConfirm: () => void; onCancel: () => void; deleting: boolean }) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const { session } = useAuth();

  // 레이트 리미터 (5회 실패 시 30초 잠금)
  const rateLimiter = useMemo(() => createRateLimiter(5, 30000), []);

  // 잠금 타이머 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = rateLimiter.remainingLockout();
      setLockoutSeconds(Math.ceil(remaining / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [rateLimiter]);

  // 모달 열릴 때 포커스 저장 및 이동
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    passwordRef.current?.focus();
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

  const handleConfirmWithPassword = useCallback(async () => {
    if (!rateLimiter.canAttempt()) {
      setPasswordError(t('admin.login.tooManyAttempts', { seconds: Math.ceil(rateLimiter.remainingLockout() / 1000) }));
      return;
    }

    setVerifying(true);
    setPasswordError('');

    try {
      let verified = false;

      // 다중 관리자 모드: 현재 로그인한 관리자의 PIN 검증
      if (session?.adminId) {
        const adminSnap = await get(ref(database, `admins/${session.adminId}/pin`));
        if (adminSnap.exists()) {
          verified = await verifyPin(password, adminSnap.val() as string);
        }
      } else {
        // 레거시 모드: config/adminPin 검증
        const configSnap = await get(ref(database, 'config/adminPin'));
        if (configSnap.exists()) {
          verified = await verifyPin(password, configSnap.val() as string);
        }
      }

      if (!verified) {
        rateLimiter.recordFailure();
        const remaining = rateLimiter.remainingLockout();
        if (remaining > 0) {
          setPasswordError(t('admin.login.lockedMessage', { seconds: Math.ceil(remaining / 1000) }));
        } else {
          setPasswordError(t('admin.login.incorrectPin'));
        }
        setPassword('');
        passwordRef.current?.focus();
        return;
      }

      rateLimiter.recordSuccess();
      onConfirm();
    } catch {
      setPasswordError(t('common.error.authFailed'));
    } finally {
      setVerifying(false);
    }
  }, [password, session, rateLimiter, onConfirm]);

  const isLocked = lockoutSeconds > 0;

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
        <h2 id="delete-modal-title" className="text-2xl font-bold text-red-500 mb-4">{t('admin.deleteModal.title')}</h2>
        <p className="text-lg mb-4">
          {t('admin.deleteModal.confirmMessage', { name: tournamentName })}
        </p>
        <div className="mb-4">
          <label htmlFor="admin-password" className="block text-sm text-gray-400 mb-1">{t('admin.deleteModal.pinPrompt')}</label>
          <input
            ref={passwordRef}
            id="admin-password"
            type="password"
            className="input w-full"
            value={password}
            onChange={e => { setPassword(e.target.value); setPasswordError(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && password && !isLocked && !verifying) handleConfirmWithPassword(); }}
            placeholder={t('admin.deleteModal.adminPinPlaceholder')}
            aria-label={t('admin.deleteModal.adminPinPlaceholder')}
            disabled={isLocked}
          />
          {passwordError && <p className="text-red-500 text-sm mt-1" role="alert">{passwordError}</p>}
          {isLocked && (
            <p className="text-orange-400 text-sm mt-1" role="alert">
              {t('admin.login.retryAfter', { seconds: lockoutSeconds })}
            </p>
          )}
        </div>
        <div className="flex gap-4">
          <button
            className="btn btn-danger flex-1"
            onClick={handleConfirmWithPassword}
            disabled={deleting || verifying || !password || isLocked}
            aria-label={t('admin.deleteModal.deleteConfirmAriaLabel')}
          >
            {deleting ? t('common.deleting') : verifying ? t('admin.deleteModal.verifying') : t('common.delete')}
          </button>
          <button
            className="btn btn-secondary flex-1"
            onClick={onCancel}
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
