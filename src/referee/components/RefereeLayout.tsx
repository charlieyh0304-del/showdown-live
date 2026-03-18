import { Outlet, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/hooks/useAuth';
import { useTournament } from '@shared/hooks/useFirebase';

export default function RefereeLayout() {
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
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-900">
        <div className="flex flex-col">
          <span className="text-yellow-400 font-bold text-lg">
            {session.refereeName} 심판
          </span>
          {tournament && (
            <span className="text-gray-400 text-sm">{tournament.name}</span>
          )}
        </div>
        <button
          className="btn btn-danger"
          onClick={handleLogout}
          aria-label="로그아웃"
        >
          로그아웃
        </button>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
