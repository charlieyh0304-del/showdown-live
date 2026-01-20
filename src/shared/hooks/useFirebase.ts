import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, set, push, remove, update } from 'firebase/database';
import { database } from '../config/firebase';
import type { Player, Tournament, Match, Referee, Court, RandomTeamLeague, TeamMatch } from '../types';

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

// 심판 관리 훅
export function useReferees() {
  const [referees, setReferees] = useState<Referee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const refereesRef = ref(database, 'referees');
    const unsubscribe = onValue(refereesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const refereeList = Object.entries(data).map(([id, referee]) => ({
          id,
          ...(referee as Omit<Referee, 'id'>),
        }));
        setReferees(refereeList.sort((a, b) => a.name.localeCompare(b.name, 'ko')));
      } else {
        setReferees([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addReferee = useCallback(async (referee: Omit<Referee, 'id' | 'createdAt'>) => {
    const refereesRef = ref(database, 'referees');
    const newRef = push(refereesRef);
    await set(newRef, { ...referee, createdAt: Date.now() });
    return newRef.key;
  }, []);

  const updateReferee = useCallback(async (id: string, data: Partial<Referee>) => {
    const refereeRef = ref(database, `referees/${id}`);
    await update(refereeRef, data);
  }, []);

  const deleteReferee = useCallback(async (id: string) => {
    const refereeRef = ref(database, `referees/${id}`);
    await remove(refereeRef);
  }, []);

  return { referees, loading, addReferee, updateReferee, deleteReferee };
}

// 경기장 관리 훅
export function useCourts() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const courtsRef = ref(database, 'courts');
    const unsubscribe = onValue(courtsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const courtList = Object.entries(data).map(([id, court]) => ({
          id,
          ...(court as Omit<Court, 'id'>),
        }));
        setCourts(courtList.sort((a, b) => a.name.localeCompare(b.name, 'ko')));
      } else {
        setCourts([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addCourt = useCallback(async (court: Omit<Court, 'id' | 'createdAt'>) => {
    const courtsRef = ref(database, 'courts');
    const newRef = push(courtsRef);
    await set(newRef, { ...court, createdAt: Date.now() });
    return newRef.key;
  }, []);

  const updateCourt = useCallback(async (id: string, data: Partial<Court>) => {
    const courtRef = ref(database, `courts/${id}`);
    await update(courtRef, data);
  }, []);

  const deleteCourt = useCallback(async (id: string) => {
    const courtRef = ref(database, `courts/${id}`);
    await remove(courtRef);
  }, []);

  return { courts, loading, addCourt, updateCourt, deleteCourt };
}

// 랜덤 팀 리그전 관리 훅
export function useRandomTeamLeagues() {
  const [leagues, setLeagues] = useState<RandomTeamLeague[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const leaguesRef = ref(database, 'randomTeamLeagues');
    const unsubscribe = onValue(leaguesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const leagueList = Object.entries(data).map(([id, league]) => ({
          id,
          ...(league as Omit<RandomTeamLeague, 'id'>),
        }));
        setLeagues(leagueList.sort((a, b) => b.createdAt - a.createdAt));
      } else {
        setLeagues([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addLeague = useCallback(async (league: Omit<RandomTeamLeague, 'id' | 'createdAt'>) => {
    const leaguesRef = ref(database, 'randomTeamLeagues');
    const newRef = push(leaguesRef);
    await set(newRef, { ...league, createdAt: Date.now() });
    return newRef.key;
  }, []);

  const updateLeague = useCallback(async (id: string, data: Partial<RandomTeamLeague>) => {
    const leagueRef = ref(database, `randomTeamLeagues/${id}`);
    await update(leagueRef, data);
  }, []);

  const deleteLeague = useCallback(async (id: string) => {
    const leagueRef = ref(database, `randomTeamLeagues/${id}`);
    await remove(leagueRef);
    // 관련 팀경기도 삭제
    const matchesRef = ref(database, `teamMatches/${id}`);
    await remove(matchesRef);
  }, []);

  return { leagues, loading, addLeague, updateLeague, deleteLeague };
}

// 단일 랜덤 팀 리그전 구독
export function useRandomTeamLeague(leagueId: string | null) {
  const [league, setLeague] = useState<RandomTeamLeague | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId) {
      setLeague(null);
      setLoading(false);
      return;
    }

    const leagueRef = ref(database, `randomTeamLeagues/${leagueId}`);
    const unsubscribe = onValue(leagueRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setLeague({ id: leagueId, ...data });
      } else {
        setLeague(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [leagueId]);

  const updateLeague = useCallback(async (data: Partial<RandomTeamLeague>) => {
    if (!leagueId) return;
    const leagueRef = ref(database, `randomTeamLeagues/${leagueId}`);
    await update(leagueRef, data);
  }, [leagueId]);

  return { league, loading, updateLeague };
}

// 팀 경기 관리 훅
export function useTeamMatches(leagueId: string | null) {
  const [teamMatches, setTeamMatches] = useState<TeamMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId) {
      setTeamMatches([]);
      setLoading(false);
      return;
    }

    const matchesRef = ref(database, `teamMatches/${leagueId}`);
    const unsubscribe = onValue(matchesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const matchList = Object.entries(data).map(([id, match]) => ({
          id,
          ...(match as Omit<TeamMatch, 'id'>),
        }));
        setTeamMatches(matchList.sort((a, b) => a.round - b.round));
      } else {
        setTeamMatches([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [leagueId]);

  const addTeamMatch = useCallback(async (match: Omit<TeamMatch, 'id'>) => {
    if (!leagueId) return null;
    const matchesRef = ref(database, `teamMatches/${leagueId}`);
    const newRef = push(matchesRef);
    await set(newRef, match);
    return newRef.key;
  }, [leagueId]);

  const updateTeamMatch = useCallback(async (matchId: string, data: Partial<TeamMatch>) => {
    if (!leagueId) return;
    const matchRef = ref(database, `teamMatches/${leagueId}/${matchId}`);
    await update(matchRef, data);
  }, [leagueId]);

  const setTeamMatchesBulk = useCallback(async (newMatches: Omit<TeamMatch, 'id'>[]) => {
    if (!leagueId) return;
    const matchesRef = ref(database, `teamMatches/${leagueId}`);
    await remove(matchesRef);
    for (const match of newMatches) {
      const newRef = push(matchesRef);
      await set(newRef, match);
    }
  }, [leagueId]);

  return { teamMatches, loading, addTeamMatch, updateTeamMatch, setTeamMatchesBulk };
}
