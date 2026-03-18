interface ModeBadgeProps {
  mode: 'admin' | 'referee' | 'spectator' | 'practice';
}

const CONFIG = {
  admin: { label: '관리자 모드', bg: '#422006', color: '#ffff00', border: '#ffff00' },
  referee: { label: '심판 모드', bg: '#042f2e', color: '#00ffff', border: '#00ffff' },
  spectator: { label: '관람 모드', bg: '#052e16', color: '#00ff00', border: '#00ff00' },
  practice: { label: '연습 모드', bg: '#2e1065', color: '#c084fc', border: '#7c3aed' },
};

export default function ModeBadge({ mode }: ModeBadgeProps) {
  const c = CONFIG[mode];

  return (
    <span
      role="status"
      aria-label={c.label}
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
      {c.label}
    </span>
  );
}
