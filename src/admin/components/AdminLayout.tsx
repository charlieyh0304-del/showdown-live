import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth, useAdminPinExists } from '@shared/hooks/useAuth';
import { hashPin } from '@shared/utils/crypto';
import { ref, set } from 'firebase/database';
import { database } from '@shared/config/firebase';

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { isAdmin, loginAdmin, logout } = useAuth();
  const adminPinExists = useAdminPinExists();
  const navigate = useNavigate();

  if (adminPinExists === null) {
    return (
      <div className="flex items-center justify-center min-h-screen" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">로딩 중...</p>
      </div>
    );
  }

  if (!adminPinExists) {
    return <AdminPinSetup />;
  }

  if (!isAdmin) {
    return <AdminLogin onLogin={loginAdmin} />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center gap-2 p-4 border-b border-gray-700 flex-wrap" aria-label="관리자 내비게이션">
        <NavLink
          to="/admin"
          end
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label="대시보드"
        >
          대시보드
        </NavLink>
        <NavLink
          to="/admin/players"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label="선수 관리"
        >
          선수
        </NavLink>
        <NavLink
          to="/admin/referees"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label="심판 관리"
        >
          심판
        </NavLink>
        <NavLink
          to="/admin/courts"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label="경기장 관리"
        >
          경기장
        </NavLink>
        <NavLink
          to="/admin/settings"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label="설정"
        >
          설정
        </NavLink>
        <div className="flex-1" />
        <button
          className="btn btn-danger"
          onClick={() => {
            logout();
            navigate('/');
          }}
          aria-label="로그아웃"
        >
          로그아웃
        </button>
      </nav>
      <main className="flex-1 p-4">
        {children}
      </main>
    </div>
  );
}

function AdminPinSetup() {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pin.length < 4) {
      setError('PIN은 4자리 이상이어야 합니다.');
      return;
    }
    if (pin !== confirmPin) {
      setError('PIN이 일치하지 않습니다.');
      return;
    }
    setSaving(true);
    try {
      const hashed = await hashPin(pin);
      await set(ref(database, 'config/adminPin'), hashed);
    } catch {
      setError('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }, [pin, confirmPin]);

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-yellow-400 text-center">관리자 PIN 설정</h1>
        <p className="text-gray-300 text-center">처음 사용하시는 경우 관리자 PIN을 설정해주세요.</p>
        <div>
          <label htmlFor="pin-input" className="block mb-2 font-semibold">PIN (4자리 이상)</label>
          <input
            ref={inputRef}
            id="pin-input"
            type="password"
            className="input"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="PIN 입력"
            autoComplete="new-password"
            aria-label="관리자 PIN 입력"
          />
        </div>
        <div>
          <label htmlFor="confirm-pin-input" className="block mb-2 font-semibold">PIN 확인</label>
          <input
            id="confirm-pin-input"
            type="password"
            className="input"
            value={confirmPin}
            onChange={e => setConfirmPin(e.target.value)}
            placeholder="PIN 확인"
            autoComplete="new-password"
            aria-label="관리자 PIN 확인"
          />
        </div>
        {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={saving} aria-label="PIN 설정 완료">
          {saving ? '저장 중...' : 'PIN 설정'}
        </button>
      </form>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: (pin: string) => Promise<boolean> }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!pin) {
      setError('PIN을 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      const success = await onLogin(pin);
      if (!success) {
        setError('PIN이 올바르지 않습니다.');
        setPin('');
        inputRef.current?.focus();
      }
    } catch {
      setError('인증 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [pin, onLogin]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setPin('');
      setError('');
    }
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen p-4" onKeyDown={handleKeyDown}>
      <form onSubmit={handleSubmit} className="card w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-yellow-400 text-center">관리자 로그인</h1>
        <div>
          <label htmlFor="admin-pin" className="block mb-2 font-semibold">관리자 PIN</label>
          <input
            ref={inputRef}
            id="admin-pin"
            type="password"
            className="input"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="PIN 입력"
            autoComplete="current-password"
            aria-label="관리자 PIN 입력"
          />
        </div>
        {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={loading} aria-label="로그인">
          {loading ? '인증 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
