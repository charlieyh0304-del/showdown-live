import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScoreActionType } from '@shared/types';

const FOUL_TYPES: { type: ScoreActionType; labelKey: string }[] = [
  { type: 'irregular_serve', labelKey: 'common.scoreActions.irregularServe' },
  { type: 'centerboard', labelKey: 'common.scoreActions.centerboard' },
  { type: 'body_touch', labelKey: 'common.scoreActions.bodyTouch' },
  { type: 'illegal_defense', labelKey: 'common.scoreActions.illegalDefense' },
  { type: 'out', labelKey: 'common.scoreActions.out' },
  { type: 'ball_holding', labelKey: 'common.scoreActions.ballHolding' },
];

interface FoulClassifyOverlayProps {
  playerName: string;
  onClassify: (type: ScoreActionType, label: string) => void;
  onDismiss: () => void;
  autoCloseMs?: number;
}

export default function FoulClassifyOverlay({
  playerName, onClassify, onDismiss, autoCloseMs = 4000,
}: FoulClassifyOverlayProps) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(Math.ceil(autoCloseMs / 1000));

  useEffect(() => {
    const timer = setTimeout(onDismiss, autoCloseMs);
    const countdown = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => { clearTimeout(timer); clearInterval(countdown); };
  }, [autoCloseMs, onDismiss]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/95 border-t-2 border-yellow-500 px-3 py-3 animate-slideUp">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-yellow-400">
          {playerName} {t('common.scoreActions.foul')} — {t('referee.scoring.classifyFoul')}
        </span>
        <button className="text-gray-400 text-xs px-2 py-1" onClick={onDismiss}>
          ✕ {remaining}s
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {FOUL_TYPES.map(f => (
          <button
            key={f.type}
            className="btn bg-yellow-900/70 hover:bg-yellow-800 text-yellow-200 text-xs py-2.5 px-1 rounded font-medium"
            onClick={() => onClassify(f.type, t(f.labelKey))}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
