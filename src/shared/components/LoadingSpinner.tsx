import { useTranslation } from 'react-i18next';

export default function LoadingSpinner({ message }: { message?: string }) {
  const { t } = useTranslation();
  const displayMessage = message ?? t('common.loading');

  return (
    <div className="flex flex-col items-center justify-center py-20 min-h-[50vh] w-full" role="status" aria-live="polite">
      <span className="text-2xl text-gray-400 animate-pulse" aria-label={displayMessage}>{displayMessage}</span>
      <span className="sr-only">{displayMessage}</span>
    </div>
  );
}
