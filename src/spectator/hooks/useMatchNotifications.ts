import { useEffect, useRef } from 'react';
import { sendNotification } from '@shared/utils/notifications';
import type { Match, ScheduleSlot } from '@shared/types';

// Parse schedule time like "09:00" or "오전 09:00" to today's Date
function parseScheduleTime(timeStr: string): Date | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const d = new Date();
  d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
  return d;
}

export function useMatchNotifications(
  favoriteIds: string[],
  matches: Match[],
  schedule: ScheduleSlot[],
) {
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (favoriteIds.length === 0) return;

    const checkNotifications = () => {
      const now = Date.now();

      for (const match of matches) {
        const isFavMatch = favoriteIds.some(
          (id) => id === match.player1Id || id === match.player2Id,
        );
        if (!isFavMatch) continue;

        const matchKey = match.id;

        // Match completion notification
        if (match.status === 'completed' && !notifiedRef.current.has(`result_${matchKey}`)) {
          notifiedRef.current.add(`result_${matchKey}`);
          const favId = favoriteIds.find(
            (id) => id === match.player1Id || id === match.player2Id,
          );
          const favName = favId === match.player1Id ? match.player1Name : match.player2Name;
          const oppName = favId === match.player1Id ? match.player2Name : match.player1Name;
          const won = match.winnerId === favId;
          const scores = (match.sets || [])
            .map((s) => {
              const my = favId === match.player1Id ? s.player1Score : s.player2Score;
              const opp = favId === match.player1Id ? s.player2Score : s.player1Score;
              return `${my}-${opp}`;
            })
            .join(', ');

          sendNotification(
            `${favName} ${won ? '승리!' : '패배'}`,
            `vs ${oppName} (${scores})`,
            `result_${matchKey}`,
          );
        }

        // Pre-match notification (10 min before)
        if (match.status === 'pending' && !notifiedRef.current.has(`pre_${matchKey}`)) {
          const slot = schedule.find((s) => s.matchId === matchKey);
          if (slot?.scheduledTime) {
            const matchTime = parseScheduleTime(slot.scheduledTime);
            if (matchTime) {
              const diff = matchTime.getTime() - now;
              // Between 9-11 minutes before (check window)
              if (diff > 0 && diff <= 11 * 60 * 1000 && diff >= 9 * 60 * 1000) {
                notifiedRef.current.add(`pre_${matchKey}`);
                const favId = favoriteIds.find(
                  (id) => id === match.player1Id || id === match.player2Id,
                );
                const favName =
                  favId === match.player1Id ? match.player1Name : match.player2Name;
                const oppName =
                  favId === match.player1Id ? match.player2Name : match.player1Name;
                sendNotification(
                  `${favName} 경기 10분 전`,
                  `vs ${oppName}${slot.courtName ? ` (${slot.courtName})` : ''}`,
                  `pre_${matchKey}`,
                );
              }
            }
          }
        }
      }
    };

    // Check immediately and then every 30 seconds
    checkNotifications();
    const interval = setInterval(checkNotifications, 30000);
    return () => clearInterval(interval);
  }, [favoriteIds, matches, schedule]);
}
