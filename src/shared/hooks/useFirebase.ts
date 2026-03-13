import { useState, useEffect, useCallback, useMemo } from 'react';
import { ref, onValue, set, push, remove, update } from 'firebase/database';
import { database } from '../config/firebase';
import type { Player, Tournament, Match, Referee, Court, RandomTeamLeague, TeamMatch, IndividualMatch, Group, GroupMatch, GroupStanding, PlayerStats } from '../types';
import { checkSetWinner, checkTeamMatchWinner } from '../types';

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

  // 개별 경기 결과 업데이트 + 팀 승자 자동 결정
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

    // 팀 승자 자동 결정
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

  return { teamMatches, loading, addTeamMatch, updateTeamMatch, updateIndividualMatch, setTeamMatchesBulk };
}

// 조별리그 조 관리 훅
export function useGroups(tournamentId: string | null) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const groupsRef = ref(database, `groups/${tournamentId}`);
    const unsubscribe = onValue(
      groupsRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const groupList = Object.entries(data).map(([id, group]) => ({
            id,
            ...(group as Omit<Group, 'id'>),
          }));
          setGroups(groupList);
        } else {
          setGroups([]);
        }
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [tournamentId]);

  const addGroup = useCallback(async (group: Omit<Group, 'id'>) => {
    if (!tournamentId) return null;
    try {
      const groupsRef = ref(database, `groups/${tournamentId}`);
      const newRef = push(groupsRef);
      await set(newRef, group);
      return newRef.key;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add group');
      return null;
    }
  }, [tournamentId]);

  const updateGroup = useCallback(async (groupId: string, data: Partial<Group>) => {
    if (!tournamentId) return;
    try {
      const groupRef = ref(database, `groups/${tournamentId}/${groupId}`);
      await update(groupRef, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group');
    }
  }, [tournamentId]);

  const deleteGroup = useCallback(async (groupId: string) => {
    if (!tournamentId) return;
    try {
      const groupRef = ref(database, `groups/${tournamentId}/${groupId}`);
      await remove(groupRef);
      // 관련 조별 경기도 삭제
      const matchesRef = ref(database, `groupMatches/${tournamentId}/${groupId}`);
      await remove(matchesRef);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
    }
  }, [tournamentId]);

  return { groups, loading, error, addGroup, updateGroup, deleteGroup };
}

// 조별 경기 관리 훅
export function useGroupMatches(tournamentId: string | null, groupId?: string | null) {
  const [groupMatches, setGroupMatches] = useState<GroupMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) {
      setGroupMatches([]);
      setLoading(false);
      return;
    }

    // groupId가 있으면 해당 조만, 없으면 전체 조별 경기
    const path = groupId
      ? `groupMatches/${tournamentId}/${groupId}`
      : `groupMatches/${tournamentId}`;
    const matchesRef = ref(database, path);

    const unsubscribe = onValue(
      matchesRef,
      (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          setGroupMatches([]);
          setError(null);
          setLoading(false);
          return;
        }

        let matchList: GroupMatch[];
        if (groupId) {
          // 단일 조: data는 { matchId: matchData } 형태
          matchList = Object.entries(data).map(([id, match]) => ({
            id,
            ...(match as Omit<GroupMatch, 'id'>),
          }));
        } else {
          // 전체 조: data는 { groupId: { matchId: matchData } } 형태
          matchList = [];
          for (const [gId, matches] of Object.entries(data)) {
            if (matches && typeof matches === 'object') {
              for (const [mId, match] of Object.entries(matches as Record<string, unknown>)) {
                matchList.push({
                  id: mId,
                  ...(match as Omit<GroupMatch, 'id'>),
                  groupId: gId,
                });
              }
            }
          }
        }
        setGroupMatches(matchList);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [tournamentId, groupId]);

  const addGroupMatch = useCallback(async (match: Omit<GroupMatch, 'id'>) => {
    if (!tournamentId) return null;
    try {
      const matchesRef = ref(database, `groupMatches/${tournamentId}/${match.groupId}`);
      const newRef = push(matchesRef);
      await set(newRef, match);
      return newRef.key;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add group match');
      return null;
    }
  }, [tournamentId]);

  const updateGroupMatch = useCallback(async (matchId: string, matchGroupId: string, data: Partial<GroupMatch>) => {
    if (!tournamentId) return;
    try {
      const matchRef = ref(database, `groupMatches/${tournamentId}/${matchGroupId}/${matchId}`);
      await update(matchRef, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group match');
    }
  }, [tournamentId]);

  const deleteGroupMatch = useCallback(async (matchId: string, matchGroupId: string) => {
    if (!tournamentId) return;
    try {
      const matchRef = ref(database, `groupMatches/${tournamentId}/${matchGroupId}/${matchId}`);
      await remove(matchRef);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group match');
    }
  }, [tournamentId]);

  return { groupMatches, loading, error, addGroupMatch, updateGroupMatch, deleteGroupMatch };
}

