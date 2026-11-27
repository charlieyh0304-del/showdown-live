/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ref, onValue, set, push, remove, update, get, runTransaction, query, limitToLast, type DataSnapshot, type Query } from 'firebase/database';
import { database, authReady } from '../config/firebase';
import { queueUpdate } from '../utils/offlineQueue';
import type { Player, Referee, Court, Tournament, Match, MatchUpdate, Team, ScheduleSlot, Notification } from '../types';
import {
  stripUndefined,
  buildMatchesBulkUpdate,
  buildTeamsBulkData,
  buildScheduleBulkData,
  monotonicUpdatedAt,
  scheduleSlotKey,
  toFirebaseValue,
  writeOrQueue,
  type MatchesBulkOptions,
  type WriteResult,
} from '../utils/dataWrites';

/** matches/{tid} 아래에 쓸 새 경기 키 (쓰기 없음, 오프라인에서도 동작) */
export function newMatchKey(tournamentId: string): string {
  return push(ref(database, `matches/${tournamentId}`)).key!;
}

// ===== Write rate limiter =====
// Prevents rapid writes from overwhelming Firebase (max 10 writes/sec per path)
const writeTimestamps = new Map<string, number[]>();
// exported for use by consumers that need rate-limiting
export function canWrite(path: string, maxPerSecond = 10): boolean {
  const now = Date.now();
  const timestamps = writeTimestamps.get(path) || [];
  const recent = timestamps.filter(t => now - t < 1000);
  if (recent.length >= maxPerSecond) return false;
  recent.push(now);
  writeTimestamps.set(path, recent);
  return true;
}

// ===== Issue 4: Firebase listener deduplication =====
// Module-level cache so multiple components subscribing to the same path share one listener.
const listenerCache = new Map<string, { unsub: () => void; count: number; callbacks: Set<(data: DataSnapshot) => void>; lastSnapshot: DataSnapshot | null }>();

function subscribeToPath(path: string, callback: (snapshot: DataSnapshot) => void): () => void {
  if (listenerCache.has(path)) {
    const entry = listenerCache.get(path)!;
    entry.count++;
    entry.callbacks.add(callback);
    // Deliver the last snapshot immediately so new subscribers don't stay in loading state
    if (entry.lastSnapshot) {
      queueMicrotask(() => callback(entry.lastSnapshot!));
    }
    return () => {
      entry.callbacks.delete(callback);
      entry.count--;
      if (entry.count <= 0) {
        entry.unsub();
        listenerCache.delete(path);
      }
    };
  }
  const callbacks = new Set<(snapshot: DataSnapshot) => void>([callback]);
  const cacheEntry = { unsub: () => {}, count: 1, callbacks, lastSnapshot: null as DataSnapshot | null };
  let retries = 0;
  const attach = (): (() => void) => onValue(
    ref(database, path),
    (snap) => {
      cacheEntry.lastSnapshot = snap;
      callbacks.forEach(cb => cb(snap));
    },
    (err) => {
      // The value callback never fires on a cancelled listen, so consumers would stay in
      // `loading` forever. The usual cause: the listener attached before anonymous auth
      // finished and the node requires auth (e.g. `referees` rule is `auth != null`).
      // Re-attach once auth is ready; cap retries to avoid a tight loop if it keeps failing.
      // Logged in all builds so a cancellation is diagnosable in deployed environments too.
      console.warn(`[showdown] DB listen cancelled for "${path}": ${err.message} — will retry after auth`);
      if (retries >= 3) return;
      retries++;
      authReady.then(() => {
        if (listenerCache.get(path) === cacheEntry && cacheEntry.count > 0) {
          cacheEntry.unsub = attach();
        }
      }).catch(() => {});
    },
  );
  cacheEntry.unsub = attach();
  listenerCache.set(path, cacheEntry);
  return () => {
    callbacks.delete(callback);
    const entry = listenerCache.get(path)!;
    entry.count--;
    if (entry.count <= 0) {
      entry.unsub();
      listenerCache.delete(path);
    }
  };
}

// ===== Query-based listener deduplication =====
// Like subscribeToPath but for Firebase Query objects (limitToLast, orderByChild, etc.)
const queryListenerCache = new Map<string, { unsub: () => void; count: number; callbacks: Set<(data: DataSnapshot) => void>; lastSnapshot: DataSnapshot | null }>();

