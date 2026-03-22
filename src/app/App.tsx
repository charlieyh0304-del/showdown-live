import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ModeSelector from './ModeSelector';
import OfflineIndicator from '@shared/components/OfflineIndicator';
import ConnectionStatus from '@shared/components/ConnectionStatus';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import AccessibilityMenu from '@shared/components/AccessibilityMenu';
import ErrorBoundary from '@shared/components/ErrorBoundary';

const AdminRoutes = lazy(() => import('../admin/AdminRoutes'));
const RefereeRoutes = lazy(() => import('../referee/RefereeRoutes'));
const SpectatorRoutes = lazy(() => import('../spectator/SpectatorRoutes'));

function App() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-black text-white">
        <OfflineIndicator />
        <ConnectionStatus />
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><LoadingSpinner /></div>}>
          <Routes>
            <Route path="/" element={<ModeSelector />} />
            <Route path="/admin/*" element={<AdminRoutes />} />
            <Route path="/referee/*" element={<RefereeRoutes />} />
            <Route path="/spectator/*" element={<SpectatorRoutes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <AccessibilityMenu />
        <div style={{ position: 'fixed', bottom: 2, right: 8, fontSize: '0.625rem', color: '#4b5563', pointerEvents: 'none', zIndex: 9999 }}>v5</div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
