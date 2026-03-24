import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ModeSelector from './ModeSelector';
import OfflineIndicator from '@shared/components/OfflineIndicator';
import ConnectionStatus from '@shared/components/ConnectionStatus';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import AccessibilityMenu from '@shared/components/AccessibilityMenu';
import ErrorBoundary from '@shared/components/ErrorBoundary';
import { useRouteAnnouncer } from '@shared/hooks/useRouteAnnouncer';

const AdminRoutes = lazy(() => import('../admin/AdminRoutes'));
const RefereeRoutes = lazy(() => import('../referee/RefereeRoutes'));
const SpectatorRoutes = lazy(() => import('../spectator/SpectatorRoutes'));

function AppContent() {
  const routeAnnouncement = useRouteAnnouncer();

  return (
    <>
      {/* Skip navigation link - visible only on focus */}
      <a href="#main-content" className="skip-link">
        본문으로 건너뛰기
      </a>

      {/* Route change announcements for screen readers */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {routeAnnouncement}
      </div>

      <div className="min-h-screen bg-black text-white">
        <OfflineIndicator />
        <ConnectionStatus />
        <Suspense
          fallback={
            <div className="flex items-center justify-center min-h-screen">
              <LoadingSpinner message="페이지 로딩 중..." />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<ModeSelector />} />
            <Route path="/admin/*" element={<AdminRoutes />} />
            <Route path="/referee/*" element={<RefereeRoutes />} />
            <Route path="/spectator/*" element={<SpectatorRoutes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <AccessibilityMenu />
      </div>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