function subscribeToQuery(cacheKey: string, q: Query, callback: (snapshot: DataSnapshot) => void): () => void {
  if (queryListenerCache.has(cacheKey)) {
    const entry = queryListenerCache.get(cacheKey)!;
    entry.count++;
    entry.callbacks.add(callback);
    if (entry.lastSnapshot) {
      queueMicrotask(() => callback(entry.lastSnapshot!));
    }
    return () => {
      entry.callbacks.delete(callback);
      entry.count--;
      if (entry.count <= 0) {
        entry.unsub();
        queryListenerCache.delete(cacheKey);
      }
    };
  }
  const callbacks = new Set<(snapshot: DataSnapshot) => void>([callback]);
  const cacheEntry = { unsub: () => {}, count: 1, callbacks, lastSnapshot: null as DataSnapshot | null };
  let retries = 0;
  const attach = (): (() => void) => onValue(
    q,
    (snap) => {
      cacheEntry.lastSnapshot = snap;
      callbacks.forEach(cb => cb(snap));
    },
    (err) => {
      // See subscribeToPath: recover from a pre-auth permission-denied so loading resolves.
      console.warn(`[showdown] DB query listen cancelled for "${cacheKey}": ${err.message} — will retry after auth`);
      if (retries >= 3) return;
      retries++;
      authReady.then(() => {
        if (queryListenerCache.get(cacheKey) === cacheEntry && cacheEntry.count > 0) {
          cacheEntry.unsub = attach();
        }
      }).catch(() => {});
    },
  );
  cacheEntry.unsub = attach();
  queryListenerCache.set(cacheKey, cacheEntry);
  return () => {
    callbacks.delete(callback);
    const entry = queryListenerCache.get(cacheKey)!;
    entry.count--;
    if (entry.count <= 0) {
      entry.unsub();
      queryListenerCache.delete(cacheKey);
    }
  };
}

// ===== Issue 8: Cap scoreHistory to prevent unbounded growth =====
const MAX_SCORE_HISTORY = 500;
function capScoreHistory(m: Record<string, unknown>): void {
  if (Array.isArray(m.scoreHistory) && m.scoreHistory.length > MAX_SCORE_HISTORY) {
    m.scoreHistory = m.scoreHistory.slice(0, MAX_SCORE_HISTORY);
  }
}

// ===== Firebase array normalization helper =====
// Firebase stores arrays as objects when indices have gaps or are sparse.
// These helpers convert any object-stored array field back to a proper array.

// Normalize all known array fields on a Match object from Firebase
function normalizeMatchArrays(m: Record<string, unknown>): void {
  if (m.sets && !Array.isArray(m.sets)) m.sets = Object.values(m.sets as object);
  if (m.scoreHistory && !Array.isArray(m.scoreHistory)) m.scoreHistory = Object.values(m.scoreHistory as object);
  if (m.pauseHistory && !Array.isArray(m.pauseHistory)) m.pauseHistory = Object.values(m.pauseHistory as object);
  if (m.individualMatches && !Array.isArray(m.individualMatches)) m.individualMatches = Object.values(m.individualMatches as object);
  if (m.team1ActivePlayerIds && !Array.isArray(m.team1ActivePlayerIds)) m.team1ActivePlayerIds = Object.values(m.team1ActivePlayerIds as object);
  if (m.team1ActivePlayerNames && !Array.isArray(m.team1ActivePlayerNames)) m.team1ActivePlayerNames = Object.values(m.team1ActivePlayerNames as object);
  if (m.team2ActivePlayerIds && !Array.isArray(m.team2ActivePlayerIds)) m.team2ActivePlayerIds = Object.values(m.team2ActivePlayerIds as object);
  if (m.team2ActivePlayerNames && !Array.isArray(m.team2ActivePlayerNames)) m.team2ActivePlayerNames = Object.values(m.team2ActivePlayerNames as object);
  // Cap scoreHistory after normalization
  capScoreHistory(m);
}

// Normalize all known array fields on a Tournament object from Firebase
function normalizeTournamentArrays(t: Record<string, unknown>): void {
  if (t.stages && !Array.isArray(t.stages)) t.stages = Object.values(t.stages as object);
  if (t.seeds && !Array.isArray(t.seeds)) t.seeds = Object.values(t.seeds as object);
  // Normalize nested stage arrays
  if (Array.isArray(t.stages)) {
    for (const stage of t.stages as Record<string, unknown>[]) {
      if (stage.seeds && !Array.isArray(stage.seeds)) stage.seeds = Object.values(stage.seeds as object);
      if (stage.groups && !Array.isArray(stage.groups)) stage.groups = Object.values(stage.groups as object);
      if (stage.advancedParticipantIds && !Array.isArray(stage.advancedParticipantIds)) stage.advancedParticipantIds = Object.values(stage.advancedParticipantIds as object);
      // Normalize group arrays within each stage
      if (Array.isArray(stage.groups)) {
        for (const group of stage.groups as Record<string, unknown>[]) {
          if (group.playerIds && !Array.isArray(group.playerIds)) group.playerIds = Object.values(group.playerIds as object);
          if (group.teamIds && !Array.isArray(group.teamIds)) group.teamIds = Object.values(group.teamIds as object);
          if (group.seedOrder && !Array.isArray(group.seedOrder)) group.seedOrder = Object.values(group.seedOrder as object);
        }
      }
    }
  }
}

