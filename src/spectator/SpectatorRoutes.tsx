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
        {/* 대회 상세: 구역(실시간·일정·순위·대진·다음 경기·선수·심판·설정)과 선수·심판 상세가 모두 주소를 가진다 (뒤로 가기·공유) */}
        <Route path="/tournament/:id/*" element={<SectionErrorBoundary><TournamentView /></SectionErrorBoundary>} />
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
