import { crossedMilestones, isClockRunning, type GoldenGoalPhase, type MatchClock } from '@shared/rules/timeLimit';

/** 남은 초 → "m:ss" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 시계 상태 문구 키 (common.matchClock.state.*) */
export function clockStateKey(c: MatchClock | null): string {
  if (!c) return 'notStarted';
  if (c.goldenGoal === 'coin_toss') return 'goldenToss';
  if (c.goldenGoal === 'playing') return 'golden';
  if (c.expired) return 'expired';
  if (!c.started) return 'notStarted';
  if (isClockRunning(c)) return 'running';
  if (c.manualPause) return 'manual';
  return c.autoPause ?? 'paused';
}

/** 관전 화면 시계 알림을 정하는 데 쓰는 직전 관찰 */
export interface ClockAnnounceState {
  /** 흐르던 중이면 남은 시간(ms), 멈췄으면 null */
  remainingMs: number | null;
  expired: boolean;
  golden: GoldenGoalPhase | null;
  /** 이 시계의 종료를 이미 알렸다 (두 번 알리지 않는다) */
  endAnnounced: boolean;
}

export type ClockAnnouncement = 'alert5min' | 'alert1min' | 'alert30s' | 'expired' | 'golden';

/**
 * 관전 화면에서 알릴 것 (없으면 null)과 다음 관찰 상태.
 * - 첫 관찰(prev 없음, 새로고침)에는 알리지 않는다.
 * - 5분·1분·30초는 흐르는 동안 그 시점을 지날 때 한 번 알린다.
 * - 종료는 이 화면이 0을 보았을 때, 또는 0을 보기 전에 심판 기기의 만료(expired)가 먼저 와도 알린다. 한 번만 알린다.
 * - 골든골에 들어가면(동점 만료) 종료 대신 골든골을 알린다.
 */
export function nextClockAnnouncement(
  prev: ClockAnnounceState | null,
  obs: { remainingMs: number; running: boolean; expired: boolean; golden: GoldenGoalPhase | null },
): { announce: ClockAnnouncement | null; state: ClockAnnounceState } {
  const reset = !obs.expired && obs.remainingMs > 0;
  const state: ClockAnnounceState = {
    remainingMs: obs.running ? obs.remainingMs : null,
    expired: obs.expired,
    golden: obs.golden,
    endAnnounced: reset ? false : (prev?.endAnnounced ?? obs.expired),
  };
  if (!prev) return { announce: null, state };
  if (obs.golden && obs.golden !== prev.golden) {
    state.endAnnounced = true;
    return { announce: 'golden', state };
  }
  const crossed = obs.running ? crossedMilestones(prev.remainingMs, obs.remainingMs) : [];
  const m = crossed[crossed.length - 1];
  const end = m === 0 || (obs.expired && !prev.expired);
  if (end) {
    if (prev.endAnnounced) return { announce: null, state };
    state.endAnnounced = true;
    return { announce: 'expired', state };
  }
  if (m === 5 * 60_000) return { announce: 'alert5min', state };
  if (m === 60_000) return { announce: 'alert1min', state };
  if (m === 30_000) return { announce: 'alert30s', state };
  return { announce: null, state };
}
