import * as admin from "firebase-admin";
import { onValueUpdated } from "firebase-functions/v2/database";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";

admin.initializeApp();
const db = admin.database();

export { chatbot } from "./chatbot";

setGlobalOptions({ region: "us-central1" });

interface PushSubscription {
  token: string;
  favoriteIds: string[];
  favoriteNames?: string[];
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

// Get all participant IDs/names from a match (including team members)
function getMatchParticipants(match: Match): string[] {
  const ids = [
    match.player1Id, match.player2Id,
    match.player1Name, match.player2Name,
    match.team1Id, match.team2Id,
    match.team1Name, match.team2Name,
  ];
  // Include team member IDs and names for team matches
  const m = match as unknown as { team1?: { memberIds?: string[]; memberNames?: string[] }; team2?: { memberIds?: string[]; memberNames?: string[] } };
  const team1 = m.team1;
  const team2 = m.team2;
  if (team1?.memberIds) ids.push(...team1.memberIds);
  if (team1?.memberNames) ids.push(...team1.memberNames);
  if (team2?.memberIds) ids.push(...team2.memberIds);
  if (team2?.memberNames) ids.push(...team2.memberNames);
  return ids.filter((v): v is string => !!v);
}

// Find subscriptions whose favorites overlap with given participant IDs or names
async function findSubscriptions(participantIds: string[]): Promise<PushSubscription[]> {
  const snap = await db.ref("pushSubscriptions").once("value");
  if (!snap.exists()) return [];

  const results: PushSubscription[] = [];
  const participantSet = new Set(participantIds);

  snap.forEach((child) => {
    const sub = child.val() as PushSubscription;
    if (!sub.token) return;
    // ID 매칭
    if (sub.favoriteIds?.some((id: string) => participantSet.has(id))) {
      results.push(sub);
      return;
    }
    // 이름 매칭 (대회 간 같은 선수가 다른 ID를 가질 수 있음)
    if (sub.favoriteNames?.some((name: string) => participantSet.has(name))) {
      results.push(sub);
    }
  });
  return results;
}

// Send FCM to multiple tokens, clean up invalid ones
async function sendToSubscriptions(
  subs: PushSubscription[],
  notification: { title: string; body: string },
  link = "/spectator",
): Promise<number> {
  if (subs.length === 0) return 0;

  const tokens = subs.map((s) => s.token);
  const tag = `showdown-${Date.now()}`;

  // webpush.notification: 브라우저가 직접 OS 알림 표시 (iOS Safari 포함)
  // data: 포그라운드 onMessage에서 인앱 알림용
  // 최상위 notification 없음: SW onBackgroundMessage 호출 보장 (Chrome)
  const basePayload = {
    data: {
      title: notification.title,
      body: notification.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-96.png",
      tag,
      link,
    },
    webpush: {
      headers: { Urgency: "high", TTL: "86400" },
      fcmOptions: { link },
      notification: {
        title: notification.title,
        body: notification.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-96.png",
        tag,
        data: { link },
        requireInteraction: true,
        renotify: true,
      },
    },
    android: {
      priority: "high" as const,
    },
    apns: {
      headers: {
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      payload: {
        aps: {
          alert: { title: notification.title, body: notification.body || "" },
          sound: "default",
          contentAvailable: true,
        },
      },
    },
  };

  let successCount = 0;
  let failCount = 0;
  const responses: { success: boolean; error?: { code: string; message: string } }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    try {
      await admin.messaging().send({ ...basePayload, token: tokens[i] });
      responses.push({ success: true });
      successCount++;
      console.log(`[FCM] Token ${i} sent OK`);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      responses.push({ success: false, error: { code: e.code || "unknown", message: e.message || "" } });
      failCount++;
      console.error(`[FCM] Token ${i} error:`, e.code, e.message);
    }
  }
  console.log(`[FCM] Sent to ${tokens.length} tokens: ${successCount} success, ${failCount} failed`);

  // Remove invalid tokens
  const invalidTokens: string[] = [];
  responses.forEach((resp, idx) => {
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
  return successCount;
}

// Helper to get player display info for a subscription
function getPlayerInfo(match: Match, favoriteIds: string[], favoriteNames?: string[]) {
  const participants = getMatchParticipants(match);
  // ID 매칭
  let favId = favoriteIds.find((id) => participants.includes(id));
  // 이름 매칭 폴백
  if (!favId && favoriteNames) {
    favId = favoriteNames.find((name) => participants.includes(name));
  }
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
    const matchId = event.params.matchId;
    const tournamentId = event.params.tournamentId;

    if (!before || !after) {
      console.log(`[onMatchChange] ${tournamentId}/${matchId}: before=${!!before} after=${!!after} — skipping`);
      return;
    }

    const participants = getMatchParticipants(after);
    console.log(`[onMatchChange] ${tournamentId}/${matchId}: ${before.status} → ${after.status}, participants: ${participants.length}, names: ${[after.player1Name, after.player2Name, after.team1Name, after.team2Name].filter(Boolean).join(", ")}`);
    if (participants.length === 0) return;

    // 스케줄 변경 시 pre 알림 기록 리셋 (재전송 허용)
    const beforeTime = before.scheduledTime || "";
    const afterTime = after.scheduledTime || "";
    const beforeDate = before.scheduledDate || "";
    const afterDate = after.scheduledDate || "";
    if (beforeTime !== afterTime || beforeDate !== afterDate) {
      const preKey = `pre_${matchId}`;
      await db.ref(`${NOTIF_SENT_PREFIX}/${preKey}`).remove();
      console.log(`[onMatchChange] Schedule changed for ${matchId}: ${beforeDate} ${beforeTime} → ${afterDate} ${afterTime}, reset pre notif`);
    }

    // 전체 구독 수 확인 (디버그)
    const allSubsSnap = await db.ref("pushSubscriptions").once("value");
    const totalSubs = allSubsSnap.exists() ? Object.keys(allSubsSnap.val()).length : 0;

    // Match started
    if (before.status !== "in_progress" && after.status === "in_progress") {
      const notifKey = `start_${matchId}`;
      if (await wasNotifSent(notifKey)) { console.log(`[onMatchChange] Already sent: ${notifKey}`); return; }

      // 먼저 마킹하여 중복 트리거 방지
      await markNotifSent(notifKey);

      const subs = await findSubscriptions(participants);
      console.log(`[onMatchChange] Match started ${matchId}: ${subs.length}/${totalSubs} subscribers matched, participants: [${participants.join(", ")}]`);
      if (subs.length === 0) return;

      // Send personalized notifications per subscription
      const matchLink = `/spectator/match/${tournamentId}/${matchId}`;
      for (const sub of subs) {
        const info = getPlayerInfo(after, sub.favoriteIds, sub.favoriteNames);
        if (!info) continue;
        const courtInfo = after.courtName ? ` (${after.courtName})` : "";
        await sendToSubscriptions([sub], {
          title: `⚡ ${info.favName} vs ${info.oppName} 경기 시작!${courtInfo ? courtInfo : ""}`,
          body: "",
        }, matchLink);
      }
    }

    // Match completed
    if (before.status !== "completed" && after.status === "completed") {
      const notifKey = `result_${matchId}`;
      if (await wasNotifSent(notifKey)) return;

      // 먼저 마킹하여 중복 트리거 방지
      await markNotifSent(notifKey);

      const subs = await findSubscriptions(participants);
      console.log(`[onMatchChange] Match completed ${matchId}: ${subs.length}/${totalSubs} subscribers matched`);
      if (subs.length === 0) return;

      const resultLink = `/spectator/match/${tournamentId}/${matchId}`;
      for (const sub of subs) {
        const info = getPlayerInfo(after, sub.favoriteIds, sub.favoriteNames);
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
          title: `${won ? "🏆" : "😢"} ${info.favName} vs ${info.oppName} ${won ? "승리" : "패배"}`,
          body: scores,
        }, resultLink);
      }
    }
  },
);

