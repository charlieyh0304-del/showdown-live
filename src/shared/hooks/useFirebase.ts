import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ref, onValue, set, push, remove, update, get, runTransaction, type DataSnapshot } from 'firebase/database';
import { database, auth, signInWithGoogle } from '../config/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { queueUpdate } from '../utils/offlineQueue';
import type { Player, Referee, Court, Tournament, Match, Team, ScheduleSlot, Notification } from '../types';

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
const listenerCache = new Map<string, { unsub: () => void; count: number; callbacks: Set<(data: DataSnapshot) => void> }>();

function subscribeToPath(path: string, callback: (snapshot: DataSnapshot) => void): () => void {
  if (listenerCache.has(path)) {
    const entry = listenerCache.get(path)!;
    entry.count++;
    entry.callbacks.add(callback);
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
  const unsub = onValue(ref(database, path), (snap) => {
    callbacks.forEach(cb => cb(snap));
  });
  listenerCache.set(path, { unsub, count: 1, callbacks });
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
export function useTournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const unsub = subscribeToPath('tournaments', (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setTournaments(data ? Object.entries(data).map(([id, t]) => {
        const tournament = t as Record<string, unknown>;
        normalizeTournamentArrays(tournament);
        return { id, ...(tournament as unknown as Omit<Tournament, 'id'>) };
      }).sort((a, b) => b.createdAt - a.createdAt) : []);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, []);

  const addTournament = useCallback(async (tournament: Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newRef = push(ref(database, 'tournaments'));
    const now = Date.now();
    await set(newRef, { ...tournament, createdAt: now, updatedAt: now });
    return newRef.key;
  }, []);

  const updateTournament = useCallback(async (id: string, data: Partial<Tournament>): Promise<boolean> => {
    const path = `tournaments/${id}`;
    const now = Date.now();
    const payload = { ...data, updatedAt: now };
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
    const payload = { ...data, updatedAt: now };
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
export function useMatches(tournamentId: string | null) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setMatches([]); setLoading(false); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`matches/${tournamentId}`, (snap) => {
      if (!isMounted) return;
      const data = snap.val();
      setMatches(data ? Object.entries(data).map(([id, raw]) => {
        const m = raw as Record<string, unknown>;
        normalizeMatchArrays(m);
        return { id, ...(m as unknown as Omit<Match, 'id'>) };
      }).sort((a, b) => (a.round ?? 0) - (b.round ?? 0)) : []);
      setLoading(false);
    });
    return () => { isMounted = false; unsub(); };
  }, [tournamentId]);

  // Issue 5: Memoize stable match reference to avoid unnecessary re-renders
  const stableMatches = useMemo(() => matches, [JSON.stringify(matches.map(m => m.id + ':' + m.updatedAt))]);

  const addMatch = useCallback(async (match: Omit<Match, 'id'>) => {
    if (!tournamentId) return null;
    const newRef = push(ref(database, `matches/${tournamentId}`));
    await set(newRef, match);
    return newRef.key;
  }, [tournamentId]);

  const updateMatch = useCallback(async (matchId: string, data: Partial<Match>): Promise<boolean> => {
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
    const payload = { ...data, updatedAt: now };
    try {
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
    } catch {
      queueUpdate(path, payload as Record<string, unknown>);
      return true;
    }
  }, [tournamentId]);

  const deleteMatch = useCallback(async (matchId: string) => {
    if (!tournamentId) return;
    await remove(ref(database, `matches/${tournamentId}/${matchId}`));
  }, [tournamentId]);

  const setMatchesBulk = useCallback(async (newMatches: Omit<Match, 'id'>[]): Promise<string[]> => {
    if (!tournamentId) return [];
    // Build new matches keyed by push IDs
    const bulkData: Record<string, unknown> = {};
    const ids: string[] = [];
    for (const match of newMatches) {
      const clean = JSON.parse(JSON.stringify(match));
      const newRef = push(ref(database, `matches/${tournamentId}`));
      bulkData[newRef.key!] = clean;
      ids.push(newRef.key!);
    }
    // Merge: preserve in-progress/completed matches, only overwrite pending ones
    const existingSnap = await get(ref(database, `matches/${tournamentId}`));
    const existingData = existingSnap.val() as Record<string, Record<string, unknown>> | null;
    if (existingData) {
      for (const [key, match] of Object.entries(existingData)) {
        if (match.status === 'in_progress' || match.status === 'completed') {
          bulkData[key] = match; // Preserve in-progress/completed matches
        }
      }
    }
    await set(ref(database, `matches/${tournamentId}`), bulkData);
    return ids;
  }, [tournamentId]);

  return { matches: stableMatches, loading, addMatch, updateMatch, deleteMatch, setMatchesBulk };
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

  const updateMatch = useCallback(async (data: Partial<Match>): Promise<boolean> => {
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
    const payload = { ...data, updatedAt: now };
    try {
      const result = await runTransaction(ref(database, path), (currentData) => {
        if (currentData === null) return payload;
        // Merge: always apply changes on top of server's latest state
        const merged = { ...currentData, ...payload };
        if (payload.scoreHistory && currentData.scoreHistory) {
          const serverHistory = Array.isArray(currentData.scoreHistory) ? currentData.scoreHistory : Object.values(currentData.scoreHistory);
          const newHistory = payload.scoreHistory as unknown[];
          merged.scoreHistory = newHistory.length >= serverHistory.length ? newHistory : serverHistory;
        }
        return merged;
      });
      return result.committed;
    } catch {
      queueUpdate(path, payload as Record<string, unknown>);
      return true;
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

  const setTeamsBulk = useCallback(async (newTeams: Team[]) => {
    if (!tournamentId) return;
    // Build new teams data
    const bulkData: Record<string, Team> = {};
    for (const team of newTeams) {
      bulkData[team.id] = team;
    }
    // Merge: preserve existing teams not in the new set
    const existingSnap = await get(ref(database, `teams/${tournamentId}`));
    const existingData = existingSnap.val() as Record<string, Team> | null;
    if (existingData) {
      for (const [key, team] of Object.entries(existingData)) {
        if (!(key in bulkData)) {
          bulkData[key] = team; // Preserve existing teams not being replaced
        }
      }
    }
    await set(ref(database, `teams/${tournamentId}`), bulkData);
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

  const setScheduleBulk = useCallback(async (slots: Omit<ScheduleSlot, 'id'>[]) => {
    if (!tournamentId) return;
    // Build new schedule data
    const bulkData: Record<string, Omit<ScheduleSlot, 'id'>> = {};
    for (const slot of slots) {
      const newRef = push(ref(database, `schedule/${tournamentId}`));
      bulkData[newRef.key!] = slot;
    }
    // Merge: preserve existing schedule entries
    const existingSnap = await get(ref(database, `schedule/${tournamentId}`));
    const existingData = existingSnap.val() as Record<string, Omit<ScheduleSlot, 'id'>> | null;
    if (existingData) {
      for (const [key, slot] of Object.entries(existingData)) {
        if (!(key in bulkData)) {
          bulkData[key] = slot; // Preserve existing schedule slots
        }
      }
    }
    await set(ref(database, `schedule/${tournamentId}`), bulkData);
  }, [tournamentId]);

  return { schedule, loading, setScheduleBulk };
}

// ===== 알림 =====
export function useNotifications(tournamentId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!tournamentId) { setNotifications([]); return; }
    let isMounted = true;
    const unsub = subscribeToPath(`notifications/${tournamentId}`, (snap) => {
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

// ===== 즐겨찾기 (Firebase Auth UID 기반 자동 동기화) =====
export interface FavoriteEntry { id: string; name: string }

function loadLocalFavorites(): FavoriteEntry[] {
  try {
    const stored = localStorage.getItem('showdown_favorites');
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    if (parsed.length > 0 && typeof parsed[0] === 'string') {
      return (parsed as string[]).map(id => ({ id, name: id }));
    }
    return parsed.filter((e: unknown): e is FavoriteEntry =>
      typeof e === 'object' && e !== null && 'id' in e && 'name' in e
    );
  } catch { return []; }
}

function saveLocalFavorites(favorites: FavoriteEntry[]) {
  try { localStorage.setItem('showdown_favorites', JSON.stringify(favorites)); } catch { /* ignore */ }
}

function parseFavorites(data: unknown): FavoriteEntry[] {
  if (!data) return [];
  const arr = Array.isArray(data) ? data : Object.values(data);
  return (arr as unknown[]).filter((e): e is FavoriteEntry =>
    typeof e === 'object' && e !== null && 'id' in (e as Record<string, unknown>) && 'name' in (e as Record<string, unknown>)
  );
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteEntry[]>(loadLocalFavorites);
  const [uid, setUid] = useState<string | null>(null);
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  const favoritesRef = useRef(favorites);
  const writingRef = useRef(false);
  const unsubFbRef = useRef<(() => void) | null>(null);

  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);

  // Track Firebase Auth state → use UID for sync path
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) {
        setUid(user.uid);
        setIsGoogleUser(user.providerData.some(p => p.providerId === 'google.com'));
      }
    });
    return unsub;
  }, []);

  // Subscribe to Firebase favorites when UID is available
  useEffect(() => {
    if (!uid) return;
    // Migrate local favorites to Firebase on first sign-in
    const local = loadLocalFavorites();
    if (local.length > 0) {
      get(ref(database, `userFavorites/${uid}`)).then(snap => {
        if (!snap.val()) {
          set(ref(database, `userFavorites/${uid}`), local).catch(() => {});
        } else {
          // Merge local + remote
          const remote = parseFavorites(snap.val());
          const merged = [...remote];
          for (const l of local) {
            if (!merged.some(m => m.id === l.id)) merged.push(l);
          }
          if (merged.length > remote.length) {
            set(ref(database, `userFavorites/${uid}`), merged).catch(() => {});
          }
        }
      }).catch(() => {});
    }

    const unsub = onValue(ref(database, `userFavorites/${uid}`), snap => {
      if (writingRef.current) { writingRef.current = false; return; }
      const valid = parseFavorites(snap.val());
      if (valid.length > 0 || snap.exists()) {
        saveLocalFavorites(valid);
        favoritesRef.current = valid;
        setFavorites(valid);
      }
    });
    unsubFbRef.current = unsub;
    return unsub;
  }, [uid]);

  const syncToFirebase = useCallback((data: FavoriteEntry[]) => {
    if (!uid) return;
    writingRef.current = true;
    set(ref(database, `userFavorites/${uid}`), data).catch(() => {});
  }, [uid]);

  const favoriteIds = useMemo(() => favorites.map(f => f.id), [favorites]);

  const toggleFavorite = useCallback((playerId: string, playerName?: string): string[] => {
    const prev = favoritesRef.current;
    const exists = prev.some(f => f.id === playerId);
    const next = exists
      ? prev.filter(f => f.id !== playerId)
      : [...prev, { id: playerId, name: playerName || playerId }];
    saveLocalFavorites(next);
    syncToFirebase(next);
    favoritesRef.current = next;
    setFavorites(next);
    return next.map(f => f.id);
  }, [syncToFirebase]);

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
    syncToFirebase(next);
    favoritesRef.current = next;
    setFavorites(next);
  }, [syncToFirebase]);

  // Google sign-in for cross-device sync
  const loginWithGoogle = useCallback(async (): Promise<boolean> => {
    const user = await signInWithGoogle();
    return !!user;
  }, []);

  const logoutGoogle = useCallback(async () => {
    await signOut(auth);
  }, []);

  return { favoriteIds, favorites, toggleFavorite, isFavorite, getFavoriteName, updateFavoriteName, isGoogleUser, loginWithGoogle, logoutGoogle };
}
