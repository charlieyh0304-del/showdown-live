import { Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ModeBadge from '@shared/components/ModeBadge';

export default function PracticeLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      <div
        role="status"
        style={{
          backgroundColor: '#7c3aed',
          color: '#ffffff',
          textAlign: 'center',
          padding: '0.5rem',
          fontSize: '1rem',
          fontWeight: 'bold',
        }}
      >
        {t('referee.practice.layout.banner')}
      </div>
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-900" role="banner">
        <ModeBadge mode="practice" />
        <button
          className="btn btn-accent"
          onClick={() => navigate('/referee')}
          aria-label={t('referee.practice.layout.exitAriaLabel')}
        >
          {t('referee.practice.layout.exitButton')}
        </button>
      </header>
      <main id="main-content" className="flex-1 w-full max-w-3xl mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
