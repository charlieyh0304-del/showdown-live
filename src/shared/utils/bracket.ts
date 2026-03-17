import type { Match, MatchType, BracketFormatType } from '../types';

interface Participant {
  id: string;
  name: string;
}

type MatchData = Omit<Match, 'id'>;

function createMatchBase(tournamentId: string, matchType: MatchType, round: number): MatchData {
  return {
    tournamentId,
    type: matchType,
    status: 'pending',
    round,
    createdAt: Date.now(),
  };
}

// ===== 라운드 로빈 (써클 메서드) =====
export function generateRoundRobin(
  participants: Participant[],
  tournamentId: string,
  matchType: MatchType,
): MatchData[] {
  const matches: MatchData[] = [];
  const players = [...participants];

  // 홀수면 BYE 추가
  if (players.length % 2 !== 0) {
    players.push({ id: 'BYE', name: 'BYE' });
  }

  const n = players.length;
  const rounds = n - 1;
  const halfSize = n / 2;

  // 써클 메서드: 첫 번째 선수를 고정하고 나머지를 회전
  const fixed = players[0];
  const rotating = players.slice(1);

  let matchNumber = 0;

  for (let round = 0; round < rounds; round++) {
    const currentPlayers = [fixed, ...rotating];

    for (let i = 0; i < halfSize; i++) {
      const p1 = currentPlayers[i];
      const p2 = currentPlayers[n - 1 - i];

      // BYE 경기는 건너뜀
      if (p1.id === 'BYE' || p2.id === 'BYE') continue;

      matchNumber++;
      const m = createMatchBase(tournamentId, matchType, round + 1);

      if (matchType === 'team') {
        m.team1Id = p1.id;
        m.team1Name = p1.name;
        m.team2Id = p2.id;
        m.team2Name = p2.name;
      } else {
        m.player1Id = p1.id;
        m.player1Name = p1.name;
        m.player2Id = p2.id;
        m.player2Name = p2.name;
      }

      matches.push(m);
    }

    // 시계방향 회전
    rotating.push(rotating.shift()!);
  }

  return matches;
}

// ===== 싱글 엘리미네이션 =====
export function generateSingleElimination(
  participants: Participant[],
  tournamentId: string,
  matchType: MatchType,
  options?: { thirdPlaceMatch?: boolean },
): MatchData[] {
  const matches: MatchData[] = [];
  const n = participants.length;

  if (n < 2) return matches;

  // 다음 2의 거듭제곱
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
  const totalRounds = Math.log2(bracketSize);

  // 시딩 순서로 배치
  const seeded: (Participant | null)[] = new Array(bracketSize).fill(null);
  for (let i = 0; i < n; i++) {
    seeded[i] = participants[i];
  }

  // 1라운드 매치 생성
  let position = 0;
  for (let i = 0; i < bracketSize; i += 2) {
    const p1 = seeded[i];
    const p2 = seeded[i + 1];
    position++;

    const m = createMatchBase(tournamentId, matchType, 1);
    m.bracketPosition = position;
    m.stageId = 'knockout';

    if (p1 && p2) {
      if (matchType === 'team') {
        m.team1Id = p1.id; m.team1Name = p1.name;
        m.team2Id = p2.id; m.team2Name = p2.name;
      } else {
        m.player1Id = p1.id; m.player1Name = p1.name;
        m.player2Id = p2.id; m.player2Name = p2.name;
      }
    } else if (p1 && !p2) {
      // BYE - 자동 승리
      if (matchType === 'team') {
        m.team1Id = p1.id; m.team1Name = p1.name;
        m.team2Name = 'BYE';
      } else {
        m.player1Id = p1.id; m.player1Name = p1.name;
        m.player2Name = 'BYE';
      }
      m.status = 'completed';
      m.winnerId = p1.id;
      m.bye = true;
    }

    matches.push(m);
  }

  // 이후 라운드 매치 생성 (빈 매치, 승자가 올라감)
  let prevRoundMatchCount = bracketSize / 2;
  for (let round = 2; round <= totalRounds; round++) {
    const thisRoundMatchCount = prevRoundMatchCount / 2;
    for (let i = 0; i < thisRoundMatchCount; i++) {
      const m = createMatchBase(tournamentId, matchType, round);
      m.bracketPosition = i + 1;
      m.stageId = 'knockout';
      matches.push(m);
    }
    prevRoundMatchCount = thisRoundMatchCount;
  }

  // 3위 결정전
  if (options?.thirdPlaceMatch && totalRounds >= 2) {
    const m = createMatchBase(tournamentId, matchType, totalRounds);
    m.bracketPosition = 0; // 특수 위치
    m.stageId = 'third_place';
    matches.push(m);
  }

  return matches;
}