// === FUNCTION 2: Pre-match notification (10 min before) ===
// 대회 상태와 무관하게 스케줄만 보고 알림 전송
export const preMatchNotify = onSchedule(
  { schedule: "* * * * *", timeZone: "Asia/Seoul" },
  async () => {
    // completed 대회만 제외, 나머지는 모두 스케줄 확인
    const tournamentsSnap = await db.ref("tournaments").once("value");

    if (!tournamentsSnap.exists()) {
      console.log("No tournaments");
      return;
    }

    const tournamentIds: string[] = [];
    tournamentsSnap.forEach((child) => {
      const status = child.val()?.status;
      // completed 대회만 제외
      if (status !== "completed") {
        tournamentIds.push(child.key!);
      }
    });

    if (tournamentIds.length === 0) {
      console.log("No active tournaments (all completed)");
      return;
    }
    console.log(`Checking ${tournamentIds.length} tournaments: ${tournamentIds.join(", ")}`);

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

        // Parse time (KST - Korea Standard Time, UTC+9)
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (!timeMatch) continue;

        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);

        // Build KST datetime string and parse as UTC
        // scheduledTime is in KST, so subtract 9 hours for UTC
        let dateBase: string;
        if (dateStr) {
          dateBase = dateStr;
        } else {
          // No date: use today in KST (UTC+9)
          const kstNow = new Date(now + 9 * 60 * 60 * 1000);
          dateBase = kstNow.toISOString().slice(0, 10);
        }
        // Create date as KST then convert to UTC timestamp
        const kstDate = new Date(`${dateBase}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+09:00`);
        const diff = kstDate.getTime() - now;

        const diffMin = diff / 60000;
        console.log(`Match ${matchId}: scheduled ${dateBase} ${timeStr} KST, diff=${diffMin.toFixed(1)}min`);

        // 10분 전 ~ 경기 시작 시점: 첫 진입 시 1회만 발송 (중복 방지는 wasNotifSent)
        if (diffMin <= 10 && diffMin >= 0) {
          const notifKey = `pre_${matchId}`;
          console.log(`Match ${matchId} is ${diffMin.toFixed(1)}min away, sending pre-match notif`);

          pendingNotifs.push((async () => {
            if (await wasNotifSent(notifKey)) {
              console.log(`Already sent: ${notifKey}`);
              return;
            }

            // 먼저 마킹하여 중복 방지
            await markNotifSent(notifKey);

            const participants = getMatchParticipants(match);
            const subs = await findSubscriptions(participants);
            console.log(`Match ${matchId}: ${subs.length} subscribers found`);
            if (subs.length === 0) return;

            const preMatchLink = `/spectator/match/${tid}/${matchId}`;
            for (const sub of subs) {
              const info = getPlayerInfo(match, sub.favoriteIds, sub.favoriteNames);
              if (!info) continue;
              const courtInfo = match.courtName ? ` (${match.courtName})` : "";
              await sendToSubscriptions([sub], {
                title: `📢 ${info.favName} vs ${info.oppName} 경기 10분 전${courtInfo ? courtInfo : ""}`,
                body: "",
              }, preMatchLink);
              console.log(`Sent pre-match notif for ${info.favName} to ${sub.platform}`);
            }
          })());
        }
      }
    }

    // Wait for all notifications to complete before function exits
    await Promise.all(pendingNotifs);
    console.log(`preMatchNotify done, processed ${pendingNotifs.length} notifications`);
  },
);

