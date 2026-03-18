import type {
  TournamentStage,
  TournamentFormat,
  ScoringRules,
  MatchRules,
  RankingMatchConfig,
  StageGroup,
} from '../types';

// ===== 위자드 상태에서 스테이지 빌드 =====

export interface BuildStagesInput {
  hasGroupStage: boolean;
  groupCount: number;
  qualifyingFormat: 'round_robin' | 'group_round_robin';
  qualifyingScoringRules: ScoringRules | null;
  qualifyingMatchRules: MatchRules | null;
  hasFinalsStage: boolean;
  advanceCount: number;
  finalsScoringRules: ScoringRules | null;
  finalsMatchRules: MatchRules | null;
  rankingMatch: RankingMatchConfig;
}

export function buildStagesFromWizard(input: BuildStagesInput): TournamentStage[] {
  const stages: TournamentStage[] = [];
  let order = 0;
  const now = Date.now();

  if (input.hasGroupStage) {
    stages.push({
      id: `stage_qualifying_${now}`,
      name: input.groupCount > 1 ? '조별 예선' : '예선 리그',
      order: order++,
      type: 'qualifying',
      format: input.qualifyingFormat === 'group_round_robin' ? 'group_knockout' : 'round_robin',
      ...(input.qualifyingScoringRules ? { scoringRules: input.qualifyingScoringRules } : {}),
      ...(input.qualifyingMatchRules ? { matchRules: input.qualifyingMatchRules } : {}),
      groupCount: input.groupCount,
      status: 'pending',
    });
  }

  if (input.hasFinalsStage) {
    stages.push({
      id: `stage_finals_${now + 1}`,
      name: '본선 토너먼트',
      order: order++,
      type: 'finals',
      format: 'single_elimination',
      ...(input.finalsScoringRules ? { scoringRules: input.finalsScoringRules } : {}),
      ...(input.finalsMatchRules ? { matchRules: input.finalsMatchRules } : {}),
      advanceCount: input.advanceCount,
      status: 'pending',
    });

    if (input.rankingMatch.enabled) {
      stages.push({
        id: `stage_ranking_${now + 2}`,
        name: '순위결정전',
        order: order++,
        type: 'ranking_match',
        format: 'single_elimination',
        ...(input.rankingMatch.scoringRules ? { scoringRules: input.rankingMatch.scoringRules } : {}),
        status: 'pending',
      });
    }
  }

  return stages;
}

// ===== 레거시 format 매핑 =====

export function mapToLegacyFormat(hasGroupStage: boolean, hasFinalsStage: boolean): TournamentFormat {
  if (hasGroupStage && hasFinalsStage) return 'group_league';
  if (hasFinalsStage) return 'tournament';
  return 'full_league';
}

// ===== 조 편성 =====

export function buildGroupAssignment(
  participantIds: string[],
  groupCount: number,
  seeds?: string[],
): StageGroup[] {
  const groups: StageGroup[] = [];
  for (let i = 0; i < groupCount; i++) {
    groups.push({
      id: `group_${String.fromCharCode(65 + i)}`,
      stageId: '',
      name: `${String.fromCharCode(65 + i)}조`,
      playerIds: [],
      teamIds: [],
    });
  }

  // Snake draft: 시드 순서대로 조에 분배
  // 라운드 1: A→B→C→D, 라운드 2: D→C→B→A, ...
  const ordered = seeds && seeds.length > 0
    ? [...seeds, ...participantIds.filter(id => !seeds.includes(id))]
    : participantIds;

  for (let i = 0; i < ordered.length; i++) {
    const round = Math.floor(i / groupCount);
    const pos = i % groupCount;
    const groupIndex = round % 2 === 0 ? pos : groupCount - 1 - pos;
    groups[groupIndex].playerIds.push(ordered[i]);
  }

  return groups;
}

// ===== 라운드로빈 대진 생성 =====

export interface MatchPairing {
  player1Index: number;
  player2Index: number;
  round: number;
}

export function generateRoundRobinPairings(participantCount: number): MatchPairing[] {
  if (participantCount < 2) return [];

  const pairings: MatchPairing[] = [];
  // 홀수면 bye용 가상 참가자 추가
  const n = participantCount % 2 === 0 ? participantCount : participantCount + 1;
  const rounds = n - 1;
  const half = n / 2;

  // 원형 알고리즘 (circle method)
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) indices.push(i);

  for (let round = 0; round < rounds; round++) {
    // 첫 번째 매치: 고정 참가자(n-1) vs indices[0]
    if (indices[0] < participantCount && n - 1 < participantCount) {
      pairings.push({ player1Index: n - 1, player2Index: indices[0], round: round + 1 });
    }

    // 나머지 매치
    for (let i = 1; i < half; i++) {
      const a = indices[i];
      const b = indices[n - 2 - i];
      if (a < participantCount && b < participantCount) {
        pairings.push({ player1Index: a, player2Index: b, round: round + 1 });
      }
    }

    // 로테이션
    const last = indices.pop()!;
    indices.unshift(last);
  }

  return pairings;
}

