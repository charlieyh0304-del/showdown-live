import * as admin from "firebase-admin";
import { onValueUpdated } from "firebase-functions/v2/database";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2/options";

admin.initializeApp();
const db = admin.database();

setGlobalOptions({ region: "us-central1" });

interface PushSubscription {
  token: string;
  favoriteIds: string[];
  platform: string;
  updatedAt: number;
}

interface Match {
  id?: string;
  tournamentId: string;
  status: "pending" | "in_progress" | "completed";
  player1Id?: string;
  player2Id?: string;
  player1Name?: string;
  player2Name?: string;
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
  winnerId?: string;
  courtName?: string;
  sets?: Array<{ player1Score: number; player2Score: number }>;
  scheduledTime?: string;
  scheduledDate?: string;
}

interface ScheduleSlot {
  matchId: string;
  scheduledTime: string;
  scheduledDate?: string;
}

// Get all participant IDs/names from a match
function getMatchParticipants(match: Match): string[] {
  return [
    match.player1Id, match.player2Id,
    match.player1Name, match.player2Name,
    match.team1Id, match.team2Id,
    match.team1Name, match.team2Name,
  ].filter((v): v is string => !!v);
}

// Find subscriptions whose favorites overlap with given participant IDs
async function findSubscriptions(participantIds: string[]): Promise<PushSubscription[]> {
  const snap = await db.ref("pushSubscriptions").once("value");
  if (!snap.exists()) return [];

  const results: PushSubscription[] = [];
  const participantSet = new Set(participantIds);

  snap.forEach((child) => {
    const sub = child.val() as PushSubscription;
    if (sub.token && sub.favoriteIds?.some((id: string) => participantSet.has(id))) {
      results.push(sub);
    }
  });
  return results;
}

// Send FCM to multiple tokens, clean up invalid ones
// IMPORTANT: Uses data-only messages (no top-level `notification` field)
// so the service worker always handles display. This ensures:
// - Android: immediate delivery in background/doze mode (not delayed by system tray)
// - iOS: service worker receives the push and can show notification
async function sendToSubscriptions(
  subs: PushSubscription[],
  notification: { title: string; body: string },
) {
  if (subs.length === 0) return;

  const tokens = subs.map((s) => s.token);
  const tag = `showdown-${Date.now()}`;
  const message: admin.messaging.MulticastMessage = {
    tokens,
    // NO top-level `notification` - data-only so SW always handles it
    data: {
      title: notification.title,
      body: notification.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-96.png",
      tag,
      link: "/spectator",
    },
    webpush: {
      headers: {
        Urgency: "high",
        TTL: "86400",
      },
      fcmOptions: {
        link: "/spectator",
      },
    },
    // Android: high priority for immediate delivery even in doze mode
    android: {
      priority: "high",
    },
    // iOS (Safari PWA): APNS headers for immediate push delivery
    apns: {
      headers: {
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": "0",
      },
      payload: {
        aps: {
          "content-available": 1,
          alert: {
            title: notification.title,
            body: notification.body,
          },
          sound: "default",
          "mutable-content": 1,
        },
      },
    },
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  const successCount = response.responses.filter((r) => r.success).length;
  const failCount = response.responses.filter((r) => !r.success).length;
  console.log(`[FCM] Sent to ${tokens.length} tokens: ${successCount} success, ${failCount} failed`);
  response.responses.forEach((r, idx) => {
    if (r.error) console.error(`[FCM] Token ${idx} error:`, r.error.code, r.error.message);
  });

  // Remove invalid tokens
  const invalidTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (resp.error &&
      (resp.error.code === "messaging/invalid-registration-token" ||
        resp.error.code === "messaging/registration-token-not-registered")) {
      invalidTokens.push(tokens[idx]);
    }
  });

  if (invalidTokens.length > 0) {
    const snap = await db.ref("pushSubscriptions").once("value");
    const updates: Record<string, null> = {};
    snap.forEach((child) => {
      const sub = child.val() as PushSubscription;
      if (invalidTokens.includes(sub.token)) {
        updates[`pushSubscriptions/${child.key}`] = null;
      }
    });
    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
    }
  }
}

