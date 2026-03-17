import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, set, push, remove, update } from 'firebase/database';
import { database } from '../config/firebase';
import type { Player, Referee, Court, IndividualGame, TeamMatchGame, RandomTeamLeague, TeamMatch, IndividualMatch } from '../types';
import { checkTeamMatchWinner } from '../types';

// 선수 목록 훅
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

  return { players, loading };
}

// 심판 목록 훅
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

  return { referees, loading };
}

// 경기장 목록 훅
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

  return { courts, loading };
}

// 개인전 목록 훅
export function useIndividualGames() {
  const [games, setGames] = useState<IndividualGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const gamesRef = ref(database, 'individualGames');
    const unsubscribe = onValue(gamesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const gameList = Object.entries(data).map(([id, game]) => ({
          id,
          ...(game as Omit<IndividualGame, 'id'>),
        }));
        setGames(gameList.sort((a, b) => b.createdAt - a.createdAt));
      } else {
        setGames([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addGame = useCallback(async (game: Omit<IndividualGame, 'id'>) => {
    const gamesRef = ref(database, 'individualGames');
    const newRef = push(gamesRef);
    await set(newRef, game);
    return newRef.key;
  }, []);

  const deleteGame = useCallback(async (id: string) => {
    const gameRef = ref(database, `individualGames/${id}`);
    await remove(gameRef);
  }, []);

  return { games, loading, addGame, deleteGame };
}

// 단일 개인전 구독 훅
export function useIndividualGame(gameId: string | null) {
  const [game, setGame] = useState<IndividualGame | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) {
      setGame(null);
      setLoading(false);
      return;
    }
    const gameRef = ref(database, `individualGames/${gameId}`);
    const unsubscribe = onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setGame({ id: gameId, ...data });
      } else {
        setGame(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [gameId]);

  const updateGame = useCallback(async (data: Partial<IndividualGame>) => {
    if (!gameId) return;
    const gameRef = ref(database, `individualGames/${gameId}`);
    await update(gameRef, data);
  }, [gameId]);

  return { game, loading, updateGame };
}

// 팀전 목록 훅
export function useTeamMatchGames() {
  const [games, setGames] = useState<TeamMatchGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const gamesRef = ref(database, 'teamMatchGames');
    const unsubscribe = onValue(gamesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const gameList = Object.entries(data).map(([id, game]) => ({
          id,
          ...(game as Omit<TeamMatchGame, 'id'>),
        }));
        setGames(gameList.sort((a, b) => b.createdAt - a.createdAt));
      } else {
        setGames([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addGame = useCallback(async (game: Omit<TeamMatchGame, 'id'>) => {
    const gamesRef = ref(database, 'teamMatchGames');
    const newRef = push(gamesRef);
    await set(newRef, game);
    return newRef.key;
  }, []);

  const deleteGame = useCallback(async (id: string) => {
    const gameRef = ref(database, `teamMatchGames/${id}`);
    await remove(gameRef);
  }, []);

  return { games, loading, addGame, deleteGame };
}

// 단일 팀전 구독 훅
export function useTeamMatchGame(gameId: string | null) {
  const [game, setGame] = useState<TeamMatchGame | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) {
      setGame(null);
      setLoading(false);
      return;
    }
    const gameRef = ref(database, `teamMatchGames/${gameId}`);
    const unsubscribe = onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setGame({ id: gameId, ...data });
      } else {
        setGame(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [gameId]);

  const updateGame = useCallback(async (data: Partial<TeamMatchGame>) => {
    if (!gameId) return;
    const gameRef = ref(database, `teamMatchGames/${gameId}`);
    await update(gameRef, data);
  }, [gameId]);

  const updateIndividualMatch = useCallback(async (
    matchIndex: number,
    individualData: Partial<IndividualMatch>,
    currentGame: TeamMatchGame,
  ) => {
    if (!gameId) return;

    const updatedMatches = [...currentGame.matches];
    updatedMatches[matchIndex] = { ...updatedMatches[matchIndex], ...individualData };

    const updateData: Partial<TeamMatchGame> = { matches: updatedMatches };

    if (!currentGame.winnerId) {
      const winner = checkTeamMatchWinner(
        updatedMatches,
        currentGame.team1.id,
        currentGame.team2.id,
      );
      if (winner) {
        updateData.winnerId = winner;
        updateData.status = 'completed';
      } else if (currentGame.status === 'pending') {
        updateData.status = 'in_progress';
      }
    }

    const gameRef = ref(database, `teamMatchGames/${gameId}`);
    await update(gameRef, updateData);
  }, [gameId]);

  return { game, loading, updateGame, updateIndividualMatch };
}

// 랜덤 팀 리그전 목록 훅
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

// 팀 경기 관리 훅 (리그전 내)
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

  const updateTeamMatch = useCallback(async (matchId: string, data: Partial<TeamMatch>) => {
    if (!leagueId) return;
    const matchRef = ref(database, `teamMatches/${leagueId}/${matchId}`);
    await update(matchRef, data);
  }, [leagueId]);

  const updateIndividualMatch = useCallback(async (
    teamMatchId: string,
    matchIndex: number,
    individualData: Partial<IndividualMatch>,
    teamMatch: TeamMatch,
  ) => {
    if (!leagueId) return;

    const updatedMatches = [...teamMatch.matches];
    updatedMatches[matchIndex] = { ...updatedMatches[matchIndex], ...individualData };

    const updateData: Partial<TeamMatch> = { matches: updatedMatches };

    if (!teamMatch.winnerId) {
      const winner = checkTeamMatchWinner(
        updatedMatches,
        teamMatch.team1Id,
        teamMatch.team2Id,
      );
      if (winner) {
        updateData.winnerId = winner;
        updateData.status = 'completed';
      } else if (teamMatch.status === 'pending') {
        updateData.status = 'in_progress';
      }
    }

    const matchRef = ref(database, `teamMatches/${leagueId}/${teamMatchId}`);
    await update(matchRef, updateData);
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

  return { teamMatches, loading, updateTeamMatch, updateIndividualMatch, setTeamMatchesBulk };
}
