import { useEffect } from 'react';

/**
 * Saves/clears active match in localStorage for session recovery.
 * Extracted from useIndividualScoring / useTeamMatchScoring to eliminate duplication.
 */
export function useActiveMatchRecovery(
  matchStatus: string | undefined,
  tournamentId: string | undefined,
  matchId: string | undefined,
) {
  useEffect(() => {
    if (matchStatus === 'in_progress') {
      localStorage.setItem('showdown_active_match', JSON.stringify({ tournamentId, matchId }));
    }
    if (matchStatus === 'completed') {
      localStorage.removeItem('showdown_active_match');
    }
  }, [matchStatus, tournamentId, matchId]);
}