// 조별리그 순위 계산 훅
export function useStandings(tournamentId: string | null, groupId: string | null) {
  const { groupMatches, loading, error } = useGroupMatches(tournamentId, groupId);

  const standings = useMemo<GroupStanding[]>(() => {
    if (!groupMatches.length) return [];

    const standingsMap = new Map<string, GroupStanding>();

    const getOrCreate = (playerId: string): GroupStanding => {
      let s = standingsMap.get(playerId);
      if (!s) {
        s = {
          playerId,
          played: 0,
          wins: 0,
          losses: 0,
          setsWon: 0,
          setsLost: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          rankPoints: 0,
        };
        standingsMap.set(playerId, s);
      }
      return s;
    };

    for (const match of groupMatches) {
      if (match.status !== 'completed') continue;

      const s1 = getOrCreate(match.player1Id);
      const s2 = getOrCreate(match.player2Id);

      s1.played++;
      s2.played++;

      // 세트별 집계
      for (const setScore of match.sets) {
        const setWinner = checkSetWinner(setScore.player1Score, setScore.player2Score);
        if (setWinner === 1) {
          s1.setsWon++;
          s2.setsLost++;
        } else if (setWinner === 2) {
          s2.setsWon++;
          s1.setsLost++;
        }
        s1.pointsFor += setScore.player1Score;
        s1.pointsAgainst += setScore.player2Score;
        s2.pointsFor += setScore.player2Score;
        s2.pointsAgainst += setScore.player1Score;
      }

      // 승패
      if (match.winnerId === match.player1Id) {
        s1.wins++;
        s2.losses++;
      } else if (match.winnerId === match.player2Id) {
        s2.wins++;
        s1.losses++;
      }
    }

    // 승점 계산 (승리 = 2점, 패배 = 1점, 미경기 = 0점)
    for (const s of standingsMap.values()) {
      s.rankPoints = s.wins * 2 + s.losses * 1;
    }

    // 정렬: 승점 > 승수 > 세트 득실 > 포인트 득실
    return Array.from(standingsMap.values()).sort((a, b) => {
      if (b.rankPoints !== a.rankPoints) return b.rankPoints - a.rankPoints;
      if (b.wins !== a.wins) return b.wins - a.wins;
      const aSetDiff = a.setsWon - a.setsLost;
      const bSetDiff = b.setsWon - b.setsLost;
      if (bSetDiff !== aSetDiff) return bSetDiff - aSetDiff;
      const aPointDiff = a.pointsFor - a.pointsAgainst;
      const bPointDiff = b.pointsFor - b.pointsAgainst;
      return bPointDiff - aPointDiff;
    });
  }, [groupMatches]);

  return { standings, loading, error };
}

// 선수별 통계 계산 훅
export function usePlayerStats(tournamentId: string | null) {
  const { groupMatches, loading: groupLoading, error: groupError } = useGroupMatches(tournamentId);
  const { matches: bracketMatches, loading: bracketLoading } = useMatches(tournamentId);

  const loading = groupLoading || bracketLoading;
  const error = groupError;

  const stats = useMemo<PlayerStats[]>(() => {
    if (!tournamentId) return [];

    const statsMap = new Map<string, PlayerStats>();

    const getOrCreate = (playerId: string): PlayerStats => {
      let s = statsMap.get(playerId);
      if (!s) {
        s = {
          playerId,
          tournamentId: tournamentId!,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          setsWon: 0,
          setsLost: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
        statsMap.set(playerId, s);
      }
      return s;
    };

    // 조별 경기 집계
    for (const match of groupMatches) {
      if (match.status !== 'completed') continue;

      const s1 = getOrCreate(match.player1Id);
      const s2 = getOrCreate(match.player2Id);

      s1.matchesPlayed++;
      s2.matchesPlayed++;

      for (const setScore of match.sets) {
        const setWinner = checkSetWinner(setScore.player1Score, setScore.player2Score);
        if (setWinner === 1) { s1.setsWon++; s2.setsLost++; }
        else if (setWinner === 2) { s2.setsWon++; s1.setsLost++; }
        s1.pointsFor += setScore.player1Score;
        s1.pointsAgainst += setScore.player2Score;
        s2.pointsFor += setScore.player2Score;
        s2.pointsAgainst += setScore.player1Score;
      }

      if (match.winnerId === match.player1Id) { s1.wins++; s2.losses++; }
      else if (match.winnerId === match.player2Id) { s2.wins++; s1.losses++; }
    }

    // 토너먼트 (브라켓) 경기 집계
    for (const match of bracketMatches) {
      if (match.status !== 'completed' || !match.player1Id || !match.player2Id) continue;

      const s1 = getOrCreate(match.player1Id);
      const s2 = getOrCreate(match.player2Id);

      s1.matchesPlayed++;
      s2.matchesPlayed++;

      for (const setScore of match.sets) {
        const setWinner = checkSetWinner(setScore.player1Score, setScore.player2Score);
        if (setWinner === 1) { s1.setsWon++; s2.setsLost++; }
        else if (setWinner === 2) { s2.setsWon++; s1.setsLost++; }
        s1.pointsFor += setScore.player1Score;
        s1.pointsAgainst += setScore.player2Score;
        s2.pointsFor += setScore.player2Score;
        s2.pointsAgainst += setScore.player1Score;
      }

      if (match.winnerId === match.player1Id) { s1.wins++; s2.losses++; }
      else if (match.winnerId === match.player2Id) { s2.wins++; s1.losses++; }
    }

    // 승률 계산
    for (const s of statsMap.values()) {
      s.winRate = s.matchesPlayed > 0 ? s.wins / s.matchesPlayed : 0;
    }

    // 승률 > 승수 > 세트 득실 순 정렬
    return Array.from(statsMap.values()).sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost);
    });
  }, [tournamentId, groupMatches, bracketMatches]);

  return { stats, loading, error };
}
