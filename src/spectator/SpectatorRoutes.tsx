import { Routes, Route } from 'react-router-dom';
import SpectatorLayout from './components/SpectatorLayout';
import SpectatorHome from './pages/SpectatorHome';
import TournamentView from './pages/TournamentView';
import LiveMatchView from './pages/LiveMatchView';
import FavoritesView from './pages/FavoritesView';
import PracticeWatchView from './pages/PracticeWatchView';

export default function SpectatorRoutes() {
  return (
    <SpectatorLayout>
      <Routes>
        <Route path="/" element={<SpectatorHome />} />
        <Route path="/tournament/:id" element={<TournamentView />} />
        <Route path="/match/:tournamentId/:matchId" element={<LiveMatchView />} />
        <Route path="/favorites" element={<FavoritesView />} />
        <Route path="/practice" element={<PracticeWatchView />} />
      </Routes>
    </SpectatorLayout>
  );
}
