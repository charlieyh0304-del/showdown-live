import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Players from './pages/Players';
import Tournament from './pages/Tournament';
import Match from './pages/Match';
import Referees from './pages/Referees';
import Courts from './pages/Courts';
import RandomTeamLeagues from './pages/RandomTeamLeagues';
import RandomTeamLeagueDetail from './pages/RandomTeamLeagueDetail';

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
                <NavLink
                  to="/team-leagues"
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                >
                  팀리그
                </NavLink>
                <NavLink
                  to="/referees"
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                >
                  심판
                </NavLink>
                <NavLink
                  to="/courts"
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'active' : ''}`
                  }
                >
                  경기장
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
          <Route path="/referees" element={<Referees />} />
          <Route path="/courts" element={<Courts />} />
          <Route path="/team-leagues" element={<RandomTeamLeagues />} />
          <Route path="/team-league/:id" element={<RandomTeamLeagueDetail />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
