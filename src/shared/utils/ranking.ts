import type { Match, PlayerRanking, TeamRanking, TiebreakerRule } from '../types';
import { checkSetWinner } from './scoring';

// 상대전적 타이브레이커
function headToHead(a: PlayerRanking, b: PlayerRanking, matches: Match[]): number {
  let aWins = 0, bWins = 0;
  for (const m of matches) {
    if (m.status !== 'completed') continue;
    if (m.player1Id === a.playerId && m.player2Id === b.playerId) {
      if (m.winnerId === a.playerId) aWins++;
      else if (m.winnerId === b.playerId) bWins++;
    } else if (m.player1Id === b.playerId && m.player2Id === a.playerId) {
      if (m.winnerId === a.playerId) aWins++;
      else if (m.winnerId === b.playerId) bWins++;
    }
  }
  return bWins - aWins;
}

function applyTiebreaker(rule: TiebreakerRule, a: PlayerRanking, b: PlayerRanking, matches: Match[]): number {
  switch (rule) {
    case 'head_to_head': return headToHead(a, b, matches);
    case 'set_difference': return (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost);
    case 'point_difference': return (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst);
    case 'points_for': return b.pointsFor - a.pointsFor;
    default: return 0;
  }
}

// 개인전 풀리그 순위 산출
export function calculateIndividualRanking(
  matches: Match[],
  tiebreakers?: TiebreakerRule[],
): PlayerRanking[] {
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

  const defaultTiebreakers: TiebreakerRule[] = ['set_difference', 'point_difference'];
  const rules = tiebreakers || defaultTiebreakers;

  const rankings = Array.from(map.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    for (const rule of rules) {
      const diff = applyTiebreaker(rule, a, b, matches);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  rankings.forEach((r, i) => { r.rank = i + 1; });
  return rankings;
}

// 팀전 순위 산출 (31점 단일 세트 기준)
export function calculateTeamRanking(matches: Match[]): TeamRanking[] {
  const map = new Map<string, TeamRanking>();

  const getOrCreate = (id: string, name: string): TeamRanking => {
    let r = map.get(id);
    if (!r) {
      r = { teamId: id, teamName: name, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, rank: 0 };
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

    // 31점 단일 세트: sets[0]에서 점수 집계
    if (match.sets && match.sets.length > 0) {
      const set = match.sets[0];
      r1.pointsFor += set.player1Score;
      r1.pointsAgainst += set.player2Score;
      r2.pointsFor += set.player2Score;
      r2.pointsAgainst += set.player1Score;
    }
  }

  const rankings = Array.from(map.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aPtDiff = a.pointsFor - a.pointsAgainst;
    const bPtDiff = b.pointsFor - b.pointsAgainst;
    return bPtDiff - aPtDiff;
  });

  rankings.forEach((r, i) => { r.rank = i + 1; });
  return rankings;
}
