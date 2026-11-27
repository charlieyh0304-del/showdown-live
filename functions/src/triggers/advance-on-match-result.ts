/**
 * 실경기 승자/패자 자동 진출 트리거 (M0e)
 *
 * /matches/{tournamentId}/{matchId}에 쓰기가 일어날 때마다 불린다.
 * 로직은 lib/advancement.ts(processMatchWrite)에 있고, 여기서는 Firebase 저장소만 연결한다.
 * - 푸시 알림(onMatchChange)과는 별개 함수다.
 * - 대회 노드에 autoAdvance === false면 아무것도 하지 않는다(기본 사용).
 * - 하위 경기의 updatedAt은 건드리지 않는다. DB 규칙이 updatedAt 증가를 검사하므로,
 *   서버 시각을 쓰면 시계가 늦은 심판 기기의 다음 쓰기가 거부될 수 있다.
 * - 충돌은 advancementConflicts/{tid}/{downstreamMatchId}/player{N}에 기록한다.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onValueWritten } from "firebase-functions/v2/database";
import {
  processMatchWrite,
  type AdvancementStore,
  type ConflictRecord,
  type MatchData,
} from "../lib/advancement";

function createStore(tid: string): AdvancementStore {
  const db = admin.database();
  const conflictRef = (did: string, side: 1 | 2) => db.ref(`advancementConflicts/${tid}/${did}/player${side}`);
  return {
    async getTournament() {
      const snap = await db.ref(`tournaments/${tid}`).once("value");
      return snap.exists() ? snap.val() as MatchData : null;
    },
    async getMatches() {
      const snap = await db.ref(`matches/${tid}`).once("value");
      return snap.exists() ? snap.val() as Record<string, MatchData> : {};
    },
    async transactMatch(matchId, update) {
      await db.ref(`matches/${tid}/${matchId}`).transaction(cur => update(cur as MatchData | null), undefined, false);
    },
    async getConflict(did, side) {
      const snap = await conflictRef(did, side).once("value");
      return snap.exists() ? snap.val() as ConflictRecord : null;
    },
    async setConflict(did, side, record) {
      if (record) await conflictRef(did, side).set(record);
      else await conflictRef(did, side).remove();
    },
  };
}

export const advanceOnMatchResult = onValueWritten(
  { ref: "/matches/{tournamentId}/{matchId}" },
  async (event) => {
    const { tournamentId, matchId } = event.params;
    const before = event.data.before.exists() ? event.data.before.val() as MatchData : null;
    const after = event.data.after.exists() ? event.data.after.val() as MatchData : null;
    const report = await processMatchWrite(createStore(tournamentId), matchId, before, after, Date.now());
    if (report.skipped === "irrelevant") return;
    if (report.updated.length > 0 || report.conflicts.length > 0) {
      logger.info(`[advanceOnMatchResult] ${tournamentId}/${matchId}`, {
        updated: report.updated, conflicts: report.conflicts,
      });
    }
  },
);
