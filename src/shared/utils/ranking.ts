import type { Match, PlayerRanking, TeamRanking } from '../types';
import { checkSetWinner } from './scoring';

// 개인전 풀리그 순위 산출
export function calculateIndividualRanking(matches: Match[]): PlayerRanking[] {
  const map = new Map<string, PlayerRanking>();

  const getOrCreate = (id: string, name: string): PlayerRanking => {
    let r = map.get(id);
    if (!r) {
      r = { playerId: id, playerName: name, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, rank: 0 };
      map.set(id, r);
    }
    return r;
  };

  for (const match of matches) {
    if (match.status !== 'completed' || !match.player1Id || !match.player2Id) continue;

    const r1 = getOrCreate(match.player1Id, match.player1Name || '');
    const r2 = getOrCreate(match.player2Id, match.player2Name || '');
    r1.played++;
    r2.played++;

    if (match.sets) {
      for (const set of match.sets) {
        const w = checkSetWinner(set.player1Score, set.player2Score);
        if (w === 1) { r1.setsWon++; r2.setsLost++; }
        else if (w === 2) { r2.setsWon++; r1.setsLost++; }
        r1.pointsFor += set.player1Score;
        r1.pointsAgainst += set.player2Score;
        r2.pointsFor += set.player2Score;
        r2.pointsAgainst += set.player1Score;
      }
    }

    if (match.winnerId === match.player1Id) { r1.wins++; r2.losses++; }
    else if (match.winnerId === match.player2Id) { r2.wins++; r1.losses++; }
  }

  const rankings = Array.from(map.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aSetDiff = a.setsWon - a.setsLost;
    const bSetDiff = b.setsWon - b.setsLost;
    if (bSetDiff !== aSetDiff) return bSetDiff - aSetDiff;
    const aPtDiff = a.pointsFor - a.pointsAgainst;
    const bPtDiff = b.pointsFor - b.pointsAgainst;
    return bPtDiff - aPtDiff;
  });

  rankings.forEach((r, i) => { r.rank = i + 1; });
  return rankings;
}

// 팀전 순위 산출
export function calculateTeamRanking(matches: Match[]): TeamRanking[] {
  const map = new Map<string, TeamRanking>();

  const getOrCreate = (id: string, name: string): TeamRanking => {
    let r = map.get(id);
    if (!r) {
      r = { teamId: id, teamName: name, played: 0, wins: 0, losses: 0, individualWins: 0, individualLosses: 0, rank: 0 };
      map.set(id, r);
    }
    return r;
  };

  for (const match of matches) {
    if (match.status !== 'completed' || !match.team1Id || !match.team2Id) continue;

    const r1 = getOrCreate(match.team1Id, match.team1Name || '');
    const r2 = getOrCreate(match.team2Id, match.team2Name || '');
    r1.played++;
    r2.played++;

    if (match.winnerId === match.team1Id) { r1.wins++; r2.losses++; }
    else if (match.winnerId === match.team2Id) { r2.wins++; r1.losses++; }

    if (match.individualMatches) {
      for (const im of match.individualMatches) {
        if (im.status !== 'completed') continue;
        if (im.winnerId === im.player1Id) { r1.individualWins++; r2.individualLosses++; }
        else if (im.winnerId === im.player2Id) { r2.individualWins++; r1.individualLosses++; }
      }
    }
  }

  const rankings = Array.from(map.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aIndDiff = a.individualWins - a.individualLosses;
    const bIndDiff = b.individualWins - b.individualLosses;
    return bIndDiff - aIndDiff;
  });

  rankings.forEach((r, i) => { r.rank = i + 1; });
  return rankings;
}
