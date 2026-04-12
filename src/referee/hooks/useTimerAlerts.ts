import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { speak } from '@shared/utils/locale';
import { playWarningBeep } from './useCountdownTimer';

interface TimerAlertsDeps {
  timeoutTimer: { seconds: number; isRunning: boolean };
  sideChangeTimer: { seconds: number; isRunning: boolean };
  activeTimeout: unknown;
  sideChangeStartTime: number | null | undefined;
  setLastAction: (s: string) => void;
  setAnnouncement: (s: string) => void;
}

/**
 * Shared 15-second warning effects for timeout and sideChange timers.
 * Extracted from useIndividualScoring / useTeamMatchScoring to eliminate duplication.
 */
export function useTimerAlerts({
  timeoutTimer,
  sideChangeTimer,
  activeTimeout,
  sideChangeStartTime,
  setLastAction,
  setAnnouncement,
}: TimerAlertsDeps) {
  const { t } = useTranslation();

  // 15초 안내 (타임아웃)
  const timeoutAlerted = useRef(false);
  useEffect(() => {
    if (!timeoutTimer.isRunning || !activeTimeout) {
      timeoutAlerted.current = false;
      return;
    }
    if (timeoutTimer.seconds === 15 && !timeoutAlerted.current) {
      timeoutAlerted.current = true;
      playWarningBeep();
      setLastAction(`⚠️ ${t('referee.scoring.fifteenSecondsLeft')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [timeoutTimer.seconds, timeoutTimer.isRunning, activeTimeout]);

  // 15초 안내 (사이드 체인지)
  const sideChangeAlerted = useRef(false);
  useEffect(() => {
    if (!sideChangeTimer.isRunning || !sideChangeStartTime) {
      sideChangeAlerted.current = false;
      return;
    }
    if (sideChangeTimer.seconds === 15 && !sideChangeAlerted.current) {
      sideChangeAlerted.current = true;
      playWarningBeep();
      setLastAction(`⚠️ ${t('referee.scoring.sideChangeFifteenSeconds')}`);
      setAnnouncement(t('referee.scoring.fifteenSecondsLeft'));
      speak(t('referee.scoring.fifteenSecondsLeft'));
    }
  }, [sideChangeTimer.seconds, sideChangeTimer.isRunning, sideChangeStartTime]);
}
