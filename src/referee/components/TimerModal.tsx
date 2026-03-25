import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface TimerModalProps {
  title: string;
  seconds: number;
  isWarning: boolean;
  subtitle?: string;
  onClose: () => void;
  closeLabel?: string;
}

export default function TimerModal({ title, seconds, isWarning, subtitle, onClose, closeLabel }: TimerModalProps) {
  const { t } = useTranslation();
  const effectiveCloseLabel = closeLabel || t('common.close');
  const trapRef = useFocusTrap(true, onClose);

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const display = minutes > 0
    ? `${minutes}:${secs.toString().padStart(2, '0')}`
    : `${seconds}`;

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
        <button className="btn btn-danger btn-large" onClick={onClose} aria-label={effectiveCloseLabel}>
          {effectiveCloseLabel}
        </button>
      </div>
    </div>
  );
}
