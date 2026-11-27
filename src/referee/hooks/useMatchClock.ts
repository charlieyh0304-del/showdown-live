import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { speak } from '@shared/utils/locale';
import { vibrate } from '@shared/utils/haptic';
import { serverNow, useServerNow } from '@shared/utils/serverTime';
import type { ScoringRuleSet } from '@shared/rules/competitionRules';
import {
  clockFrom,
  clockRemainingMs,
  crossedMilestones,
  isClockRunning,
  pauseClockManually,
  reconcileClock,
  resumeClockManually,
  startClock,
  timeLimitOf,
  type ClockContext,
  type ClockPauseReason,
  type MatchClock,
} from '@shared/rules/timeLimit';
import { syncClockToRules } from './timeLimitModel';
import { playWarningBeep } from './useCountdownTimer';
import { formatClock } from '@shared/utils/matchClockFormat';

interface MatchClockDeps {
  match: { status?: string; currentSet?: number; clock?: unknown } | null;
  rules: ScoringRuleSet;
  /** 지금 시계를 자동으로 멈출 이유 (timeLimitModel.clockAutoPauseReason) */
  autoPause: ClockPauseReason | null;
  updateMatch: (data: Record<string, unknown>) => Promise<boolean | undefined>;
  setLastAction: (s: string) => void;
  setAnnouncement: (s: string) => void;
  /** 시간이 끝났다 (흐르던 시계가 0이 됨). 호출자가 세트/경기/골든골을 처리한다. */
  onExpire: () => void;
}

/**
 * 심판 화면의 경기 시계 (M0f). 시계 상태는 match.clock에 저장한다(새로고침·다른 기기·오프라인 큐에서 이어짐).
 * - 사이드 체인지·타임아웃·워밍업·세트 종료 확인 동안 자동으로 멈추고 끝나면 다시 흐른다(reconcileClock).
 * - 5분·1분·30초 남음과 종료를 화면 문구 + 진동 + 경고음 + 음성(speak: 음성 안내 설정을 따른다) + aria-live로 알린다.
 * - 쓰기는 시작·정지·재개·만료 때만 한다. 남은 시간은 매 순간 서버 시각으로 계산한다.
 */
export function useMatchClock({ match, rules, autoPause, updateMatch, setLastAction, setAnnouncement, onExpire }: MatchClockDeps) {
  const { t } = useTranslation();
  const cfg = useMemo(() => timeLimitOf(rules), [rules]);
  const inProgress = match?.status === 'in_progress';
  const clock = useMemo(() => clockFrom(match?.clock), [match?.clock]);
  const ctx: ClockContext = useMemo(() => ({ autoPause, inProgress }), [autoPause, inProgress]);
  const active = cfg.enabled && inProgress;
  const now = useServerNow(active && !!clock && isClockRunning(clock));
  const remainingMs = clock ? clockRemainingMs(clock, now) : cfg.limitMs;

  const notify = useCallback((msg: string, pattern: number | number[]) => {
    setLastAction(`⏱️ ${msg}`);
    setAnnouncement(msg);
    speak(msg);
    vibrate(pattern);
    playWarningBeep();
  }, [setLastAction, setAnnouncement]);

  // 시계 만들기 / 규칙 변경 반영
  const lastWrite = useRef('');
  const write = useCallback((next: MatchClock) => {
    const key = JSON.stringify(next);
    if (key === lastWrite.current) return;
    lastWrite.current = key;
    void updateMatch({ clock: next });
  }, [updateMatch]);

  useEffect(() => {
    if (!active) return;
    const synced = syncClockToRules(match?.clock, cfg, match?.currentSet ?? 0);
    if (synced) write(synced);
  }, [active, cfg, match?.clock, match?.currentSet, write]);

  // 자동 정지·재개 (사이드 체인지·타임아웃·워밍업·세트 종료, 경기 종료)
  useEffect(() => {
    if (!cfg.enabled || !clock) return;
    const next = reconcileClock(clock, ctx, serverNow());
    if (next) write(next);
  }, [cfg.enabled, clock, ctx, write]);

  // 남은 시간 알림 + 만료
  const prevRemaining = useRef<number | null>(null);
  const expiredFor = useRef('');
  useEffect(() => {
    if (!active || !clock) { prevRemaining.current = null; return; }
    const running = isClockRunning(clock);
    const crossed = running ? crossedMilestones(prevRemaining.current, remainingMs) : [];
    prevRemaining.current = running ? remainingMs : null;
    for (const m of crossed) {
      if (m === 5 * 60_000) notify(t('common.matchClock.alert5min'), [200, 100, 200]);
      else if (m === 60_000) notify(t('common.matchClock.alert1min'), [200, 100, 200, 100, 200]);
      else if (m === 30_000) notify(t('common.matchClock.alert30s'), [300, 100, 300]);
    }
    const key = `${clock.setIndex}`;
    if (running && remainingMs <= 0 && !clock.expired && expiredFor.current !== key) {
      expiredFor.current = key;
      vibrate([500, 200, 500]);
      onExpire();
    }
    if (!clock.expired && remainingMs > 0) expiredFor.current = '';
  }, [active, clock, remainingMs, notify, onExpire, t]);

  const start = useCallback(() => {
    if (!clock || clock.started) return;
    write(startClock(clock, ctx, serverNow()));
    const msg = t('common.matchClock.startedMsg', { time: formatClock(Math.ceil(remainingMs / 1000)) });
    setLastAction(`⏱️ ${msg}`);
    setAnnouncement(msg);
    speak(msg);
  }, [clock, ctx, remainingMs, t, write, setLastAction, setAnnouncement]);

  const pause = useCallback((note?: string) => {
    if (!clock || !clock.started || clock.manualPause || clock.expired) return;
    write(pauseClockManually(clock, serverNow(), note?.trim() || undefined));
    const msg = t('common.matchClock.pausedMsg');
    setLastAction(`⏸️ ${msg}`);
    setAnnouncement(msg);
    speak(msg);
  }, [clock, t, write, setLastAction, setAnnouncement]);

  const resume = useCallback(() => {
    if (!clock || !clock.manualPause) return;
    write(resumeClockManually(clock, ctx, serverNow()));
    const msg = t('common.matchClock.resumedMsg');
    setLastAction(`▶️ ${msg}`);
    setAnnouncement(msg);
    speak(msg);
  }, [clock, ctx, t, write, setLastAction, setAnnouncement]);

  return {
    enabled: cfg.enabled,
    cfg,
    clock,
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    running: !!clock && isClockRunning(clock),
    goldenPhase: clock?.goldenGoal ?? null,
    start, pause, resume,
  };
}

export type MatchClockState = ReturnType<typeof useMatchClock>;
