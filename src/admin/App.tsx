import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Players from './pages/Players';
import Tournament from './pages/Tournament';
import Match from './pages/Match';

function App() {
  const location = useLocation();
  const isMatchPage = location.pathname.startsWith('/match/');

  return (
    <div className="min-h-screen bg-black text-white">
      {!isMatchPage && (
        <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <NavLink to="/" className="text-2xl font-bold text-primary">
                쇼다운
              </NavLink>
              <div className="flex gap-2">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                >
                  홈
                </NavLink>
                <NavLink
                  to="/players"
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                >
                  선수
                </NavLink>
              </div>
            </div>
          </div>
        </nav>
      )}

      <main className={isMatchPage ? '' : 'max-w-4xl mx-auto p-4'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/players" element={<Players />} />
          <Route path="/tournament/:id" element={<Tournament />} />
          <Route path="/match/:tournamentId/:matchId" element={<Match />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
