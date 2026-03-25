import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface ErrorToastProps {
  message: string | null;
  onDismiss: () => void;
  duration?: number;
}

export default function ErrorToast({ message, onDismiss, duration = 5000 }: ErrorToastProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [message, onDismiss, duration]);

  if (!message) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900 border border-red-500 text-red-100 px-6 py-3 rounded-lg shadow-lg max-w-md text-center"
    >
      <p className="font-bold">{message}</p>
      <button
        className="mt-2 text-sm underline text-red-300 hover:text-white"
        onClick={onDismiss}
        aria-label={t('common.error.dismissAlert')}
      >
        {t('common.close')}
      </button>
    </div>
  );
}
