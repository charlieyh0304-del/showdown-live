import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { speak } from '@shared/utils/locale';

interface GoldenGoalAnnouncementDeps {
  goldenGoalActive: boolean;
  matchStatus: string | undefined;
  matchGoldenGoalActive: boolean | undefined;
  updateMatch: (data: Record<string, unknown>) => Promise<boolean | undefined>;
  setLastAction: (s: string) => void;
  setAnnouncement: (s: string) => void;
  longWhistle: () => void;
}

/**
 * One-time golden goal activation announcement + Firebase flag sync.
 * Extracted from useIndividualScoring / useTeamMatchScoring to eliminate duplication.
 */
export function useGoldenGoalAnnouncement({
  goldenGoalActive,
  matchStatus,
  matchGoldenGoalActive,
  updateMatch,
  setLastAction,
  setAnnouncement,
  longWhistle,
}: GoldenGoalAnnouncementDeps) {
  const { t } = useTranslation();
  const announced = useRef(false);

  useEffect(() => {
    if (!goldenGoalActive) {
      announced.current = false;
      return;
    }
    if (announced.current) return;
    if (matchStatus !== 'in_progress') return;
    announced.current = true;
    const msg = t('referee.scoring.goldenGoalActivated');
    setLastAction(`⏱️ ${msg}`);
    setAnnouncement(msg);
    speak(msg);
    longWhistle();
    if (!matchGoldenGoalActive) updateMatch({ goldenGoalActive: true });
  }, [goldenGoalActive, matchStatus, matchGoldenGoalActive]);
}
