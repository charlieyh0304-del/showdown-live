import { useTranslation } from 'react-i18next';
import { useConnection } from '../hooks/useConnection';

export default function ConnectionStatus() {
  const { status } = useConnection();
  const { t } = useTranslation();

  if (status === 'online') return null;

  if (status === 'reconnected') {
    return (
      <div className="fixed top-0 left-0 right-0 bg-green-700 text-white text-center py-2 z-50 text-lg font-bold" role="status" aria-live="polite">
        {t('common.connection.reconnected')}
      </div>
    );
  }

  if (status === 'reconnecting') {
    return (
      <div className="fixed top-0 left-0 right-0 bg-yellow-700 text-white text-center py-2 z-50 text-lg font-bold" role="status" aria-live="polite">
        {t('common.connection.reconnecting')}
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 bg-red-700 text-white text-center py-2 z-50 text-lg font-bold" role="alert">
      {t('common.connection.offline')}
    </div>
  );
}