// Normalize all known array fields on a Team object from Firebase
function normalizeTeamArrays(t: Record<string, unknown>): void {
  if (t.memberIds && !Array.isArray(t.memberIds)) t.memberIds = Object.values(t.memberIds as object);
  if (t.memberNames && !Array.isArray(t.memberNames)) t.memberNames = Object.values(t.memberNames as object);
}

// Normalize Court array fields from Firebase
function normalizeCourtArrays(c: Record<string, unknown>): void {
  if (c.assignedReferees && !Array.isArray(c.assignedReferees)) c.assignedReferees = Object.values(c.assignedReferees as object);
}

// ===== 선수 =====
export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const unsub = subscribeToPath('players', (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setPlayers(data ? Object.entries(data).map(([id, p]) => ({ id, ...(p as Omit<Player, 'id'>) })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')) : []);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, []);

  const addPlayer = useCallback(async (player: Omit<Player, 'id' | 'createdAt'>) => {
    const newRef = push(ref(database, 'players'));
    await set(newRef, { ...player, createdAt: Date.now() });
    return newRef.key;
  }, []);

  const updatePlayer = useCallback(async (id: string, data: Partial<Player>) => {
    await update(ref(database, `players/${id}`), data);
  }, []);

  const deletePlayer = useCallback(async (id: string) => {
    await remove(ref(database, `players/${id}`));
  }, []);

  return { players, loading, addPlayer, updatePlayer, deletePlayer };
}

// ===== 심판 =====
export function useReferees() {
  const [referees, setReferees] = useState<Referee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const unsub = subscribeToPath('referees', (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setReferees(data ? Object.entries(data).map(([id, r]) => {
        const referee = r as Record<string, unknown>;
        // Normalize assignedMatchIds array
        if (referee.assignedMatchIds && !Array.isArray(referee.assignedMatchIds)) {
          referee.assignedMatchIds = Object.values(referee.assignedMatchIds as object);
        }
        return { id, ...(referee as unknown as Omit<Referee, 'id'>) };
      }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')) : []);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, []);

  const addReferee = useCallback(async (referee: Omit<Referee, 'id' | 'createdAt'>) => {
    const { authReady } = await import('@shared/config/firebase');
    await authReady;
    const newRef = push(ref(database, 'referees'));
    await set(newRef, { ...referee, createdAt: Date.now() });
    return newRef.key;
  }, []);

  const updateReferee = useCallback(async (id: string, data: Partial<Referee>) => {
    await update(ref(database, `referees/${id}`), data);
  }, []);

  const deleteReferee = useCallback(async (id: string) => {
    await remove(ref(database, `referees/${id}`));
  }, []);

  return { referees, loading, addReferee, updateReferee, deleteReferee };
}

// ===== 경기장 =====
export function useCourts() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const unsub = subscribeToPath('courts', (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setCourts(data ? Object.entries(data).map(([id, c]) => {
        const court = c as Record<string, unknown>;
        normalizeCourtArrays(court);
        return { id, ...(court as unknown as Omit<Court, 'id'>) };
      }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')) : []);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, []);

  const addCourt = useCallback(async (court: Omit<Court, 'id' | 'createdAt'>) => {
    const newRef = push(ref(database, 'courts'));
    await set(newRef, { ...court, createdAt: Date.now() });
    return newRef.key;
  }, []);

  const updateCourt = useCallback(async (id: string, data: Partial<Court>) => {
    await update(ref(database, `courts/${id}`), data);
  }, []);

  const deleteCourt = useCallback(async (id: string) => {
    await remove(ref(database, `courts/${id}`));
  }, []);

  return { courts, loading, addCourt, updateCourt, deleteCourt };
}

// ===== 대회 =====
/** @param limit 최근 N개만 구독 (기본: 전체). 관중/심판 모드에서는 20 권장. */
export function useTournaments(limit?: number) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const path = 'tournaments';
    const handleSnap = (snap: DataSnapshot) => {
      if (!isMounted) return;
      const data = snap.val();
      setTournaments(data ? Object.entries(data).map(([id, t]) => {
        const tournament = t as Record<string, unknown>;
        normalizeTournamentArrays(tournament);
        return { id, ...(tournament as unknown as Omit<Tournament, 'id'>) };
      }).sort((a, b) => b.createdAt - a.createdAt) : []);
      setLoading(false);
    };
    const unsub = limit
      ? subscribeToQuery(`${path}:last${limit}`, query(ref(database, path), limitToLast(limit)), handleSnap)
      : subscribeToPath(path, handleSnap);
    return () => { isMounted = false; unsub(); };
  }, [limit]);

  const addTournament = useCallback(async (tournament: Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newRef = push(ref(database, 'tournaments'));
    const now = Date.now();
    await set(newRef, { ...tournament, createdAt: now, updatedAt: now });
    return newRef.key;
  }, []);

  const updateTournament = useCallback(async (id: string, data: Partial<Tournament>): Promise<boolean> => {
    const path = `tournaments/${id}`;
    const now = Date.now();
    // Firebase does not accept undefined values — strip them
    const payload = Object.fromEntries(Object.entries({ ...data, updatedAt: now }).filter(([, v]) => v !== undefined));
    // Optimistic concurrency: check if server updatedAt matches local
    const localTournament = tournaments.find(t => t.id === id);
    const localUpdatedAt = localTournament?.updatedAt;
    if (localUpdatedAt !== undefined) {
      const snap = await get(ref(database, `${path}/updatedAt`));
      const serverUpdatedAt = snap.val();
      if (serverUpdatedAt !== null && serverUpdatedAt !== localUpdatedAt) {
        // Conflict: server data was modified by another client
        return false;
      }
    }
    await update(ref(database, path), payload);
    return true;
  }, [tournaments]);

  const deleteTournament = useCallback(async (id: string) => {
    // 대회 + 관련 경기 + 팀 + 스케줄 + 알림 삭제
    const updates: Record<string, null> = {};
    updates[`tournaments/${id}`] = null;
    updates[`matches/${id}`] = null;
    updates[`teams/${id}`] = null;
    updates[`schedule/${id}`] = null;
    updates[`tournamentPlayers/${id}`] = null;
    updates[`tournamentReferees/${id}`] = null;
    updates[`notifications/${id}`] = null;
    await update(ref(database), updates);
  }, []);

  return { tournaments, loading, addTournament, updateTournament, deleteTournament };
}

// ===== 단일 대회 구독 =====
export function useTournament(tournamentId: string | null) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setTournament(null); setLoading(false); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`tournaments/${tournamentId}`, (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      if (data) {
        normalizeTournamentArrays(data);
        setTournament({ id: tournamentId, ...data });
      } else {
        setTournament(null);
      }
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  const updateTournament = useCallback(async (data: Partial<Tournament>): Promise<boolean> => {
    if (!tournamentId) return false;
    const path = `tournaments/${tournamentId}`;
    const now = Date.now();
    // Firebase does not accept undefined values — strip them
    const payload = Object.fromEntries(Object.entries({ ...data, updatedAt: now }).filter(([, v]) => v !== undefined));
    // Optimistic concurrency: check if server updatedAt matches local
    const localUpdatedAt = tournament?.updatedAt;
    if (localUpdatedAt !== undefined) {
      const snap = await get(ref(database, `${path}/updatedAt`));
      const serverUpdatedAt = snap.val();
      if (serverUpdatedAt !== null && serverUpdatedAt !== localUpdatedAt) {
        // Conflict: server data was modified by another client
        return false;
      }
    }
    await update(ref(database, path), payload);
    return true;
  }, [tournamentId, tournament]);

  return { tournament, loading, updateTournament };
}

// ===== 대회별 경기 =====
/** @param limit 최근 N개만 구독 (기본: 전체). 관중 뷰에서는 100 권장. */
export function useMatches(tournamentId: string | null, limit?: number) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setMatches([]); setLoading(false); return; }
    let isMounted = true;
    const path = `matches/${tournamentId}`;
    const handleSnap = (snap: DataSnapshot) => {
      if (!isMounted) return;
      const data = snap.val();
      setMatches(data ? Object.entries(data).map(([id, raw]) => {
        const m = raw as Record<string, unknown>;
        normalizeMatchArrays(m);
        return { id, ...(m as unknown as Omit<Match, 'id'>) };
      }).sort((a, b) => (a.round ?? 0) - (b.round ?? 0)) : []);
      setLoading(false);
    };
    const unsub = limit
      ? subscribeToQuery(`${path}:last${limit}`, query(ref(database, path), limitToLast(limit)), handleSnap)
      : subscribeToPath(path, handleSnap);
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  // Issue 5: Memoize stable match reference to avoid unnecessary re-renders
  // 이전 키와 비교하여 실제 변경 시에만 새 참조 반환 (JSON.stringify 비용 제거)
  const matchKeyRef = useRef('');
  const stableMatchesRef = useRef(matches);
  const matchKey = matches.map(m => m.id + ':' + m.status + ':' + (m.updatedAt ?? 0)).join('|');
  if (matchKey !== matchKeyRef.current) {
    matchKeyRef.current = matchKey;
    stableMatchesRef.current = matches;
  }
  const stableMatches = stableMatchesRef.current;

  const addMatch = useCallback(async (match: Omit<Match, 'id'>) => {
    if (!tournamentId) return null;
    const newRef = push(ref(database, `matches/${tournamentId}`));
    await set(newRef, match);
    return newRef.key;
  }, [tournamentId]);

  /**
   * 관리자용 경기 업데이트. null은 필드 삭제, undefined는 무시.
   * 반환: 'written'(서버 반영) | 'queued'(연결 오류로 재시도 큐에 보관, 서버 반영 미확인) | false(실패/충돌/서버 거부)
   */
  const updateMatch = useCallback(async (matchId: string, data: MatchUpdate): Promise<WriteResult> => {
    if (!tournamentId) return false;
    const path = `matches/${tournamentId}/${matchId}`;
    if (!canWrite(path)) {
      console.warn('[useFirebase] Write rate limit exceeded for', path);
      return false;
    }
    const now = Date.now();
    // Issue 8: Cap scoreHistory before writing
    if (data.scoreHistory && Array.isArray(data.scoreHistory) && data.scoreHistory.length > MAX_SCORE_HISTORY) {
      data = { ...data, scoreHistory: data.scoreHistory.slice(0, MAX_SCORE_HISTORY) };
    }
    // Firebase does not accept undefined values — strip them
    const payload = stripUndefined({ ...data, updatedAt: now });
    return writeOrQueue(
      async () => {
        const result = await runTransaction(ref(database, path), (currentData) => {
          if (currentData === null) return payload;
          // Merge: always apply changes on top of server's latest state
          // For scoreHistory, append new entries from payload to server's existing history
          const merged = { ...currentData, ...payload };
          if (payload.scoreHistory && currentData.scoreHistory) {
            const serverHistory = Array.isArray(currentData.scoreHistory) ? currentData.scoreHistory : Object.values(currentData.scoreHistory);
            const newHistory = payload.scoreHistory as unknown[];
            // Merge: use the longer/newer history (contains all entries)
            merged.scoreHistory = newHistory.length >= serverHistory.length ? newHistory : serverHistory;
          }
          return merged;
        });
        return result.committed;
      },
      // Connection errors only: queue for replay on reconnect, reported as 'queued' (never as written).
      // Server rejections (permission_denied incl. .validate, maxretry) are not queued and return false.
      () => queueUpdate(path, payload),
    );
  }, [tournamentId]);

  const deleteMatch = useCallback(async (matchId: string) => {
    if (!tournamentId) return;
    await remove(ref(database, `matches/${tournamentId}/${matchId}`));
  }, [tournamentId]);

  /**
   * 경기 일괄 생성 (스테이지 범위 교체).
   * options.replaceStages에 속한 스테이지의 기존 pending 경기만 새 경기로 교체한다.
   * 진행 중/완료 경기와 다른 스테이지의 경기는 삭제하지도, 다시 쓰지도 않는다.
   */
  const setMatchesBulk = useCallback(async (
    newMatches: Omit<Match, 'id'>[],
    options: MatchesBulkOptions,
  ): Promise<string[]> => {
    if (!tournamentId) return [];
    const basePath = `matches/${tournamentId}`;
    // New matches keyed by push IDs (or caller-provided keys when matches link to each other)
    const entries = newMatches.map((match, i) => ({ key: options.keys?.[i] || push(ref(database, basePath)).key!, match }));
    const existingSnap = await get(ref(database, basePath));
    const existingData = existingSnap.val() as Record<string, Partial<Match>> | null;
    const updates = buildMatchesBulkUpdate(existingData, entries, options.replaceStages);
    if (Object.keys(updates).length > 0) {
      // Multi-path update: matches outside the scope are never rewritten
      await update(ref(database, basePath), updates);
    }
    return entries.map(e => e.key);
  }, [tournamentId]);

  /** Batch update multiple matches at once using multi-path update (no transactions) */
  const updateMatchesBulk = useCallback(async (updates: Array<{ matchId: string; data: MatchUpdate }>) => {
    if (!tournamentId || updates.length === 0) return;
    const now = Date.now();
    const bulkUpdate: Record<string, unknown> = {};
    for (const { matchId, data } of updates) {
      const clean = Object.fromEntries(Object.entries({ ...data, updatedAt: now }).filter(([, v]) => v !== undefined));
      for (const [field, value] of Object.entries(clean)) {
        bulkUpdate[`matches/${tournamentId}/${matchId}/${field}`] = value;
      }
    }
    await update(ref(database), bulkUpdate);
  }, [tournamentId]);

  return { matches: stableMatches, loading, addMatch, updateMatch, updateMatchesBulk, deleteMatch, setMatchesBulk };
}

// ===== 단일 경기 구독 =====
export function useMatch(tournamentId: string | null, matchId: string | null) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId || !matchId) { setMatch(null); setLoading(false); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`matches/${tournamentId}/${matchId}`, (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      if (data) {
        // Firebase may store arrays as objects -- normalize all array fields
        normalizeMatchArrays(data);
        setMatch({ id: matchId, ...data });
      } else {
        setMatch(null);
      }
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId, matchId]);

  const updateMatch = useCallback(async (data: MatchUpdate): Promise<boolean> => {
    if (!tournamentId || !matchId) return false;
    const path = `matches/${tournamentId}/${matchId}`;
    if (!canWrite(path)) {
      console.warn('[useFirebase] Write rate limit exceeded for', path);
      return false;
    }
    const now = Date.now();
    // Issue 8: Cap scoreHistory before writing
    if (data.scoreHistory && Array.isArray(data.scoreHistory) && data.scoreHistory.length > MAX_SCORE_HISTORY) {
      data = { ...data, scoreHistory: data.scoreHistory.slice(0, MAX_SCORE_HISTORY) };
    }
    // Firebase does not accept undefined values — strip them
    const payload = Object.fromEntries(Object.entries({ ...data, updatedAt: now }).filter(([, v]) => v !== undefined));
    try {
      const result = await runTransaction(ref(database, path), (currentData) => {
        if (currentData === null) return payload;
        // Merge: always apply changes on top of server's latest state
        const merged = { ...currentData, ...payload };
        // DB 규칙은 updatedAt이 이전 값보다 커야 쓰기를 받는다. 다른 기기 시계가 앞서 있으면(시계 차이)
        // 이 기기의 Date.now()가 더 작아 거부되므로 항상 이전 값보다 크게 맞춘다 (경기 시계 쓰기, M0f).
        merged.updatedAt = monotonicUpdatedAt(now, currentData.updatedAt);
        if (payload.scoreHistory && currentData.scoreHistory) {
          const serverHistory = Array.isArray(currentData.scoreHistory) ? currentData.scoreHistory : Object.values(currentData.scoreHistory);
          const newHistory = payload.scoreHistory as unknown[];
          merged.scoreHistory = newHistory.length >= serverHistory.length ? newHistory : serverHistory;
        }
        return merged;
      });
      return result.committed;
    } catch (err) {
      console.error('[useMatch] updateMatch failed:', err);
      // Try direct update as fallback (transaction may fail on some Firebase configs)
      try {
        await update(ref(database, path), payload);
        return true;
      } catch (err2) {
        console.error('[useMatch] direct update also failed:', err2);
        queueUpdate(path, payload as Record<string, unknown>);
        return false;
      }
    }
  }, [tournamentId, matchId]);

  return { match, loading, updateMatch };
}

// ===== 대회별 팀 =====
export function useTeams(tournamentId: string | null) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setTeams([]); setLoading(false); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`teams/${tournamentId}`, (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setTeams(data ? Object.entries(data).map(([id, t]) => {
        const team = t as Record<string, unknown>;
        normalizeTeamArrays(team);
        return { id, ...(team as unknown as Omit<Team, 'id'>) };
      }) : []);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  /** 팀 목록을 주어진 집합으로 정확히 교체한다 (목록에 없는 팀은 삭제됨). */
  const setTeamsBulk = useCallback(async (newTeams: Team[]) => {
    if (!tournamentId) return;
    await set(ref(database, `teams/${tournamentId}`), buildTeamsBulkData(newTeams));
  }, [tournamentId]);

  return { teams, loading, setTeamsBulk };
}

// ===== 대회별 참가 선수 (로컬 Player 객체 저장) =====
export function useTournamentLocalPlayers(tournamentId: string | null) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setPlayers([]); setLoading(false); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`tournamentPlayers/${tournamentId}`, (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setPlayers(data ? Object.entries(data).map(([id, p]) => ({ id, ...(p as Omit<Player, 'id'>) })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')) : []);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  const addPlayer = useCallback(async (player: Omit<Player, 'id' | 'createdAt'>) => {
    if (!tournamentId) return null;
    const newRef = push(ref(database, `tournamentPlayers/${tournamentId}`));
    await set(newRef, { ...player, createdAt: Date.now() });
    return newRef.key;
  }, [tournamentId]);

  const updatePlayer = useCallback(async (id: string, data: Partial<Player>) => {
    if (!tournamentId) return;
    await update(ref(database, `tournamentPlayers/${tournamentId}/${id}`), data);
  }, [tournamentId]);

  const deletePlayer = useCallback(async (id: string) => {
    if (!tournamentId) return;
    await remove(ref(database, `tournamentPlayers/${tournamentId}/${id}`));
  }, [tournamentId]);

  const addPlayersFromGlobal = useCallback(async (globalPlayers: Player[]) => {
    if (!tournamentId) return;
    for (const p of globalPlayers) {
      const newRef = push(ref(database, `tournamentPlayers/${tournamentId}`));
      await set(newRef, { name: p.name, club: p.club || '', class: p.class || '', createdAt: Date.now() });
    }
  }, [tournamentId]);

  return { players, loading, addPlayer, updatePlayer, deletePlayer, addPlayersFromGlobal };
}

// ===== 대회별 심판 배정 =====
export function useTournamentReferees(tournamentId: string | null) {
  const [assignments, setAssignments] = useState<Record<string, { assignedMatchIds: string[] }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setAssignments({}); setLoading(false); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`tournamentReferees/${tournamentId}`, (snap) => {
      if (!isMounted) return;
      const raw = snap.val() || {};
      // Normalize assignedMatchIds arrays within each referee assignment
      const normalized: Record<string, { assignedMatchIds: string[] }> = {};
      for (const [key, value] of Object.entries(raw)) {
        const entry = value as Record<string, unknown>;
        const matchIds = entry.assignedMatchIds;
        normalized[key] = {
          assignedMatchIds: matchIds
            ? (Array.isArray(matchIds) ? matchIds : Object.values(matchIds as object))
            : [],
        };
      }
      setAssignments(normalized);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  const assignRefereeToMatch = useCallback(async (refereeId: string, matchIds: string[]) => {
    if (!tournamentId) return;
    await set(ref(database, `tournamentReferees/${tournamentId}/${refereeId}`), { assignedMatchIds: matchIds });
  }, [tournamentId]);

  return { assignments, loading, assignRefereeToMatch };
}

// ===== 스케줄 =====
export function useSchedule(tournamentId: string | null) {
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setSchedule([]); setLoading(false); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`schedule/${tournamentId}`, (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setSchedule(data ? Object.entries(data).map(([id, s]) => ({ id, ...(s as Omit<ScheduleSlot, 'id'>) })).sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || '')) : []);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  /**
   * 스케줄을 주어진 슬롯 집합으로 교체한다. 슬롯은 matchId를 키로 저장되어 같은 경기에 슬롯이 중복되지 않는다.
   * keepMatchIds에 있는 경기의 기존 슬롯은 새 슬롯에 없어도 유지된다 (예: 완료된 경기). 그 외 기존 슬롯은 제거된다.
   */
  const setScheduleBulk = useCallback(async (slots: Omit<ScheduleSlot, 'id'>[], keepMatchIds: Iterable<string> = []) => {
    if (!tournamentId) return;
    const path = `schedule/${tournamentId}`;
    const keep = [...keepMatchIds];
    let existingData: Record<string, Omit<ScheduleSlot, 'id'>> | null = null;
    if (keep.length > 0) {
      const existingSnap = await get(ref(database, path));
      existingData = existingSnap.val() as Record<string, Omit<ScheduleSlot, 'id'>> | null;
    }
    await set(ref(database, path), buildScheduleBulkData(existingData, slots, keep));
  }, [tournamentId]);

  /** Update or add a single schedule slot by matchId (no full rewrite) */
  const updateScheduleSlot = useCallback(async (slot: Omit<ScheduleSlot, 'id'>) => {
    if (!tournamentId) return;
    // Find existing slot by matchId
    const existingSlot = schedule.find(s => s.matchId === slot.matchId);
    if (existingSlot) {
      // Update in place
      await update(ref(database, `schedule/${tournamentId}/${existingSlot.id}`), slot);
    } else {
      // Add new slot, keyed deterministically by matchId (no duplicates)
      await set(ref(database, `schedule/${tournamentId}/${scheduleSlotKey(slot.matchId)}`), toFirebaseValue(slot));
    }
  }, [tournamentId, schedule]);

  return { schedule, loading, setScheduleBulk, updateScheduleSlot };
}

// ===== 알림 =====
const NOTIFICATION_LIMIT = 50;

export function useNotifications(tournamentId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!tournamentId) { setNotifications([]); return; }
    let isMounted = true;
    const path = `notifications/${tournamentId}`;
    const q = query(ref(database, path), limitToLast(NOTIFICATION_LIMIT));
    const unsub = subscribeToQuery(`${path}:last${NOTIFICATION_LIMIT}`, q, (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setNotifications(data ? Object.entries(data).map(([id, n]) => {
        const notif = n as Record<string, unknown>;
        // Normalize playerIds array
        if (notif.playerIds && !Array.isArray(notif.playerIds)) {
          notif.playerIds = Object.values(notif.playerIds as object);
        }
        return { id, ...(notif as unknown as Omit<Notification, 'id'>) };
      }).sort((a, b) => b.timestamp - a.timestamp) : []);
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  const addNotification = useCallback(async (notif: Omit<Notification, 'id'>) => {
    if (!tournamentId) return;
    const newRef = push(ref(database, `notifications/${tournamentId}`));
    await set(newRef, notif);
  }, [tournamentId]);

  return { notifications, addNotification };
}

// ===== 자동 진출 충돌 (서버 advanceOnMatchResult가 기록, 관리자 전용 읽기) =====
/** advancementConflicts/{tid}/{downstreamMatchId}/player{1|2} 기록 (functions/src/lib/advancement.ts ConflictRecord) */
export interface AdvancementConflict {
  downstreamMatchId: string;
  side: 1 | 2;
  sourceMatchId: string;
  outcome: 'winner' | 'loser';
  reason: 'downstream_started' | 'manual_override';
  downstreamStatus: string;
  currentId: string;
  currentName: string;
  expectedId: string;
  expectedName: string;
  createdAt: number;
  updatedAt: number;
}

export function useAdvancementConflicts(tournamentId: string | null) {
  const [conflicts, setConflicts] = useState<AdvancementConflict[]>([]);

  useEffect(() => {
    if (!tournamentId) { setConflicts([]); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`advancementConflicts/${tournamentId}`, (snap) => {
      if (!isMounted) return;
      const data = (snap.val() || {}) as Record<string, Record<string, Partial<AdvancementConflict>>>;
      const list: AdvancementConflict[] = [];
      for (const [did, sides] of Object.entries(data)) {
        for (const side of [1, 2] as const) {
          const rec = sides?.[`player${side}`];
          if (!rec) continue;
          list.push({
            downstreamMatchId: did,
            side,
            sourceMatchId: rec.sourceMatchId || '',
            outcome: rec.outcome === 'loser' ? 'loser' : 'winner',
            reason: rec.reason === 'manual_override' ? 'manual_override' : 'downstream_started',
            downstreamStatus: rec.downstreamStatus || '',
            currentId: rec.currentId || '',
            currentName: rec.currentName || '',
            expectedId: rec.expectedId || '',
            expectedName: rec.expectedName || '',
            createdAt: rec.createdAt || 0,
            updatedAt: rec.updatedAt || 0,
          });
        }
      }
      setConflicts(list.sort((a, b) => a.createdAt - b.createdAt));
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  /** 충돌 기록을 지운다 (현재 값 유지 또는 적용 후 정리) */
  const dismissConflict = useCallback(async (downstreamMatchId: string, side: 1 | 2): Promise<boolean> => {
    if (!tournamentId) return false;
    try {
      await remove(ref(database, `advancementConflicts/${tournamentId}/${downstreamMatchId}/player${side}`));
      return true;
    } catch (err) {
      console.error('[useAdvancementConflicts] dismiss failed', err);
      return false;
    }
  }, [tournamentId]);

  return { conflicts, dismissConflict };
}

// ===== 즐겨찾기 (localStorage 기반, 기기별 독립) =====
export interface FavoriteEntry { id: string; name: string }

function loadLocalFavorites(): FavoriteEntry[] {
  try {
    const stored = localStorage.getItem('showdown_favorites');
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    if (parsed.length > 0 && typeof parsed[0] === 'string') {
      const migrated = (parsed as string[]).map(id => ({ id, name: id }));
      try { localStorage.setItem('showdown_favorites', JSON.stringify(migrated)); } catch { /* ignore */ }
      return migrated;
    }
    return parsed.filter((e: unknown): e is FavoriteEntry =>
      typeof e === 'object' && e !== null && 'id' in e && 'name' in e
    );
  } catch { return []; }
}

function saveLocalFavorites(favorites: FavoriteEntry[]) {
  try { localStorage.setItem('showdown_favorites', JSON.stringify(favorites)); } catch { /* ignore */ }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteEntry[]>(loadLocalFavorites);
  const favoritesRef = useRef(favorites);
  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);

  const favoriteIds = useMemo(() => favorites.map(f => f.id), [favorites]);

  const toggleFavorite = useCallback((playerId: string, playerName?: string): string[] => {
    const prev = favoritesRef.current;
    const exists = prev.some(f => f.id === playerId);
    const next = exists
      ? prev.filter(f => f.id !== playerId)
      : [...prev, { id: playerId, name: playerName || playerId }];
    saveLocalFavorites(next);
    favoritesRef.current = next;
    setFavorites(next);
    return next.map(f => f.id);
  }, []);

  const isFavorite = useCallback((playerId: string) => {
    return favorites.some(f => f.id === playerId);
  }, [favorites]);

  const getFavoriteName = useCallback((playerId: string) => {
    return favorites.find(f => f.id === playerId)?.name || playerId;
  }, [favorites]);

  const updateFavoriteName = useCallback((playerId: string, name: string) => {
    const prev = favoritesRef.current;
    const entry = prev.find(f => f.id === playerId);
    if (!entry || entry.name === name) return;
    const next = prev.map(f => f.id === playerId ? { ...f, name } : f);
    saveLocalFavorites(next);
    favoritesRef.current = next;
    setFavorites(next);
  }, []);

  return { favoriteIds, favorites, toggleFavorite, isFavorite, getFavoriteName, updateFavoriteName };
}