// === TEST: 모든 구독자에게 테스트 알림 전송 + pushNotifSent 초기화 ===
export const testPush = onRequest(
  { cors: true },
  async (req, res) => {
    // 1. pushNotifSent 초기화
    await db.ref("pushNotifSent").remove();
    console.log("[testPush] pushNotifSent cleared");

    // 2. 모든 구독 조회
    const snap = await db.ref("pushSubscriptions").once("value");
    if (!snap.exists()) {
      res.json({ error: "No subscriptions found" });
      return;
    }

    const allSubs: PushSubscription[] = [];
    const subDetails: Array<{ key: string; platform: string; favCount: number; names: string[] }> = [];
    snap.forEach((child) => {
      const sub = child.val() as PushSubscription;
      if (sub.token) {
        allSubs.push(sub);
        subDetails.push({
          key: child.key!,
          platform: sub.platform,
          favCount: sub.favoriteIds?.length || 0,
          names: sub.favoriteNames || [],
        });
      }
    });

    console.log(`[testPush] Found ${allSubs.length} subscriptions`);

    // 3. 각 구독에 테스트 알림 전송
    const results: Array<{ key: string; platform: string; success: boolean; error?: string }> = [];
    for (let i = 0; i < allSubs.length; i++) {
      const sub = allSubs[i];
      const detail = subDetails[i];
      try {
        const sent = await sendToSubscriptions([sub], {
          title: "🔔 테스트 알림",
          body: `구독 확인: ${detail.platform}, 즐겨찾기 ${detail.favCount}명`,
        }, "/spectator");
        results.push({ key: detail.key, platform: detail.platform, success: sent > 0 });
        console.log(`[testPush] ${detail.key} (${detail.platform}): ${sent > 0 ? "OK" : "FAIL"}`);
      } catch (err: unknown) {
        const e = err as { message?: string };
        results.push({ key: detail.key, platform: detail.platform, success: false, error: e.message });
        console.error(`[testPush] ${detail.key} error:`, e.message);
      }
    }

    res.json({
      subscriptions: subDetails,
      results,
      pushNotifSentCleared: true,
    });
  },
);
