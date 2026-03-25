import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageToggle from '@shared/components/LanguageToggle';

export default function ModeSelector() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <main id="main-content" className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <LanguageToggle />
      </div>
      <h1 className="text-4xl font-bold text-primary mb-4">{t('common.appName')}</h1>
      <p className="text-gray-400 text-lg mb-12">{t('common.appDescription')}</p>

      <nav className="grid gap-6 w-full max-w-md" aria-label={t('app.modeSelect')}>
        <button
          onClick={() => navigate('/admin')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-primary"
          style={{ borderLeft: '8px solid var(--color-primary)' }}
          aria-label={t('app.adminAriaLabel')}
        >
          <span className="text-3xl font-bold text-primary mb-2 block">{t('app.admin')}</span>
          <span className="text-gray-400 block">{t('app.adminDescription')}</span>
        </button>

        <button
          onClick={() => navigate('/referee')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-secondary"
          style={{ borderLeft: '8px solid var(--color-secondary)' }}
          aria-label={t('app.refereeAriaLabel')}
        >
          <span className="text-3xl font-bold text-secondary mb-2 block">{t('app.referee')}</span>
          <span className="text-gray-400 block">{t('app.refereeDescription')}</span>
        </button>

        <button
          onClick={() => navigate('/spectator')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-green-400"
          style={{ borderLeft: '8px solid #00ff00' }}
          aria-label={t('app.spectatorAriaLabel')}
        >
          <span className="text-3xl font-bold text-green-400 mb-2 block">{t('app.spectator')}</span>
          <span className="text-gray-400 block">{t('app.spectatorDescription')}</span>
        </button>
      </nav>
    </main>
  );
}
