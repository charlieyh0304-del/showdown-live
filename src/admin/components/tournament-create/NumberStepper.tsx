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
  return (
    <div>
      <label className="block mb-2 font-semibold text-lg">{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          className="btn btn-danger"
          style={{ width: '64px', height: '64px', fontSize: '2rem', flexShrink: 0 }}
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          aria-label={`${ariaLabel} 감소`}
        >
          -
        </button>
        <span
          style={{ fontSize: '2.5rem', fontWeight: 'bold', minWidth: '80px', textAlign: 'center' }}
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${ariaLabel}: ${value}`}
        >
          {value}
        </span>
        <button
          className="btn btn-success"
          style={{ width: '64px', height: '64px', fontSize: '2rem', flexShrink: 0 }}
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          aria-label={`${ariaLabel} 증가`}
        >
          +
        </button>
      </div>
    </div>
  );
}