// Helper to get player display info for a subscription
function getPlayerInfo(match: Match, favoriteIds: string[]) {
  const participants = getMatchParticipants(match);
  const favId = favoriteIds.find((id) => participants.includes(id));
  if (!favId) return null;

  const isP1 = favId === match.player1Id || favId === match.player1Name ||
    favId === match.team1Id || favId === match.team1Name;
  const favName = isP1
    ? (match.player1Name || match.team1Name || favId)
    : (match.player2Name || match.team2Name || favId);
  const oppName = isP1
    ? (match.player2Name || match.team2Name || "")
    : (match.player1Name || match.team1Name || "");
  return { favName, oppName, isP1 };
}

// Track sent notifications to prevent duplicates
const NOTIF_SENT_PREFIX = "pushNotifSent";

async function wasNotifSent(key: string): Promise<boolean> {
  const snap = await db.ref(`${NOTIF_SENT_PREFIX}/${key}`).once("value");
  return snap.exists();
}

async function markNotifSent(key: string): Promise<void> {
  await db.ref(`${NOTIF_SENT_PREFIX}/${key}`).set({
    sentAt: admin.database.ServerValue.TIMESTAMP,
  });
}

// === FUNCTION 1: Match status change notifications ===
export const onMatchChange = onValueUpdated(
  { ref: "/matches/{tournamentId}/{matchId}" },
  async (event) => {
    const before = event.data.before.val() as Match | null;
    const after = event.data.after.val() as Match | null;
    if (!before || !after) return;

    const matchId = event.params.matchId;
    const tournamentId = event.params.tournamentId;
    const participants = getMatchParticipants(after);
    console.log(`[onMatchChange] ${tournamentId}/${matchId}: ${before.status} → ${after.status}, participants: ${participants.length}`);
    if (participants.length === 0) return;

    // Match started
    if (before.status !== "in_progress" && after.status === "in_progress") {
      const notifKey = `start_${matchId}`;
      if (await wasNotifSent(notifKey)) { console.log(`[onMatchChange] Already sent: ${notifKey}`); return; }

      const subs = await findSubscriptions(participants);
      console.log(`[onMatchChange] Match started ${matchId}: ${subs.length} subscribers found`);
      if (subs.length === 0) return;

      // Send personalized notifications per subscription
      for (const sub of subs) {
        const info = getPlayerInfo(after, sub.favoriteIds);
        if (!info) continue;
        const courtInfo = after.courtName ? ` (${after.courtName})` : "";
        await sendToSubscriptions([sub], {
          title: `⚡ ${info.favName} 경기 시작!`,
          body: `vs ${info.oppName}${courtInfo}`,
        });
      }
      await markNotifSent(notifKey);
    }

    // Match completed
    if (before.status !== "completed" && after.status === "completed") {
      const notifKey = `result_${matchId}`;
      if (await wasNotifSent(notifKey)) return;

      const subs = await findSubscriptions(participants);
      console.log(`[onMatchChange] Match completed ${matchId}: ${subs.length} subscribers found`);
      if (subs.length === 0) return;

      for (const sub of subs) {
        const info = getPlayerInfo(after, sub.favoriteIds);
        if (!info) continue;

        const won = info.isP1
          ? (after.winnerId === after.player1Id || after.winnerId === after.team1Id)
          : (after.winnerId === after.player2Id || after.winnerId === after.team2Id);

        const scores = (after.sets || [])
          .map((s) => {
            const my = info.isP1 ? s.player1Score : s.player2Score;
            const opp = info.isP1 ? s.player2Score : s.player1Score;
            return `${my}-${opp}`;
          })
          .join(", ");

        await sendToSubscriptions([sub], {
          title: `${won ? "🏆" : "😢"} ${info.favName} ${won ? "승리" : "패배"}`,
          body: `vs ${info.oppName} (${scores})`,
        });
      }
      await markNotifSent(notifKey);
    }
  },
);

