import { Outlet, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@shared/hooks/useAuth';
import { useTournament } from '@shared/hooks/useFirebase';
import ErrorBoundary from '@shared/components/ErrorBoundary';
import AiChatPanel from '@shared/components/AiChatPanel';

export default function RefereeLayout() {
  const { t } = useTranslation();
  const { session, isReferee, logout } = useAuth();
  const navigate = useNavigate();
  const { tournament } = useTournament(session?.tournamentId ?? null);

  if (!isReferee || !session) {
    return <Navigate to="/referee" replace />;
  }

  const handleLogout = () => {
    logout();
    navigate('/referee');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-900" role="banner" aria-label={t('referee.layout.headerAriaLabel')}>
        <div className="flex flex-col">
          <span className="text-yellow-400 font-bold text-lg">
            {t('referee.layout.refereeName', { name: session.refereeName || t('referee.layout.noName') })}
          </span>
          {tournament && (
            <span className="text-gray-400 text-sm">{tournament.name}</span>
          )}
        </div>
        <button
          className="btn btn-danger"
          onClick={handleLogout}
          aria-label={t('common.logout')}
        >
          {t('common.logout')}
        </button>
      </header>
      <main id="main-content" className="flex-1 w-full max-w-3xl mx-auto">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <AiChatPanel userRole="referee" />
    </div>
  );
}
