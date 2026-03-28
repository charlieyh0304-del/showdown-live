import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { sendNotification } from '@shared/utils/notifications';
import { shouldNotify, type NotificationSettings } from '@shared/hooks/useNotificationSettings';
import { addNotificationToHistory } from '@shared/hooks/useNotificationHistory';
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
    const arr = [...notified].slice(-200);
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(arr));
  } catch { /* ignore */ }
}

function parseScheduleTime(timeStr: string, dateStr?: string): Date | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
  return d;
}

function getMatchFavInfo(match: Match, favoriteIds: string[]) {
  const matchFavById = (id: string) =>
    id === match.player1Id || id === match.player2Id ||
    id === match.team1Id || id === match.team2Id;
  const matchFavByName = (id: string) =>
    id === match.player1Name || id === match.player2Name ||
    id === match.team1Name || id === match.team2Name;

  const favId = favoriteIds.find((id) => matchFavById(id) || matchFavByName(id));
  if (!favId) return null;

  const isP1 = favId === match.player1Id || favId === match.player1Name ||
    favId === match.team1Id || favId === match.team1Name;
  const favName = isP1
    ? (match.player1Name || match.team1Name || favId)
    : (match.player2Name || match.team2Name || favId);
  const oppName = isP1
    ? (match.player2Name || match.team2Name || '')
    : (match.player1Name || match.team1Name || '');

  return { favId, isP1, favName, oppName };
}

export function useMatchNotifications(
  favoriteIds: string[],
  matches: Match[],
  schedule: ScheduleSlot[],
  notifSettings?: NotificationSettings,
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
        const info = getMatchFavInfo(match, favoriteIds);
        if (!info) continue;

        // Match start notification
        if (match.status === 'in_progress' && !notifiedRef.current.has(`start_${matchKey}`)) {
          if (!notifSettings || shouldNotify(notifSettings, info.favId, 'matchStart')) {
            notifiedRef.current.add(`start_${matchKey}`);
            changed = true;
            const title = t('spectator.notifications.matchStarted', { name: info.favName });
            const body = `vs ${info.oppName}${match.courtName ? ` (${match.courtName})` : ''}`;
            sendNotification(title, body, `start_${matchKey}`);
            addNotificationToHistory({
              type: 'matchStart',
              title,
              body,
              playerName: info.favName || '',
              playerId: info.favId,
              matchId: matchKey,
              tournamentId: match.tournamentId,
            });
          }
        }

        // Match completion notification
        if (match.status === 'completed' && !notifiedRef.current.has(`result_${matchKey}`)) {
          if (!notifSettings || shouldNotify(notifSettings, info.favId, 'matchComplete')) {
            notifiedRef.current.add(`result_${matchKey}`);
            changed = true;
            const wonById = info.isP1
              ? match.winnerId === match.player1Id || match.winnerId === match.team1Id
              : match.winnerId === match.player2Id || match.winnerId === match.team2Id;
            const scores = (match.sets || [])
              .map((s) => {
                const my = info.isP1 ? s.player1Score : s.player2Score;
                const opp = info.isP1 ? s.player2Score : s.player1Score;
                return `${my}-${opp}`;
              })
              .join(', ');
            const title = `${info.favName} ${wonById ? t('spectator.notifications.win') : t('spectator.notifications.loss')}`;
            const body = `vs ${info.oppName} (${scores})`;
            sendNotification(title, body, `result_${matchKey}`);
            addNotificationToHistory({
              type: 'matchComplete',
              title,
              body,
              playerName: info.favName || '',
              playerId: info.favId,
              matchId: matchKey,
              tournamentId: match.tournamentId,
            });
          }
        }

        // Pre-match notification (10 min before)
        if (match.status === 'pending' && !notifiedRef.current.has(`pre_${matchKey}`)) {
          const matchTime = match.scheduledTime
            ? parseScheduleTime(match.scheduledTime, match.scheduledDate)
            : (() => {
                const slot = schedule.find((s) => s.matchId === matchKey);
                return slot?.scheduledTime ? parseScheduleTime(slot.scheduledTime, slot.scheduledDate) : null;
              })();

          if (matchTime) {
            const diff = matchTime.getTime() - now;
            if (diff > 0 && diff <= 10.5 * 60 * 1000) {
              if (!notifSettings || shouldNotify(notifSettings, info.favId, 'preMatch')) {
                notifiedRef.current.add(`pre_${matchKey}`);
                changed = true;
                const title = t('spectator.notifications.preMatch', { name: info.favName });
                const body = `vs ${info.oppName}${match.courtName ? ` (${match.courtName})` : ''}`;
                sendNotification(title, body, `pre_${matchKey}`);
                addNotificationToHistory({
                  type: 'preMatch',
                  title,
                  body,
                  playerName: info.favName || '',
                  playerId: info.favId,
                  matchId: matchKey,
                  tournamentId: match.tournamentId,
                });
              }
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
  }, [favoriteIds, matches, schedule, t, notifSettings]);
}
