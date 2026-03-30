import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useAdminPinExists } from '@shared/hooks/useAuth';
import { hashPin, createRateLimiter } from '@shared/utils/crypto';
import { ref, set } from 'firebase/database';
import { database } from '@shared/config/firebase';
import ErrorBoundary from '@shared/components/ErrorBoundary';

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { t } = useTranslation();
  const { isAdmin, loginAdmin, logout } = useAuth();
  const adminPinExists = useAdminPinExists();
  const navigate = useNavigate();

  if (adminPinExists === null) {
    return (
      <div className="flex items-center justify-center min-h-screen" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">{t('common.loading')}</p>
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
      <header role="banner">
        <nav className="flex items-center gap-2 p-4 border-b border-gray-700 flex-wrap" aria-label={t('admin.nav.label')}>
        <NavLink
          to="/admin"
          end
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label={t('admin.nav.dashboard')}
        >
          {t('admin.nav.dashboard')}
        </NavLink>
        <NavLink
          to="/admin/players"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label={t('admin.nav.playersManagement')}
        >
          {t('admin.nav.players')}
        </NavLink>
        <NavLink
          to="/admin/referees"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label={t('admin.nav.refereesManagement')}
        >
          {t('admin.nav.referees')}
        </NavLink>
        <NavLink
          to="/admin/courts"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label={t('admin.nav.courtsManagement')}
        >
          {t('admin.nav.courts')}
        </NavLink>
        <NavLink
          to="/admin/settings"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          aria-label={t('admin.nav.settings')}
        >
          {t('admin.nav.settings')}
        </NavLink>
        <div className="flex-1" />
        <button
          className="btn btn-danger"
          onClick={() => {
            logout();
            navigate('/');
          }}
          aria-label={t('common.logout')}
        >
          {t('common.logout')}
        </button>
        </nav>
      </header>
      <main id="main-content" className="flex-1 p-4 w-full max-w-5xl mx-auto">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>
    </div>
  );
}

function AdminPinSetup() {
  const { t } = useTranslation();
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
      setError(t('admin.pinSetup.minLengthError'));
      return;
    }
    if (pin !== confirmPin) {
      setError(t('admin.pinSetup.mismatchError'));
      return;
    }
    setSaving(true);
    try {
      const hashed = await hashPin(pin);
      await set(ref(database, 'config/adminPin'), hashed);
    } catch {
      setError(t('common.error.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [pin, confirmPin, t]);

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-yellow-400 text-center">{t('admin.pinSetup.title')}</h1>
        <p className="text-gray-300 text-center">{t('admin.pinSetup.description')}</p>
        <div>
          <label htmlFor="pin-input" className="block mb-2 font-semibold">{t('admin.pinSetup.pinLabel')}</label>
          <input
            ref={inputRef}
            id="pin-input"
            type="password"
            className="input"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder={t('admin.pinSetup.pinPlaceholder')}
            autoComplete="new-password"
            aria-label={t('admin.pinSetup.pinInputAriaLabel')}
          />
        </div>
        <div>
          <label htmlFor="confirm-pin-input" className="block mb-2 font-semibold">{t('admin.pinSetup.confirmLabel')}</label>
          <input
            id="confirm-pin-input"
            type="password"
            className="input"
            value={confirmPin}
            onChange={e => setConfirmPin(e.target.value)}
            placeholder={t('admin.pinSetup.confirmPlaceholder')}
            autoComplete="new-password"
            aria-label={t('admin.pinSetup.confirmInputAriaLabel')}
          />
        </div>
        {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={saving} aria-label={t('admin.pinSetup.submitAriaLabel')}>
          {saving ? t('common.saving') : t('admin.pinSetup.submitButton')}
        </button>
      </form>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: (pin: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 레이트 리미터 (5회 실패 시 30초 잠금)
  const rateLimiter = useMemo(() => createRateLimiter(5, 30000), []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 잠금 타이머 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = rateLimiter.remainingLockout();
      setLockoutSeconds(Math.ceil(remaining / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [rateLimiter]);

  const isLocked = lockoutSeconds > 0;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!pin) {
      setError(t('admin.login.enterPin'));
      return;
    }
    if (!rateLimiter.canAttempt()) {
      setError(t('admin.login.tooManyAttempts', { seconds: Math.ceil(rateLimiter.remainingLockout() / 1000) }));
      return;
    }
    setLoading(true);
    try {
      const success = await onLogin(pin);
      if (!success) {
        rateLimiter.recordFailure();
        const remaining = rateLimiter.remainingLockout();
        if (remaining > 0) {
          setError(t('admin.login.lockedMessage', { seconds: Math.ceil(remaining / 1000) }));
        } else {
          setError(t('admin.login.incorrectPin'));
        }
        setPin('');
        inputRef.current?.focus();
      } else {
        rateLimiter.recordSuccess();
      }
    } catch {
      setError(t('common.error.authFailed'));
    } finally {
      setLoading(false);
    }
  }, [pin, onLogin, rateLimiter, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setPin('');
      setError('');
    }
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen p-4" onKeyDown={handleKeyDown}>
      <form onSubmit={handleSubmit} className="card w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-yellow-400 text-center">{t('admin.login.title')}</h1>
        <div>
          <label htmlFor="admin-pin" className="block mb-2 font-semibold">{t('admin.login.pinLabel')}</label>
          <input
            ref={inputRef}
            id="admin-pin"
            type="password"
            className="input"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder={t('admin.login.pinPlaceholder')}
            autoComplete="current-password"
            aria-label={t('admin.login.pinInputAriaLabel')}
            disabled={isLocked}
          />
        </div>
        {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
        {isLocked && (
          <p className="text-orange-400 font-semibold text-center" role="alert">
            {t('admin.login.retryAfter', { seconds: lockoutSeconds })}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={loading || isLocked} aria-label={t('admin.login.loginAriaLabel')}>
          {loading ? t('admin.login.authenticating') : isLocked ? t('admin.login.locked') : t('admin.login.loginButton')}
        </button>
      </form>
    </div>
  );
}