// === FUNCTION 2: Pre-match notification (10 min before) ===
export const preMatchNotify = onSchedule(
  { schedule: "* * * * *", timeZone: "Asia/Seoul" },
  async () => {
    // Find all active tournaments
    const tournamentsSnap = await db.ref("tournaments")
      .orderByChild("status")
      .equalTo("in_progress")
      .once("value");

    if (!tournamentsSnap.exists()) {
      console.log("No active tournaments");
      return;
    }

    const tournamentIds: string[] = [];
    tournamentsSnap.forEach((child) => {
      tournamentIds.push(child.key!);
    });
    console.log(`Active tournaments: ${tournamentIds.join(", ")}`);

    const now = Date.now();
    const pendingNotifs: Promise<void>[] = [];

    for (const tid of tournamentIds) {
      const [matchesSnap, scheduleSnap] = await Promise.all([
        db.ref(`matches/${tid}`).once("value"),
        db.ref(`schedule/${tid}`).once("value"),
      ]);

      if (!matchesSnap.exists()) continue;

      // Build schedule lookup
      const scheduleLookup = new Map<string, ScheduleSlot>();
      if (scheduleSnap.exists()) {
        scheduleSnap.forEach((child) => {
          const slot = child.val() as ScheduleSlot;
          if (slot.matchId) scheduleLookup.set(slot.matchId, slot);
        });
      }

      // Collect pending matches into array (forEach can't await)
      const pendingMatches: Array<{ match: Match; matchId: string }> = [];
      matchesSnap.forEach((child) => {
        const match = child.val() as Match;
        if (match.status === "pending") {
          pendingMatches.push({ match, matchId: child.key! });
        }
      });

      console.log(`Tournament ${tid}: ${pendingMatches.length} pending matches, ${scheduleLookup.size} schedule slots`);

      for (const { match, matchId } of pendingMatches) {
        // Determine scheduled time
        let timeStr = match.scheduledTime;
        let dateStr = match.scheduledDate;
        if (!timeStr) {
          const slot = scheduleLookup.get(matchId);
          if (slot) {
            timeStr = slot.scheduledTime;
            dateStr = slot.scheduledDate;
          }
        }
        if (!timeStr) continue;

        // Parse time
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (!timeMatch) continue;

        const d = dateStr ? new Date(dateStr) : new Date();
        d.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
        const diff = d.getTime() - now;

        // 9-11 minutes before match
        if (diff > 0 && diff <= 11 * 60 * 1000 && diff >= 9 * 60 * 1000) {
          const notifKey = `pre_${matchId}`;
          console.log(`Match ${matchId} is ${Math.round(diff / 60000)}min away, sending pre-match notif`);

          pendingNotifs.push((async () => {
            if (await wasNotifSent(notifKey)) {
              console.log(`Already sent: ${notifKey}`);
              return;
            }

            const participants = getMatchParticipants(match);
            const subs = await findSubscriptions(participants);
            console.log(`Match ${matchId}: ${subs.length} subscribers found`);
            if (subs.length === 0) return;

            for (const sub of subs) {
              const info = getPlayerInfo(match, sub.favoriteIds);
              if (!info) continue;
              const courtInfo = match.courtName ? ` (${match.courtName})` : "";
              await sendToSubscriptions([sub], {
                title: `📢 ${info.favName} 경기 10분 전`,
                body: `vs ${info.oppName}${courtInfo}`,
              });
              console.log(`Sent pre-match notif for ${info.favName} to ${sub.platform}`);
            }
            await markNotifSent(notifKey);
          })());
        }
      }
    }

    // Wait for all notifications to complete before function exits
    await Promise.all(pendingNotifs);
    console.log(`preMatchNotify done, processed ${pendingNotifs.length} notifications`);
  },
);
