import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { sendNotification } from '@shared/utils/notifications';
import type { Match, ScheduleSlot } from '@shared/types';

const NOTIFIED_KEY = 'showdown_notified_matches';

function loadNotified(): Set<string> {
  try {
    const stored = localStorage.getItem(NOTIFIED_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch { return new Set(); }
}

function saveNotified(notified: Set<string>) {
  try {
    // Keep only last 200 entries to prevent unbounded growth
    const arr = [...notified].slice(-200);
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(arr));
  } catch { /* ignore */ }
}

// Parse schedule time like "09:00" or "오전 09:00" to today's Date
function parseScheduleTime(timeStr: string, dateStr?: string): Date | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
  return d;
}

export function useMatchNotifications(
  favoriteIds: string[],
  matches: Match[],
  schedule: ScheduleSlot[],
) {
  const { t } = useTranslation();
  const notifiedRef = useRef<Set<string>>(loadNotified());

  useEffect(() => {
    if (favoriteIds.length === 0) return;

    const checkNotifications = () => {
      const now = Date.now();
      let changed = false;

      for (const match of matches) {
        const matchFavById = (id: string) =>
          id === match.player1Id || id === match.player2Id ||
          id === match.team1Id || id === match.team2Id;
        const matchFavByName = (id: string) =>
          id === match.player1Name || id === match.player2Name ||
          id === match.team1Name || id === match.team2Name;
        const isFavMatch = favoriteIds.some((id) => matchFavById(id) || matchFavByName(id));
        if (!isFavMatch) continue;

        const matchKey = match.id;

        // Match start notification (when status changes to in_progress)
        if (match.status === 'in_progress' && !notifiedRef.current.has(`start_${matchKey}`)) {
          notifiedRef.current.add(`start_${matchKey}`);
          changed = true;
          const favId = favoriteIds.find((id) => matchFavById(id) || matchFavByName(id));
          const isP1 = favId === match.player1Id || favId === match.player1Name || favId === match.team1Id || favId === match.team1Name;
          const favName = isP1 ? (match.player1Name || match.team1Name) : (match.player2Name || match.team2Name);
          const oppName = isP1 ? (match.player2Name || match.team2Name) : (match.player1Name || match.team1Name);
          sendNotification(
            t('spectator.notifications.matchStarted', { name: favName }),
            `vs ${oppName}${match.courtName ? ` (${match.courtName})` : ''}`,
            `start_${matchKey}`,
          );
        }

        // Match completion notification
        if (match.status === 'completed' && !notifiedRef.current.has(`result_${matchKey}`)) {
          notifiedRef.current.add(`result_${matchKey}`);
          changed = true;
          const favId = favoriteIds.find((id) => matchFavById(id) || matchFavByName(id));
          const isP1 = favId === match.player1Id || favId === match.player1Name || favId === match.team1Id || favId === match.team1Name;
          const favName = isP1 ? (match.player1Name || match.team1Name) : (match.player2Name || match.team2Name);
          const oppName = isP1 ? (match.player2Name || match.team2Name) : (match.player1Name || match.team1Name);
          const wonById = isP1 ? match.winnerId === match.player1Id || match.winnerId === match.team1Id : match.winnerId === match.player2Id || match.winnerId === match.team2Id;
          const scores = (match.sets || [])
            .map((s) => {
              const my = isP1 ? s.player1Score : s.player2Score;
              const opp = isP1 ? s.player2Score : s.player1Score;
              return `${my}-${opp}`;
            })
            .join(', ');

          sendNotification(
            `${favName} ${wonById ? t('spectator.notifications.win') : t('spectator.notifications.loss')}`,
            `vs ${oppName} (${scores})`,
            `result_${matchKey}`,
          );
        }

        // Pre-match notification (10 min before)
        if (match.status === 'pending' && !notifiedRef.current.has(`pre_${matchKey}`)) {
          // Check match scheduledTime directly, or from schedule slots
          const matchTime = match.scheduledTime
            ? parseScheduleTime(match.scheduledTime, match.scheduledDate)
            : (() => {
                const slot = schedule.find((s) => s.matchId === matchKey);
                return slot?.scheduledTime ? parseScheduleTime(slot.scheduledTime, slot.scheduledDate) : null;
              })();

          if (matchTime) {
            const diff = matchTime.getTime() - now;
            if (diff > 0 && diff <= 11 * 60 * 1000 && diff >= 9 * 60 * 1000) {
              notifiedRef.current.add(`pre_${matchKey}`);
              changed = true;
              const preFavId = favoriteIds.find((id) => matchFavById(id) || matchFavByName(id));
              const preIsP1 = preFavId === match.player1Id || preFavId === match.player1Name || preFavId === match.team1Id || preFavId === match.team1Name;
              const favName = preIsP1 ? (match.player1Name || match.team1Name) : (match.player2Name || match.team2Name);
              const oppName = preIsP1 ? (match.player2Name || match.team2Name) : (match.player1Name || match.team1Name);
              sendNotification(
                t('spectator.notifications.preMatch', { name: favName }),
                `vs ${oppName}${match.courtName ? ` (${match.courtName})` : ''}`,
                `pre_${matchKey}`,
              );
            }
          }
        }
      }

      if (changed) {
        saveNotified(notifiedRef.current);
      }
    };

    checkNotifications();
    const interval = setInterval(checkNotifications, 30000);
    return () => clearInterval(interval);
  }, [favoriteIds, matches, schedule, t]);
}
