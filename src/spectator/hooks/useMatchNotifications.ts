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

function getMatchFavInfo(match: Match, favoriteIds: string[]) {
  // Build full participant set including team members
  const m = match as unknown as { team1?: { memberIds?: string[]; memberNames?: string[] }; team2?: { memberIds?: string[]; memberNames?: string[] } };
  const team1MemberIds = m.team1?.memberIds || [];
  const team1MemberNames = m.team1?.memberNames || [];
  const team2MemberIds = m.team2?.memberIds || [];
  const team2MemberNames = m.team2?.memberNames || [];

  const matchFavById = (id: string) =>
    id === match.player1Id || id === match.player2Id ||
    id === match.team1Id || id === match.team2Id ||
    team1MemberIds.includes(id) || team2MemberIds.includes(id);
  const matchFavByName = (id: string) =>
    id === match.player1Name || id === match.player2Name ||
    id === match.team1Name || id === match.team2Name ||
    team1MemberNames.includes(id) || team2MemberNames.includes(id);

  const favId = favoriteIds.find((id) => matchFavById(id) || matchFavByName(id));
  if (!favId) return null;

  const isP1 = favId === match.player1Id || favId === match.player1Name ||
    favId === match.team1Id || favId === match.team1Name ||
    team1MemberIds.includes(favId) || team1MemberNames.includes(favId);
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
  pushEnabled = false,
) {
  const { t } = useTranslation();
  const notifiedRef = useRef<Set<string>>(loadNotified());

  useEffect(() => {
    // FCM 푸시가 활성화된 경우 서버가 모든 알림을 처리하므로 클라이언트 알림 불필요
    if (favoriteIds.length === 0 || pushEnabled) return;

    const checkNotifications = () => {
      let changed = false;

      for (const match of matches) {
        const mm = match as unknown as { team1?: { memberIds?: string[]; memberNames?: string[] }; team2?: { memberIds?: string[]; memberNames?: string[] } };
        const t1m = mm.team1;
        const t2m = mm.team2;
        const matchFavById = (id: string) =>
          id === match.player1Id || id === match.player2Id ||
          id === match.team1Id || id === match.team2Id ||
          (t1m?.memberIds || []).includes(id) || (t2m?.memberIds || []).includes(id);
        const matchFavByName = (id: string) =>
          id === match.player1Name || id === match.player2Name ||
          id === match.team1Name || id === match.team2Name ||
          (t1m?.memberNames || []).includes(id) || (t2m?.memberNames || []).includes(id);
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
            const title = t('spectator.notifications.matchStarted', { favName: info.favName, oppName: info.oppName });
            const body = match.courtName ? `(${match.courtName})` : '';
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
            const title = `${info.favName} vs ${info.oppName} ${wonById ? t('spectator.notifications.win') : t('spectator.notifications.loss')}`;
            const body = scores;
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

        // Pre-match notification: 서버 FCM(preMatchNotify)이 정확히 10분 전에 발송
        // 클라이언트에서는 중복 발송하지 않음
      }

      if (changed) {
        saveNotified(notifiedRef.current);
      }
    };

    checkNotifications();
    const interval = setInterval(checkNotifications, 30000);
    return () => clearInterval(interval);
  }, [favoriteIds, matches, schedule, t, notifSettings, pushEnabled]);
}
