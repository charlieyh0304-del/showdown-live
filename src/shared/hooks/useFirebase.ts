import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, set, push, remove, update } from 'firebase/database';
import { database } from '../config/firebase';
import type { Player, Referee, Court, Tournament, Match, Team, ScheduleSlot, Notification } from '../types';

// ===== 선수 =====
export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onValue(ref(database, 'players'), (snap) => {
      const data = snap.val();
      setPlayers(data ? Object.entries(data).map(([id, p]) => ({ id, ...(p as Omit<Player, 'id'>) })).sort((a, b) => a.name.localeCompare(b.name, 'ko')) : []);
      setLoading(false);
    });
    return () => unsub();
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
    const unsub = onValue(ref(database, 'referees'), (snap) => {
      const data = snap.val();
      setReferees(data ? Object.entries(data).map(([id, r]) => ({ id, ...(r as Omit<Referee, 'id'>) })).sort((a, b) => a.name.localeCompare(b.name, 'ko')) : []);
      setLoading(false);
    });
    return () => unsub();
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
    const unsub = onValue(ref(database, 'courts'), (snap) => {
      const data = snap.val();
      setCourts(data ? Object.entries(data).map(([id, c]) => ({ id, ...(c as Omit<Court, 'id'>) })).sort((a, b) => a.name.localeCompare(b.name, 'ko')) : []);
      setLoading(false);
    });
    return () => unsub();
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
    const unsub = onValue(ref(database, 'tournaments'), (snap) => {
      const data = snap.val();
      setTournaments(data ? Object.entries(data).map(([id, t]) => ({ id, ...(t as Omit<Tournament, 'id'>) })).sort((a, b) => b.createdAt - a.createdAt) : []);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const addTournament = useCallback(async (tournament: Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newRef = push(ref(database, 'tournaments'));
    const now = Date.now();
    await set(newRef, { ...tournament, createdAt: now, updatedAt: now });
    return newRef.key;
  }, []);

  const updateTournament = useCallback(async (id: string, data: Partial<Tournament>) => {
    await update(ref(database, `tournaments/${id}`), { ...data, updatedAt: Date.now() });
  }, []);

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
    const unsub = onValue(ref(database, `tournaments/${tournamentId}`), (snap) => {
      const data = snap.val();
      setTournament(data ? { id: tournamentId, ...data } : null);
      setLoading(false);
    });
    return () => unsub();
  }, [tournamentId]);

  const updateTournament = useCallback(async (data: Partial<Tournament>) => {
    if (!tournamentId) return;
    await update(ref(database, `tournaments/${tournamentId}`), { ...data, updatedAt: Date.now() });
  }, [tournamentId]);

  return { tournament, loading, updateTournament };
}

// ===== 대회별 경기 =====
export function useMatches(tournamentId: string | null) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setMatches([]); setLoading(false); return; }
    const unsub = onValue(ref(database, `matches/${tournamentId}`), (snap) => {
      const data = snap.val();
      setMatches(data ? Object.entries(data).map(([id, m]) => ({ id, ...(m as Omit<Match, 'id'>) })).sort((a, b) => a.round - b.round) : []);
      setLoading(false);
    });
    return () => unsub();
  }, [tournamentId]);

  const addMatch = useCallback(async (match: Omit<Match, 'id'>) => {
    if (!tournamentId) return null;
    const newRef = push(ref(database, `matches/${tournamentId}`));
    await set(newRef, match);
    return newRef.key;
  }, [tournamentId]);

  const updateMatch = useCallback(async (matchId: string, data: Partial<Match>) => {
    if (!tournamentId) return;
    await update(ref(database, `matches/${tournamentId}/${matchId}`), { ...data, updatedAt: Date.now() });
  }, [tournamentId]);

  const deleteMatch = useCallback(async (matchId: string) => {
    if (!tournamentId) return;
    await remove(ref(database, `matches/${tournamentId}/${matchId}`));
  }, [tournamentId]);

  const setMatchesBulk = useCallback(async (newMatches: Omit<Match, 'id'>[]) => {
    if (!tournamentId) return;
    await remove(ref(database, `matches/${tournamentId}`));
    for (const match of newMatches) {
      const newRef = push(ref(database, `matches/${tournamentId}`));
      await set(newRef, match);
    }
  }, [tournamentId]);

  return { matches, loading, addMatch, updateMatch, deleteMatch, setMatchesBulk };
}