// ===== 조별리그 + 녹아웃 =====
export function generateGroupKnockout(
  participants: Participant[],
  tournamentId: string,
  matchType: MatchType,
  options: { groupCount: number; advancePerGroup?: number },
): MatchData[] {
  const { groupCount, advancePerGroup = 2 } = options;
  const matches: MatchData[] = [];

  // 스네이크 드래프트로 조 분배
  const groups: Participant[][] = Array.from({ length: groupCount }, () => []);
  participants.forEach((p, i) => {
    const round = Math.floor(i / groupCount);
    const groupIdx = round % 2 === 0 ? i % groupCount : groupCount - 1 - (i % groupCount);
    groups[groupIdx].push(p);
  });

  const groupLabels = 'ABCDEFGH';

  // 각 조별 라운드 로빈
  groups.forEach((group, gi) => {
    const groupId = groupLabels[gi];
    const groupMatches = generateRoundRobin(group, tournamentId, matchType);
    groupMatches.forEach(m => {
      m.stageId = 'group';
      m.groupId = groupId;
    });
    matches.push(...groupMatches);
  });

  // 녹아웃 단계 (진출자 결정 후 동적 생성이 필요하므로 빈 매치만 생성)
  const advanceTotal = groupCount * advancePerGroup;
  const knockoutMatches = generateSingleElimination(
    Array.from({ length: advanceTotal }, (_, i) => ({ id: `tbd_${i}`, name: 'TBD' })),
    tournamentId,
    matchType,
  );
  knockoutMatches.forEach(m => {
    m.stageId = 'knockout';
  });
  matches.push(...knockoutMatches);

  return matches;
}

// ===== 스위스 시스템 (첫 라운드) =====
export function generateSwissRound(
  participants: Participant[],
  tournamentId: string,
  matchType: MatchType,
  roundNumber: number,
  previousResults?: { playerId: string; wins: number; opponents: string[] }[],
): MatchData[] {
  const matches: MatchData[] = [];
  const players = [...participants];

  if (roundNumber === 1 || !previousResults) {
    // 첫 라운드: 상위 절반 vs 하위 절반
    const half = Math.floor(players.length / 2);
    for (let i = 0; i < half; i++) {
      const m = createMatchBase(tournamentId, matchType, roundNumber);
      if (matchType === 'team') {
        m.team1Id = players[i].id; m.team1Name = players[i].name;
        m.team2Id = players[half + i].id; m.team2Name = players[half + i].name;
      } else {
        m.player1Id = players[i].id; m.player1Name = players[i].name;
        m.player2Id = players[half + i].id; m.player2Name = players[half + i].name;
      }
      matches.push(m);
    }
  } else {
    // 이후 라운드: 같은 승수끼리 매칭, 이전 대전 회피
    const sorted = [...previousResults].sort((a, b) => b.wins - a.wins);
    const paired = new Set<string>();

    for (let i = 0; i < sorted.length; i++) {
      if (paired.has(sorted[i].playerId)) continue;

      for (let j = i + 1; j < sorted.length; j++) {
        if (paired.has(sorted[j].playerId)) continue;
        if (sorted[i].opponents.includes(sorted[j].playerId)) continue;

        const p1 = participants.find(p => p.id === sorted[i].playerId)!;
        const p2 = participants.find(p => p.id === sorted[j].playerId)!;

        const m = createMatchBase(tournamentId, matchType, roundNumber);
        if (matchType === 'team') {
          m.team1Id = p1.id; m.team1Name = p1.name;
          m.team2Id = p2.id; m.team2Name = p2.name;
        } else {
          m.player1Id = p1.id; m.player1Name = p1.name;
          m.player2Id = p2.id; m.player2Name = p2.name;
        }
        matches.push(m);

        paired.add(sorted[i].playerId);
        paired.add(sorted[j].playerId);
        break;
      }
    }
  }

  return matches;
}

// ===== 메인 엔트리 포인트 =====
export function generateBracket(
  format: BracketFormatType,
  participants: Participant[],
  tournamentId: string,
  matchType: MatchType,
  options?: Record<string, unknown>,
): MatchData[] {
  switch (format) {
    case 'round_robin':
      return generateRoundRobin(participants, tournamentId, matchType);
    case 'single_elimination':
      return generateSingleElimination(participants, tournamentId, matchType, options as any);
    case 'double_elimination':
      // 더블 엘리미네이션은 싱글 엘리미네이션 기반으로 패자조를 추가
      return generateSingleElimination(participants, tournamentId, matchType, { thirdPlaceMatch: true });
    case 'swiss':
      return generateSwissRound(participants, tournamentId, matchType, 1);
    case 'group_knockout':
      return generateGroupKnockout(participants, tournamentId, matchType, {
        groupCount: (options?.groupCount as number) || 4,
        advancePerGroup: (options?.advancePerGroup as number) || 2,
      });
    default:
      return generateRoundRobin(participants, tournamentId, matchType);
  }
}
