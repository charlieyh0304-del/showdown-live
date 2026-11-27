/**
 * 클라이언트에서 대회 규칙(shared/rules)을 쓰는 얇은 연결부.
 * 부전승 세트, 본선 진출자·시드 배치, 미정 슬롯 설명을 한곳에서 만든다.
 */
import type { Match, MatchType, SetScore, Tournament } from '../types';
import { resolveCompetitionRules, resolveMatchScoring } from '../rules/competitionRules';
import { buildByeSets, buildWalkoverSets, isRealParticipantId } from '../rules/walkover';
import { resultContextFor } from '../rules/standings';
import { selectQualifiers, type QualificationResult } from '../rules/qualification';
import { crossGroupSeedOrder, placeSeeds, nextPowerOfTwo } from '../rules/seeding';

type RulesTournament = Partial<Tournament> | null | undefined;

/** 기권/불참 부전승 세트 (규칙의 부전승 점수 × 이겨야 하는 세트 수) */
export function walkoverSetsFor(
  match: Pick<Match, 'type' | 'stageId' | 'appliedScoringRules'>,
  tournament: RulesTournament,
  winnerSide: 1 | 2,
  winnerId: string,
): SetScore[] {
  const rules = resolveCompetitionRules(tournament, match.stageId);
  return buildWalkoverSets(resolveMatchScoring(match, tournament), rules.walkover, winnerSide, winnerId);
}

/** 본선 골격의 BYE 경기 세트를 만드는 함수 (bracketSkeleton byeSets 옵션) */
export function byeSetsFactory(tournament: RulesTournament, stageId: string, matchType: MatchType) {
  return (winnerSide: 1 | 2, winnerId: string): SetScore[] => {
    const m = { type: matchType, stageId };
    return buildByeSets(resolveMatchScoring(m, tournament), resolveCompetitionRules(tournament, stageId), winnerSide, winnerId);
  };
}

export interface SeededEntrant {
  id: string;
  name: string;
  groupId: string;
  groupRank: number;
  seed: number;
  wildcard: boolean;
}

export interface FinalsSeeding {
  qualification: QualificationResult;
  /** 대진 슬롯 (길이 = 대진 크기, [2k],[2k+1]이 1라운드 k번째 경기, null = BYE) */
  slots: Array<SeededEntrant | null>;
  size: number;
}

/**
 * 예선 결과로 본선 진출자와 1라운드 배치를 계산한다 (서버 generate_finals와 같은 규칙).
 * 진출 경계 미해결 동률·미완료 여부는 qualification에 담아 돌려주고, 호출부가 막거나 보여준다.
 */
export function computeFinalsSeeding(
  tournament: RulesTournament,
  qualifyingMatches: readonly Match[],
  qualifyingStageId: string | undefined,
  finalsStageId: string,
  opts: { perGroup?: number; size?: number } = {},
): FinalsSeeding {
  const ctx = resultContextFor(tournament, 'standings', qualifyingStageId);
  const qualification = selectQualifiers(qualifyingMatches, ctx, { perGroup: opts.perGroup });
  const finalsRules = resolveCompetitionRules(tournament, finalsStageId);
  const order = crossGroupSeedOrder(qualification.qualifiers, { avoidSameGroup: finalsRules.qualification.avoidSameGroupFirstRound });
  const size = nextPowerOfTwo(Math.max(2, order.length, opts.size ?? 0));
  const seeded = order.map((q, i) => ({ id: q.id, name: q.name, groupId: q.groupId, groupRank: q.groupRank, seed: i + 1, wildcard: q.wildcard }));
  return { qualification, slots: placeSeeds(seeded, size), size };
}

/** 그 쪽이 아직 정해지지 않은 슬롯인가 (빈 ID 또는 서버 BYE 표기) */
export function isUndecidedSide(match: Pick<Match, 'player1Id' | 'player2Id' | 'team1Id' | 'team2Id'>, side: 1 | 2): boolean {
  const id = side === 1 ? (match.player1Id || match.team1Id) : (match.player2Id || match.team2Id);
  return !isRealParticipantId(id);
}

export interface SlotSourceInfo {
  roundLabel: string;
  matchNumber: number;
  outcome: 'winner' | 'loser';
}

/** 미정 슬롯이 어느 경기의 승자/패자로 채워지는지 (진출 링크 sourceMatch1/2) */
export function slotSourceInfo(match: Match, side: 1 | 2, byId: ReadonlyMap<string, Match>): SlotSourceInfo | null {
  const srcId = side === 1 ? (match.sourceMatch1 || match.sourceMatch1Id) : (match.sourceMatch2 || match.sourceMatch2Id);
  if (!srcId) return null;
  const src = byId.get(srcId);
  if (!src) return null;
  return {
    roundLabel: src.roundLabel || src.bracketRound || '',
    matchNumber: (src.bracketPosition ?? 0) + 1,
    outcome: match.sourceType === 'loser' ? 'loser' : 'winner',
  };
}
