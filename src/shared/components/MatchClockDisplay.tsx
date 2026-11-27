import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  clockFrom,
  clockRemainingMs,
  isClockRunning,
  type GoldenGoalPhase,
} from '@shared/rules/timeLimit';
import type { GoldenGoalMode } from '@shared/rules/competitionRules';
import { useServerNow } from '@shared/utils/serverTime';
import { clockStateKey, formatClock, nextClockAnnouncement, type ClockAnnounceState } from '@shared/utils/matchClockFormat';

interface Props {
  /** match.clock (DB 원본) */
  clock: unknown;
  /** 골든골 방식 (배너 문구) */
  goldenGoalMode?: GoldenGoalMode;
  /** 크게(심판) / 작게(관전 목록) */
  size?: 'large' | 'medium' | 'small';
  /**
   * 관전·중계 화면: 5분·1분·30초·종료·골든골 때만 aria-live(polite)로 알린다(매초 알리지 않는다).
   * 심판 화면은 훅(useMatchClock)이 알리므로 끈다.
   */
  announce?: boolean;
  /** 화면 낭독기용 경기 이름 (관전 목록에서 어느 경기인지) */
  matchLabel?: string;
}

/**
 * 경기 시계 표시 (M0f): 남은 시간 + 상태(진행·사이드 체인지·타임아웃·심판 정지·골든골).
 * 남은 시간은 role="timer"로 표시하고(매초 읽지 않음), 상태 문구는 함께 읽힌다.
 */
export default function MatchClockDisplay({ clock: raw, goldenGoalMode = 'next_point', size = 'medium', announce = false, matchLabel }: Props) {
  const { t } = useTranslation();
  const clock = clockFrom(raw);
  const running = !!clock && isClockRunning(clock);
  const now = useServerNow(running, 500);
  const remainingMs = clock ? clockRemainingMs(clock, now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const stateKey = clockStateKey(clock);
  const golden: GoldenGoalPhase | null = clock?.goldenGoal ?? null;

  // 관전: 알림 시점·종료·골든골 진입만 알린다 (판단은 nextClockAnnouncement)
  const [liveMsg, setLiveMsg] = useState('');
  const prevObs = useRef<ClockAnnounceState | null>(null);
  const expired = !!clock?.expired;
  useEffect(() => {
    if (!announce || !clock) { prevObs.current = null; return; }
    const { announce: what, state } = nextClockAnnouncement(prevObs.current, { remainingMs, running, expired, golden });
    prevObs.current = state;
    if (!what) return;
    const prefix = matchLabel ? `${matchLabel}. ` : '';
    const msg = what === 'golden' ? t(`common.matchClock.goldenRule.${goldenGoalMode}`) : t(`common.matchClock.${what}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveMsg(`${prefix}${msg}`);
  }, [announce, clock, running, remainingMs, expired, golden, goldenGoalMode, matchLabel, t]);

  if (!clock) return null;
  const display = formatClock(remainingSec);
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const stateText = stateKey === 'manual' && clock.manualPause?.note
    ? t('common.matchClock.state.manualWithNote', { note: clock.manualPause.note })
    : t(`common.matchClock.state.${stateKey}`);
  const timeClass = size === 'large' ? 'text-6xl' : size === 'medium' ? 'text-3xl' : 'text-lg';
  const warn = running && remainingMs <= 60_000;

  return (
    <div className="text-center">
      {golden ? (
        <div className="px-3 py-2 rounded-lg bg-red-700 text-white font-bold" role="status">
          <span aria-hidden="true">⏱️ </span>{golden === 'coin_toss' ? t('common.matchClock.state.goldenToss') : t(`common.matchClock.goldenRule.${goldenGoalMode}`)}
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <span className="text-sm text-gray-300">{t('common.matchClock.remaining')}</span>
          <span
            role="timer"
            aria-label={`${matchLabel ? `${matchLabel}, ` : ''}${t('common.matchClock.remainingAria', { min: mins, sec: secs })}, ${stateText}`}
            className={`${timeClass} font-mono font-bold ${warn ? 'text-red-400' : 'text-cyan-300'}`}
          >
            {display}
          </span>
          <span className={`text-sm ${running ? 'text-green-300' : 'text-yellow-300'}`} aria-hidden="true">{stateText}</span>
        </div>
      )}
      {announce && <span className="sr-only" aria-live="polite" aria-atomic="true">{liveMsg}</span>}
    </div>
  );
}
