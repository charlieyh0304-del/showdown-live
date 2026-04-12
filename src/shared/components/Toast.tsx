import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { onToast, type ToastEvent, type ToastType } from '@shared/utils/toast';

interface ToastItem extends ToastEvent {
  id: number;
}

const STYLES: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: 'bg-green-900', border: 'border-green-500', text: 'text-green-100' },
  error: { bg: 'bg-red-900', border: 'border-red-500', text: 'text-red-100' },
  warning: { bg: 'bg-yellow-900', border: 'border-yellow-500', text: 'text-yellow-100' },
  info: { bg: 'bg-blue-900', border: 'border-blue-500', text: 'text-blue-100' },
};

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

export default function Toast() {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return onToast((event) => {
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { ...event, id }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
      }, event.duration);
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-[90%] max-w-md flex flex-col gap-2">
      {toasts.map(toast => {
        const s = STYLES[toast.type];
        return (
          <div
            key={toast.id}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className={`${s.bg} border ${s.border} ${s.text} px-4 py-3 rounded-lg shadow-lg flex items-start gap-3 animate-[slideDown_0.3s_ease-out]`}
          >
            <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">{ICONS[toast.type]}</span>
            <p className="flex-1 text-sm font-medium whitespace-pre-line">{toast.message}</p>
            <button
              onClick={() => dismiss(toast.id)}
              className="flex-shrink-0 opacity-70 hover:opacity-100 text-lg leading-none"
              aria-label={t('common.close')}
              style={{ minWidth: '32px', minHeight: '32px' }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
