import { useTranslation } from 'react-i18next';
import { useConnection } from '../hooks/useConnection';

export default function ConnectionStatus() {
  const isOnline = useConnection();
  const { t } = useTranslation();

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-red-700 text-white text-center py-2 z-50 text-lg font-bold" role="alert">
      {t('common.connection.offline')}
    </div>
  );
}
