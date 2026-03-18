import { Routes, Route } from 'react-router-dom';
import AdminLayout from './components/AdminLayout';
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
        <Route path="/" element={<AdminHome />} />
        <Route path="/tournament/new" element={<TournamentCreate />} />
        <Route path="/tournament/:id" element={<TournamentDetail />} />
        <Route path="/players" element={<PlayerManagement />} />
        <Route path="/referees" element={<RefereeManagement />} />
        <Route path="/courts" element={<CourtManagement />} />
        <Route path="/settings" element={<AdminSettings />} />
      </Routes>
    </AdminLayout>
  );
}