// ===== 단일 경기 구독 =====
export function useMatch(tournamentId: string | null, matchId: string | null) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId || !matchId) { setMatch(null); setLoading(false); return; }
    const unsub = onValue(ref(database, `matches/${tournamentId}/${matchId}`), (snap) => {
      const data = snap.val();
      setMatch(data ? { id: matchId, ...data } : null);
      setLoading(false);
    });
    return () => unsub();
  }, [tournamentId, matchId]);

  const updateMatch = useCallback(async (data: Partial<Match>) => {
    if (!tournamentId || !matchId) return;
    await update(ref(database, `matches/${tournamentId}/${matchId}`), { ...data, updatedAt: Date.now() });
  }, [tournamentId, matchId]);

  return { match, loading, updateMatch };
}

// ===== 대회별 팀 =====
export function useTeams(tournamentId: string | null) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setTeams([]); setLoading(false); return; }
    const unsub = onValue(ref(database, `teams/${tournamentId}`), (snap) => {
      const data = snap.val();
      setTeams(data ? Object.entries(data).map(([id, t]) => ({ id, ...(t as Omit<Team, 'id'>) })) : []);
      setLoading(false);
    });
    return () => unsub();
  }, [tournamentId]);

  const setTeamsBulk = useCallback(async (newTeams: Team[]) => {
    if (!tournamentId) return;
    await remove(ref(database, `teams/${tournamentId}`));
    for (const team of newTeams) {
      await set(ref(database, `teams/${tournamentId}/${team.id}`), team);
    }
  }, [tournamentId]);

  return { teams, loading, setTeamsBulk };
}

// ===== 대회별 참가 선수 =====
export function useTournamentPlayers(tournamentId: string | null) {
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setPlayerIds([]); setLoading(false); return; }
    const unsub = onValue(ref(database, `tournamentPlayers/${tournamentId}`), (snap) => {
      const data = snap.val();
      setPlayerIds(data ? Object.keys(data) : []);
      setLoading(false);
    });
    return () => unsub();
  }, [tournamentId]);

  const setTournamentPlayers = useCallback(async (ids: string[]) => {
    if (!tournamentId) return;
    const data: Record<string, boolean> = {};
    ids.forEach(id => { data[id] = true; });
    await set(ref(database, `tournamentPlayers/${tournamentId}`), data);
  }, [tournamentId]);

  return { playerIds, loading, setTournamentPlayers };
}

// ===== 대회별 심판 배정 =====
export function useTournamentReferees(tournamentId: string | null) {
  const [assignments, setAssignments] = useState<Record<string, { assignedMatchIds: string[] }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) { setAssignments({}); setLoading(false); return; }
    const unsub = onValue(ref(database, `tournamentReferees/${tournamentId}`), (snap) => {
      setAssignments(snap.val() || {});
      setLoading(false);
    });
    return () => unsub();
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
    const unsub = onValue(ref(database, `schedule/${tournamentId}`), (snap) => {
      const data = snap.val();
      setSchedule(data ? Object.entries(data).map(([id, s]) => ({ id, ...(s as Omit<ScheduleSlot, 'id'>) })).sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)) : []);
      setLoading(false);
    });
    return () => unsub();
  }, [tournamentId]);

  const setScheduleBulk = useCallback(async (slots: Omit<ScheduleSlot, 'id'>[]) => {
    if (!tournamentId) return;
    await remove(ref(database, `schedule/${tournamentId}`));
    for (const slot of slots) {
      const newRef = push(ref(database, `schedule/${tournamentId}`));
      await set(newRef, slot);
    }
  }, [tournamentId]);

  return { schedule, loading, setScheduleBulk };
}

// ===== 알림 =====
export function useNotifications(tournamentId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!tournamentId) { setNotifications([]); return; }
    const unsub = onValue(ref(database, `notifications/${tournamentId}`), (snap) => {
      const data = snap.val();
      setNotifications(data ? Object.entries(data).map(([id, n]) => ({ id, ...(n as Omit<Notification, 'id'>) })).sort((a, b) => b.timestamp - a.timestamp) : []);
    });
    return () => unsub();
  }, [tournamentId]);

  const addNotification = useCallback(async (notif: Omit<Notification, 'id'>) => {
    if (!tournamentId) return;
    const newRef = push(ref(database, `notifications/${tournamentId}`));
    await set(newRef, notif);
  }, [tournamentId]);

  return { notifications, addNotification };
}

// ===== 즐겨찾기 (localStorage 기반) =====
export function useFavorites() {
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('showdown_favorites');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = useCallback((playerId: string) => {
    setFavoriteIds(prev => {
      const next = prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId];
      localStorage.setItem('showdown_favorites', JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback((playerId: string) => {
    return favoriteIds.includes(playerId);
  }, [favoriteIds]);

  return { favoriteIds, toggleFavorite, isFavorite };
}
