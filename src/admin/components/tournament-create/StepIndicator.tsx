import { useTranslation } from 'react-i18next';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels: string[];
}

export default function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  const { t } = useTranslation();
  return (
    <div
      role="progressbar"
      aria-valuenow={currentStep}
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-label={t('admin.tournamentCreate.stepProgress', { current: currentStep, total: totalSteps, label: labels[currentStep - 1] || '' })}
    >
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: '8px',
              borderRadius: '4px',
              backgroundColor: i < currentStep ? '#ffff00' : '#374151',
              transition: 'background-color 0.3s',
            }}
            aria-hidden="true"
          />
        ))}
      </div>
      <p className="text-sm text-gray-400 text-center">
        {t('admin.tournamentCreate.stepLabel', { step: currentStep, label: labels[currentStep - 1] || '' })}
      </p>
    </div>
  );
}
