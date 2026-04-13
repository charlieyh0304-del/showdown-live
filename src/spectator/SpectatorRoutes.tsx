import { Routes, Route, Navigate } from 'react-router-dom';
import SpectatorLayout from './components/SpectatorLayout';
import { SectionErrorBoundary } from '@shared/components/ErrorBoundary';
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
        <Route path="/" element={<SectionErrorBoundary><SpectatorHome /></SectionErrorBoundary>} />
        {/* Tournament context routes - 5 bottom tabs */}
        <Route path="/tournament/:id" element={<SectionErrorBoundary><TournamentView viewTab="overview" /></SectionErrorBoundary>} />
        <Route path="/tournament/:id/players" element={<SectionErrorBoundary><TournamentView viewTab="players" /></SectionErrorBoundary>} />
        <Route path="/tournament/:id/standings" element={<SectionErrorBoundary><TournamentView viewTab="standings" /></SectionErrorBoundary>} />
        <Route path="/tournament/:id/schedule" element={<SectionErrorBoundary><TournamentView viewTab="schedule" /></SectionErrorBoundary>} />
        <Route path="/tournament/:id/referees" element={<SectionErrorBoundary><TournamentView viewTab="referees" /></SectionErrorBoundary>} />
        {/* Detail views */}
        <Route path="/match/:tournamentId/:matchId" element={<SectionErrorBoundary><LiveMatchView /></SectionErrorBoundary>} />
        <Route path="/player/:tournamentId/:playerName" element={<SectionErrorBoundary><PlayerProfileView /></SectionErrorBoundary>} />
        {/* Home context routes */}
        <Route path="/favorites" element={<SectionErrorBoundary><FavoritesView /></SectionErrorBoundary>} />
        <Route path="/practice" element={<SectionErrorBoundary><PracticeWatchView /></SectionErrorBoundary>} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </SpectatorLayout>
  );
}
