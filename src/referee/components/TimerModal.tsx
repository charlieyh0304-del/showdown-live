interface TimerModalProps {
  title: string;
  seconds: number;
  isWarning: boolean;
  subtitle?: string;
  onClose: () => void;
  closeLabel?: string;
}

export default function TimerModal({ title, seconds, isWarning, subtitle, onClose, closeLabel = '닫기' }: TimerModalProps) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const display = minutes > 0
    ? `${minutes}:${secs.toString().padStart(2, '0')}`
    : `${seconds}`;

  return (
    <div className="modal-backdrop" style={{ zIndex: 100 }}>
      <div className="flex flex-col items-center gap-6 p-8">
        <h2 className="text-3xl font-bold text-yellow-400">{title}</h2>
        <div
          className={`text-8xl font-bold my-4 ${isWarning ? 'animate-pulse text-red-400' : 'text-white'}`}
          aria-live="polite"
        >
          {display}
        </div>
        {subtitle && <p className="text-xl text-gray-300">{subtitle}</p>}
        <button className="btn btn-danger btn-large" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
