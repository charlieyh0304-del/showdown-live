import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface TimerModalProps {
  title: string;
  seconds: number;
  isWarning: boolean;
  subtitle?: string;
  onClose: () => void;
  closeLabel?: string;
  /** If true, close button is hidden until timer reaches 0. Used for mandatory side changes. */
  required?: boolean;
}

export default function TimerModal({ title, seconds, isWarning, subtitle, onClose, closeLabel, required }: TimerModalProps) {
  const { t } = useTranslation();
  const effectiveCloseLabel = closeLabel || t('common.close');
  // If required, don't allow Escape to close
  const trapRef = useFocusTrap(true, required ? undefined : onClose);

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const display = minutes > 0
    ? `${minutes}:${secs.toString().padStart(2, '0')}`
    : `${seconds}`;

  const timerDone = seconds <= 0;

  return (
    <div className="modal-backdrop" style={{ zIndex: 100 }}>
      <div ref={trapRef} className="flex flex-col items-center gap-6 p-8" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="text-3xl font-bold text-yellow-400">{title}</h2>
        <div
          className={`text-8xl font-bold my-4 ${isWarning ? 'animate-pulse text-red-400' : 'text-white'}`}
          aria-live="polite"
          aria-label={t('common.time.remaining', { display })}
        >
          {display}
        </div>
        {subtitle && <p className="text-xl text-gray-300">{subtitle}</p>}
        {(!required || timerDone) && (
          <button className="btn btn-danger btn-large" onClick={onClose} aria-label={effectiveCloseLabel}>
            {effectiveCloseLabel}
          </button>
        )}
        {required && !timerDone && (
          <p className="text-sm text-gray-400" aria-live="polite">{t('common.time.waitForTimer')}</p>
        )}
      </div>
    </div>
  );
}
