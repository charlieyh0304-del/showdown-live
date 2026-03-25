import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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

  // Update page title and lang attribute when language changes
  useEffect(() => {
    document.title = t('common.appName') + ' - ' + t('common.appDescription');
    document.documentElement.lang = i18n.language;
  }, [i18n.language, t]);

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

      <div className="min-h-screen bg-black text-white">
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
