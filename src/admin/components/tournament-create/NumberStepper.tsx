import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}

export default function NumberStepper({ label, value, min, max, step = 1, onChange, ariaLabel }: NumberStepperProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleCommit = () => {
    const num = parseInt(editValue, 10);
    if (!isNaN(num)) {
      onChange(Math.max(min, Math.min(max, num)));
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCommit();
    if (e.key === 'Escape') {
      setEditValue(String(value));
      setIsEditing(false);
    }
  };

  return (
    <div>
      <label className="block mb-2 font-semibold text-lg text-center">{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <button
          className="btn btn-danger"
          style={{ width: '64px', height: '64px', fontSize: '2rem', flexShrink: 0 }}
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          aria-label={t('common.numberStepper.decrease', { label: ariaLabel })}
        >
          -
        </button>

        {isEditing ? (
          <input
            ref={inputRef}
            type="number"
            style={{ fontSize: '2.5rem', fontWeight: 'bold', width: '100px', height: '64px', textAlign: 'center' }}
            className="input"
            value={editValue}
            min={min}
            max={max}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={handleKeyDown}
            aria-label={t('common.numberStepper.directInput', { label: ariaLabel })}
          />
        ) : (
          <button
            type="button"
            style={{ fontSize: '2.5rem', fontWeight: 'bold', minWidth: '100px', height: '64px', textAlign: 'center', cursor: 'text', background: 'rgba(255,255,255,0.1)', border: '1px solid transparent', borderRadius: '8px', color: 'inherit' }}
            onClick={() => {
              setEditValue(String(value));
              setIsEditing(true);
            }}
            aria-live="polite"
            aria-atomic="true"
            aria-label={t('common.numberStepper.clickToEdit', { label: ariaLabel, value })}
          >
            {value}
          </button>
        )}

        <button
          className="btn btn-success"
          style={{ width: '64px', height: '64px', fontSize: '2rem', flexShrink: 0 }}
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          aria-label={t('common.numberStepper.increase', { label: ariaLabel })}
        >
          +
        </button>
      </div>
    </div>
  );
}
