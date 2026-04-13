import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './components/AdminLayout';
import { SectionErrorBoundary } from '@shared/components/ErrorBoundary';
import AdminHome from './pages/AdminHome';
import TournamentCreate from './pages/TournamentCreate';
import TournamentDetail from './pages/TournamentDetail';
import PlayerManagement from './pages/PlayerManagement';
import RefereeManagement from './pages/RefereeManagement';
import CourtManagement from './pages/CourtManagement';
import AdminSettings from './pages/AdminSettings';

export default function AdminRoutes() {
  return (
    <AdminLayout>
      <Routes>
        <Route path="/" element={<SectionErrorBoundary><AdminHome /></SectionErrorBoundary>} />
        <Route path="/tournament/new" element={<SectionErrorBoundary><TournamentCreate /></SectionErrorBoundary>} />
        <Route path="/tournament/:id" element={<SectionErrorBoundary><TournamentDetail /></SectionErrorBoundary>} />
        <Route path="/players" element={<SectionErrorBoundary><PlayerManagement /></SectionErrorBoundary>} />
        <Route path="/referees" element={<SectionErrorBoundary><RefereeManagement /></SectionErrorBoundary>} />
        <Route path="/courts" element={<SectionErrorBoundary><CourtManagement /></SectionErrorBoundary>} />
        <Route path="/settings" element={<SectionErrorBoundary><AdminSettings /></SectionErrorBoundary>} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </AdminLayout>
  );
}
