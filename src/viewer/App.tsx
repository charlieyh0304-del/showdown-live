import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Bracket from './pages/Bracket';
import LiveMatch from './pages/LiveMatch';

function App() {
  const location = useLocation();
  const isLiveMatch = location.pathname.startsWith('/live/');

  return (
    <div className="min-h-screen bg-black text-white">
      {!isLiveMatch && (
        <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <NavLink to="/" className="text-2xl font-bold text-secondary">
                쇼다운 관람
              </NavLink>
              <div className="flex gap-2">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                >
                  대회
                </NavLink>
              </div>
            </div>
          </div>
        </nav>
      )}

      <main className={isLiveMatch ? '' : 'max-w-4xl mx-auto p-4'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bracket/:id" element={<Bracket />} />
          <Route path="/live/:tournamentId/:matchId" element={<LiveMatch />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
