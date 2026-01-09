import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, set, push, remove, update } from 'firebase/database';
import { database } from '../config/firebase';
import type { Player, Tournament, Match } from '../types';

// 선수 관리 훅
export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const playersRef = ref(database, 'players');
    const unsubscribe = onValue(playersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const playerList = Object.entries(data).map(([id, player]) => ({
          id,
          ...(player as Omit<Player, 'id'>),
        }));
        setPlayers(playerList.sort((a, b) => a.name.localeCompare(b.name, 'ko')));
      } else {
        setPlayers([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addPlayer = useCallback(async (player: Omit<Player, 'id' | 'createdAt'>) => {
    const playersRef = ref(database, 'players');
    const newRef = push(playersRef);
    await set(newRef, { ...player, createdAt: Date.now() });
    return newRef.key;
  }, []);

  const updatePlayer = useCallback(async (id: string, data: Partial<Player>) => {
    const playerRef = ref(database, `players/${id}`);
    await update(playerRef, data);
  }, []);

  const deletePlayer = useCallback(async (id: string) => {
    const playerRef = ref(database, `players/${id}`);
    await remove(playerRef);
  }, []);

  return { players, loading, addPlayer, updatePlayer, deletePlayer };
}

// 대회 관리 훅
export function useTournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tournamentsRef = ref(database, 'tournaments');
    const unsubscribe = onValue(tournamentsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const tournamentList = Object.entries(data).map(([id, tournament]) => ({
          id,
          ...(tournament as Omit<Tournament, 'id'>),
        }));
        setTournaments(tournamentList.sort((a, b) => b.createdAt - a.createdAt));
      } else {
        setTournaments([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addTournament = useCallback(async (tournament: Omit<Tournament, 'id' | 'createdAt'>) => {
    const tournamentsRef = ref(database, 'tournaments');
    const newRef = push(tournamentsRef);
    await set(newRef, { ...tournament, createdAt: Date.now() });
    return newRef.key;
  }, []);

  const updateTournament = useCallback(async (id: string, data: Partial<Tournament>) => {
    const tournamentRef = ref(database, `tournaments/${id}`);
    await update(tournamentRef, data);
  }, []);

  const deleteTournament = useCallback(async (id: string) => {
    const tournamentRef = ref(database, `tournaments/${id}`);
    await remove(tournamentRef);
    // 관련 경기도 삭제
    const matchesRef = ref(database, `matches/${id}`);
    await remove(matchesRef);
  }, []);

  return { tournaments, loading, addTournament, updateTournament, deleteTournament };
}

// 경기 관리 훅
export function useMatches(tournamentId: string | null) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) {
      setMatches([]);
      setLoading(false);
      return;
    }

    const matchesRef = ref(database, `matches/${tournamentId}`);
    const unsubscribe = onValue(matchesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const matchList = Object.entries(data).map(([id, match]) => ({
          id,
          ...(match as Omit<Match, 'id'>),
        }));
        setMatches(matchList.sort((a, b) => {
          if (a.round !== b.round) return a.round - b.round;
          return a.position - b.position;
        }));
      } else {
        setMatches([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tournamentId]);

  const addMatch = useCallback(async (match: Omit<Match, 'id'>) => {
    if (!tournamentId) return null;
    const matchesRef = ref(database, `matches/${tournamentId}`);
    const newRef = push(matchesRef);
    await set(newRef, match);
    return newRef.key;
  }, [tournamentId]);

  const updateMatch = useCallback(async (matchId: string, data: Partial<Match>) => {
    if (!tournamentId) return;
    const matchRef = ref(database, `matches/${tournamentId}/${matchId}`);
    await update(matchRef, data);
  }, [tournamentId]);

  const setMatches_ = useCallback(async (newMatches: Omit<Match, 'id'>[]) => {
    if (!tournamentId) return;
    const matchesRef = ref(database, `matches/${tournamentId}`);
    await remove(matchesRef);
    for (const match of newMatches) {
      const newRef = push(matchesRef);
      await set(newRef, match);
    }
  }, [tournamentId]);

  return { matches, loading, addMatch, updateMatch, setMatches: setMatches_ };
}

// 단일 경기 구독
export function useMatch(tournamentId: string | null, matchId: string | null) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId || !matchId) {
      setMatch(null);
      setLoading(false);
      return;
    }

    const matchRef = ref(database, `matches/${tournamentId}/${matchId}`);
    const unsubscribe = onValue(matchRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setMatch({ id: matchId, ...data });
      } else {
        setMatch(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tournamentId, matchId]);

  const updateMatch = useCallback(async (data: Partial<Match>) => {
    if (!tournamentId || !matchId) return;
    const matchRef = ref(database, `matches/${tournamentId}/${matchId}`);
    await update(matchRef, data);
  }, [tournamentId, matchId]);

  return { match, loading, updateMatch };
}
