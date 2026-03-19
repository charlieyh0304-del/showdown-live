import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import ModeSelector from './ModeSelector';
import ConnectionStatus from '@shared/components/ConnectionStatus';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import AccessibilityMenu from '@shared/components/AccessibilityMenu';

const AdminRoutes = lazy(() => import('../admin/AdminRoutes'));
const RefereeRoutes = lazy(() => import('../referee/RefereeRoutes'));
const SpectatorRoutes = lazy(() => import('../spectator/SpectatorRoutes'));

function App() {
  return (
    <div className="min-h-screen bg-black text-white">
      <ConnectionStatus />
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<ModeSelector />} />
          <Route path="/admin/*" element={<AdminRoutes />} />
          <Route path="/referee/*" element={<RefereeRoutes />} />
          <Route path="/spectator/*" element={<SpectatorRoutes />} />
        </Routes>
      </Suspense>
      <AccessibilityMenu />
    </div>
  );
}

export default App;
