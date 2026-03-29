import { Routes, Route, Navigate } from 'react-router-dom';
import SpectatorLayout from './components/SpectatorLayout';
import SpectatorHome from './pages/SpectatorHome';
import TournamentView from './pages/TournamentView';
import LiveMatchView from './pages/LiveMatchView';
import FavoritesView from './pages/FavoritesView';
import PracticeWatchView from './pages/PracticeWatchView';
import PlayerProfileView from './pages/PlayerProfileView';

export default function SpectatorRoutes() {
  return (
    <SpectatorLayout>
      <Routes>
        <Route path="/" element={<SpectatorHome />} />
        {/* Tournament context routes - 5 bottom tabs */}
        <Route path="/tournament/:id" element={<TournamentView viewTab="overview" />} />
        <Route path="/tournament/:id/players" element={<TournamentView viewTab="players" />} />
        <Route path="/tournament/:id/standings" element={<TournamentView viewTab="standings" />} />
        <Route path="/tournament/:id/schedule" element={<TournamentView viewTab="schedule" />} />
        <Route path="/tournament/:id/referees" element={<TournamentView viewTab="referees" />} />
        {/* Detail views */}
        <Route path="/match/:tournamentId/:matchId" element={<LiveMatchView />} />
        <Route path="/player/:tournamentId/:playerName" element={<PlayerProfileView />} />
        {/* Home context routes */}
        <Route path="/favorites" element={<FavoritesView />} />
        <Route path="/practice" element={<PracticeWatchView />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </SpectatorLayout>
  );
}
