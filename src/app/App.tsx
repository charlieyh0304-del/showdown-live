import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t, i18n } = useTranslation();
  const routeAnnouncement = useRouteAnnouncer();
  const location = useLocation();

  // Update page title and lang attribute when language or route changes
  useEffect(() => {
    const path = location.pathname;
    const appName = t('common.appName');
    if (path.startsWith('/admin')) {
      document.title = `${appName} - ${t('app.modeSelector.adminMode')}`;
    } else if (path.startsWith('/referee')) {
      document.title = `${appName} - ${t('app.modeSelector.refereeMode')}`;
    } else if (path.startsWith('/spectator')) {
      document.title = `${appName} - ${t('app.modeSelector.spectatorMode')}`;
    } else {
      document.title = `${appName} - ${t('common.appDescription')}`;
    }
    document.documentElement.lang = i18n.language;
  }, [i18n.language, t, location.pathname]);

  return (
    <>
      {/* Skip navigation link - visible only on focus */}
      <a href="#main-content" className="skip-link">
        {t('common.skipToContent')}
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

      <div className="min-h-screen bg-black text-white flex flex-col items-center">
        <div className="w-full max-w-5xl mx-auto flex-1 flex flex-col">
          <OfflineIndicator />
          <ConnectionStatus />
          <Suspense
            fallback={
              <div className="flex items-center justify-center min-h-screen">
                <LoadingSpinner message={t('common.pageLoading')} />
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
