import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface AccessDeniedProps {
  mode: 'admin' | 'referee';
  message?: string;
}

export default function AccessDenied({ mode, message }: AccessDeniedProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const modeLabel = mode === 'admin' ? t('common.modeBadge.admin') : t('common.modeBadge.referee');

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-8 text-center"
      role="alert"
    >
      <div
        style={{
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          backgroundColor: '#7f1d1d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '2rem',
          border: '4px solid #dc2626',
          fontSize: '4rem',
        }}
        aria-hidden="true"
      >
        !
      </div>

      <h1 className="text-3xl font-bold text-red-400 mb-4">{t('common.accessDenied.title')}</h1>
      <p className="text-xl text-gray-300 mb-8">
        {message || (mode === 'admin' ? t('common.accessDenied.adminAuthRequired') : t('common.accessDenied.refereeAuthRequired'))}
      </p>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        <button
          className="btn btn-primary btn-large w-full"
          onClick={() => navigate(mode === 'admin' ? '/admin' : '/referee')}
          aria-label={t('common.accessDenied.goToLoginAriaLabel', { mode: modeLabel })}
        >
          {t('common.accessDenied.goToLogin')}
        </button>
        <button
          className="btn btn-secondary btn-large w-full"
          onClick={() => navigate('/')}
          aria-label={t('common.accessDenied.goHomeAriaLabel')}
        >
          {t('common.accessDenied.goHome')}
        </button>
      </div>
    </div>
  );
}
