import { useEffect } from 'react';

interface CountdownTimer {
  isRunning: boolean;
  start: (seconds: number) => void;
  stop: () => void;
}

interface TimerSyncDeps {
  sideChangeTimer: CountdownTimer;
  timeoutTimer: CountdownTimer;
  sideChangeStartTime: number | null | undefined;
  sideChangeDismissed: boolean;
  activeTimeout: { startTime: number; type?: string } | null | undefined;
  updateMatch: (data: Record<string, unknown>) => Promise<boolean | undefined>;
  setSideChangeDismissed: (v: boolean) => void;
}

/**
 * Syncs sideChange and timeout countdown timers from Firebase timestamps.
 * Extracted from useIndividualScoring / useTeamMatchScoring to eliminate duplication.
 */
export function useTimerSync({
  sideChangeTimer,
  timeoutTimer,
  sideChangeStartTime,
  sideChangeDismissed,
  activeTimeout,
  updateMatch,
  setSideChangeDismissed,
}: TimerSyncDeps) {
  // Sync sideChange timer from Firebase
  useEffect(() => {
    if (sideChangeStartTime) {
      if (sideChangeDismissed) {
        updateMatch({ sideChangeStartTime: null });
        return;
      }
      const elapsed = Math.floor((Date.now() - sideChangeStartTime) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      if (remaining > 0 && !sideChangeTimer.isRunning) sideChangeTimer.start(remaining);
      else if (remaining <= 0) updateMatch({ sideChangeStartTime: null });
    } else {
      sideChangeTimer.stop();
      setSideChangeDismissed(false);
    }
  }, [sideChangeStartTime, sideChangeDismissed]);

  // Sync timeout timer from Firebase
  useEffect(() => {
    if (activeTimeout) {
      const type = activeTimeout.type ?? 'player';
      if (type === 'referee') {
        timeoutTimer.stop();
      } else {
        const duration = type === 'medical' ? 300 : 60;
        const elapsed = Math.floor((Date.now() - activeTimeout.startTime) / 1000);
        const remaining = Math.max(0, duration - elapsed);
        if (remaining > 0 && !timeoutTimer.isRunning) {
          timeoutTimer.start(remaining);
        } else if (remaining <= 0) {
          timeoutTimer.stop();
          updateMatch({ activeTimeout: null });
        }
      }
    } else {
      timeoutTimer.stop();
    }
  }, [activeTimeout]);
}
