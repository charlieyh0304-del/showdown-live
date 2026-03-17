import { Routes, Route, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import IndividualGames from './pages/IndividualGames';
import IndividualGameScoring from './pages/IndividualGameScoring';
import TeamMatchGames from './pages/TeamMatchGames';
import TeamMatchScoring from './pages/TeamMatchScoring';
import RandomTeamLeagues from './pages/RandomTeamLeagues';
import RandomTeamLeagueDetail from './pages/RandomTeamLeagueDetail';

function App() {
  const location = useLocation();
  const isFullScreen = location.pathname.match(/^\/individual\/[^/]+$/);

  return (
    <div className="min-h-screen bg-black text-white">
      <main className={isFullScreen ? '' : 'max-w-4xl mx-auto p-4'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/individual" element={<IndividualGames />} />
          <Route path="/individual/:id" element={<IndividualGameScoring />} />
          <Route path="/team-match" element={<TeamMatchGames />} />
          <Route path="/team-match/:id" element={<TeamMatchScoring />} />
          <Route path="/random-league" element={<RandomTeamLeagues />} />
          <Route path="/random-league/:id" element={<RandomTeamLeagueDetail />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