// ===== 싱글 엘리미네이션 대진 =====

export interface BracketSlot {
  position: number;
  round: number;
  sourcePosition1?: number;
  sourcePosition2?: number;
}

export function generateSingleEliminationBracket(participantCount: number): BracketSlot[] {
  if (participantCount < 2) return [];

  // 다음 2의 거듭제곱으로 올림
  let bracketSize = 1;
  while (bracketSize < participantCount) bracketSize *= 2;

  const totalRounds = Math.log2(bracketSize);
  const slots: BracketSlot[] = [];
  let pos = 1;

  // 1라운드 (시드 배치)
  const round1Matches = bracketSize / 2;
  for (let i = 0; i < round1Matches; i++) {
    slots.push({ position: pos++, round: 1 });
  }

  // 후속 라운드: 각 매치의 소스를 이전 라운드에서 참조
  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = bracketSize / Math.pow(2, round);
    const prevRoundStart = pos - matchesInRound * 2;
    for (let i = 0; i < matchesInRound; i++) {
      slots.push({
        position: pos++,
        round,
        sourcePosition1: prevRoundStart + i * 2,
        sourcePosition2: prevRoundStart + i * 2 + 1,
      });
    }
  }

  return slots;
}

// ===== 와일드카드 진출 인원 계산 =====

/**
 * 와일드카드 진출 인원 계산
 * 본선 인원 - (조당 진출 × 조 수) = 와일드카드 인원
 */
export function calculateWildcard(
  finalsSlots: number,
  advancePerGroup: number,
  groupCount: number,
): { directAdvance: number; wildcardCount: number; wildcardFromRank: number } {
  const directAdvance = advancePerGroup * groupCount;
  const wildcardCount = Math.max(0, finalsSlots - directAdvance);
  const wildcardFromRank = advancePerGroup + 1; // 각 조 N+1위에서 선발
  return { directAdvance, wildcardCount, wildcardFromRank };
}

// ===== 경기 수 계산 =====

export function calculateMatchCount(
  participantCount: number,
  hasGroupStage: boolean,
  groupCount: number,
  hasFinalsStage: boolean,
  advanceCount: number,
  rankingMatch: RankingMatchConfig,
  finalsStartRound?: number,
): { qualifying: number; finals: number; ranking: number; total: number } {
  let qualifying = 0;
  let finals = 0;
  let ranking = 0;

  if (hasGroupStage) {
    if (groupCount <= 1) {
      // 풀리그
      qualifying = (participantCount * (participantCount - 1)) / 2;
    } else {
      // 조별리그: 각 조 인원을 정확히 계산
      const basePerGroup = Math.floor(participantCount / groupCount);
      const remainder = participantCount % groupCount;
      for (let g = 0; g < groupCount; g++) {
        const n = basePerGroup + (g < remainder ? 1 : 0);
        if (n >= 2) {
          qualifying += (n * (n - 1)) / 2;
        }
      }
    }
  }

  if (hasFinalsStage) {
    // 본선 참가 인원: finalsStartRound가 있으면 그것 사용, 없으면 advanceCount 또는 participantCount
    const finalsParticipants = finalsStartRound
      ? finalsStartRound
      : hasGroupStage
        ? advanceCount
        : participantCount;
    // 싱글 엘리미네이션: N-1 경기 (BYE 포함 시에도 동일)
    finals = Math.max(0, finalsParticipants - 1);
  }

  if (hasFinalsStage && rankingMatch.enabled) {
    // 3/4위 결정전: 1경기
    if (rankingMatch.thirdPlace) ranking += 1;

    // 5~8위 결정전
    if (rankingMatch.fifthToEighth) {
      switch (rankingMatch.fifthToEighthFormat) {
        case 'simple': ranking += 2; break;      // 5vs8, 6vs7
        case 'full': ranking += 4; break;        // 교차2 + 순위2
        case 'round_robin': ranking += 6; break; // 4명 풀리그
      }
    }

    // 하위 순위 그룹 결정전 (IBSA 방식)
    if (rankingMatch.classificationGroups) {
      const finalsParticipants = advanceCount;
      const classified = participantCount - finalsParticipants;
      const groupSize = rankingMatch.classificationGroupSize || 4;
      const groups = Math.ceil(classified / groupSize);
      for (let i = 0; i < groups; i++) {
        const n = Math.min(groupSize, classified - i * groupSize);
        if (n >= 2) {
          ranking += (n * (n - 1)) / 2;
        }
      }
    }
  }

  return {
    qualifying,
    finals,
    ranking,
    total: qualifying + finals + ranking,
  };
}
