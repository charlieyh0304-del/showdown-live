import { useTranslation } from 'react-i18next';

interface ModeBadgeProps {
  mode: 'admin' | 'referee' | 'spectator' | 'practice';
}

const STYLE_CONFIG = {
  admin: { bg: '#422006', color: '#ffff00', border: '#ffff00' },
  referee: { bg: '#042f2e', color: '#00ffff', border: '#00ffff' },
  spectator: { bg: '#052e16', color: '#00ff00', border: '#00ff00' },
  practice: { bg: '#2e1065', color: '#c084fc', border: '#7c3aed' },
};

export default function ModeBadge({ mode }: ModeBadgeProps) {
  const { t } = useTranslation();
  const c = STYLE_CONFIG[mode];
  const label = t(`common.modeBadge.${mode}`);

  return (
    <span
      aria-hidden="true"
      style={{
        backgroundColor: c.bg,
        color: c.color,
        border: `2px solid ${c.border}`,
        padding: '0.25rem 0.75rem',
        borderRadius: '9999px',
        fontWeight: 'bold',
        fontSize: '0.875rem',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
