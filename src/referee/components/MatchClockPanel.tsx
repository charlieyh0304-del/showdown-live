import { useTranslation } from 'react-i18next';
import MatchClockDisplay from '@shared/components/MatchClockDisplay';
import { showPrompt } from '@shared/utils/confirm';
import type { MatchClockState } from '../hooks/useMatchClock';

interface Props {
  clock: MatchClockState;
  /** match.clock (DB 원본) */
  rawClock: unknown;
  side1Name: string;
  side2Name: string;
  onGoldenCoinToss: (server: 'player1' | 'player2') => void;
}

/**
 * 심판 화면의 경기 시계 (시간 제한 경기, M0f).
 * 큰 남은 시간, 상태(진행·사이드 체인지·타임아웃·심판 정지), 시작/멈춤/다시 시작, 골든골 동전 던지기.
 * 알림(5분·1분·30초·종료)은 useMatchClock이 화면 낭독기·음성·진동으로 알린다.
 */
export default function MatchClockPanel({ clock, rawClock, side1Name, side2Name, onGoldenCoinToss }: Props) {
  const { t } = useTranslation();
  if (!clock.enabled || !clock.clock) return null;
  const c = clock.clock;
  const minutes = Math.round(clock.cfg.limitMs / 60_000);
  const unitText = t(clock.cfg.unit === 'per_set' ? 'common.matchClock.unitPerSet' : 'common.matchClock.unitPerMatch', { min: minutes });

  if (clock.goldenPhase === 'coin_toss') {
    return (
      <section className="mx-4 mt-2 p-4 rounded-lg bg-red-900/60 border-2 border-red-500 space-y-3" aria-labelledby="golden-toss-title">
        <h2 id="golden-toss-title" className="text-xl font-bold text-white text-center">
          <span aria-hidden="true">🪙 </span>{t('common.matchClock.goldenToss.title')}
        </h2>
        <p id="golden-toss-help" className="text-gray-100 text-center">{t('common.matchClock.goldenToss.help')}</p>
        <p className="text-yellow-200 text-center text-sm">{t(`common.matchClock.goldenRule.${clock.cfg.goldenGoalMode}`)}</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn btn-primary py-4 font-bold" aria-describedby="golden-toss-help" onClick={() => onGoldenCoinToss('player1')}>
            {t('common.matchClock.goldenToss.serve', { name: side1Name })}
          </button>
          <button type="button" className="btn btn-primary py-4 font-bold" aria-describedby="golden-toss-help" onClick={() => onGoldenCoinToss('player2')}>
            {t('common.matchClock.goldenToss.serve', { name: side2Name })}
          </button>
        </div>
        <button type="button" className="btn btn-secondary w-full" onClick={() => onGoldenCoinToss(Math.random() < 0.5 ? 'player1' : 'player2')}>
          {t('common.matchClock.goldenToss.random')}
        </button>
      </section>
    );
  }

  return (
    <section className="mx-4 mt-2 p-3 rounded-lg bg-gray-800 space-y-2" aria-label={t('common.matchClock.title')}>
      <MatchClockDisplay clock={rawClock} goldenGoalMode={clock.cfg.goldenGoalMode} size="large" />
      <p className="text-xs text-gray-400 text-center">{unitText}</p>
      {!c.expired && !c.goldenGoal && (
        <div className="flex gap-2 justify-center">
          {!c.started && (
            <button type="button" className="btn btn-success flex-1 py-3 font-bold" onClick={clock.start}>
              <span aria-hidden="true">▶️ </span>{t('common.matchClock.start')}
            </button>
          )}
          {c.started && !c.manualPause && (
            <button
              type="button"
              className="btn bg-yellow-700 hover:bg-yellow-600 text-white flex-1 py-3 font-bold"
              onClick={async () => {
                const note = await showPrompt({ message: t('common.matchClock.pausePrompt'), placeholder: t('common.matchClock.pausePlaceholder') });
                if (note === null) return;
                clock.pause(note);
              }}
            >
              <span aria-hidden="true">⏸️ </span>{t('common.matchClock.pause')}
            </button>
          )}
          {c.manualPause && (
            <button type="button" className="btn btn-success flex-1 py-3 font-bold" onClick={clock.resume}>
              <span aria-hidden="true">▶️ </span>{t('common.matchClock.resume')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
