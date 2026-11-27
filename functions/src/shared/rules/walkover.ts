// 자동 생성 사본: 원본은 src/shared/rules/. 직접 고치지 말고 node scripts/sync-shared-rules.mjs를 실행하세요.
/**
 * BYE / 부전승 규칙 (M0c, 감사 B10).
 *
 * - 부전승은 11:0 승리다. 이겨야 하는 세트 수만큼 "세트 목표 점수 : 0" 세트를 기록한다
 *   (3세트제 → 11:0, 11:0 / 5세트제 → 11:0 ×3 / 팀 31점 1게임 → 31:0). 점수는 규칙(walkover.setScore)으로 바꿀 수 있다.
 * - 상대가 없는 BYE도 기본으로 부전승이다(byeCountsAsWalkover). 양쪽 모두 빈 BYE는 "경기 없음"(승자 없음, 집계 안 함).
 * - 읽기: bye(구 클라이언트)와 isBye(서버) 둘 다 BYE로 본다. 쓰기: isBye만 쓰고 walkoverReason을 함께 쓴다.
 * - 경기 수 제한/일정(코트 시간)은 BYE를 빼고 센다(countPlayableMatches). 통계와 일정은 따로 판단한다.
 *
 * 순수 모듈. functions/src/shared/rules/walkover.ts는 이 파일의 사본이다.
 */
import type { CompetitionRules, ScoringRuleSet, WalkoverRules } from './competitionRules';

/** 서버 생성 BYE 슬롯의 ID 표기 */
export const BYE_ID = 'BYE';

/** BYE 부전승의 walkoverReason 값 (기권 부전승은 사람이 쓴 사유 문자열) */
export const BYE_WALKOVER_REASON = 'bye';

export interface WalkoverSet {
  player1Score: number;
  player2Score: number;
  player1Faults: number;
  player2Faults: number;
  player1Violations: number;
  player2Violations: number;
  winnerId: string | null;
}

export interface ByeLike {
  bye?: unknown;
  isBye?: unknown;
  walkover?: unknown;
  autoWalkover?: unknown;
}

export function isByeMatch(m: ByeLike | null | undefined): boolean {
  return !!m && (m.isBye === true || m.bye === true);
}

/** 실제 참가자 ID인가 (빈 값과 "BYE"는 아님) */
export function isRealParticipantId(id: unknown): id is string {
  return typeof id === 'string' && !!id && id !== BYE_ID;
}

/** 부전승 종류: bye(상대 없음) / forfeit(상대 불참·기권) / null(일반 경기) */
export function walkoverKind(m: ByeLike | null | undefined): 'bye' | 'forfeit' | null {
  if (!m) return null;
  if (isByeMatch(m)) return 'bye';
  if (m.walkover === true) return 'forfeit';
  return null;
}

/** 부전승 세트 한 개의 점수: 설정값, 없으면 그 경기의 세트 목표 점수 */
export function walkoverSetScore(scoring: ScoringRuleSet, walkover: WalkoverRules): number {
  return walkover.setScore ?? scoring.winScore;
}

/**
 * 부전승 세트 목록. winnerSide 쪽이 매 세트 walkoverSetScore : 0으로 이긴다.
 * 세트 수 = 이겨야 하는 세트 수.
 */
export function buildWalkoverSets(
  scoring: ScoringRuleSet,
  walkover: WalkoverRules,
  winnerSide: 1 | 2,
  winnerId: string | null,
): WalkoverSet[] {
  const score = walkoverSetScore(scoring, walkover);
  return Array.from({ length: Math.max(1, scoring.setsToWin) }, () => ({
    player1Score: winnerSide === 1 ? score : 0,
    player2Score: winnerSide === 2 ? score : 0,
    player1Faults: 0,
    player2Faults: 0,
    player1Violations: 0,
    player2Violations: 0,
    winnerId,
  }));
}

/** BYE 경기의 세트: BYE를 부전승으로 보면 부전승 세트, 아니면 빈 목록(점수 없음) */
export function buildByeSets(
  scoring: ScoringRuleSet,
  rules: CompetitionRules,
  winnerSide: 1 | 2,
  winnerId: string | null,
): WalkoverSet[] {
  if (!rules.walkover.byeCountsAsWalkover || !winnerId) return [];
  return buildWalkoverSets(scoring, rules.walkover, winnerSide, winnerId);
}

export type CountPurpose = 'standings' | 'stats';

/**
 * 완료된 경기를 순위표(standings) 또는 선수 통계(stats)에 넣는가.
 * hasTwoRealSides: 양쪽 모두 실제 참가자인가. BYE-vs-BYE(실제 참가자 없음)는 항상 제외(호출부에서 처리).
 */
export function walkoverCounts(m: ByeLike, rules: CompetitionRules, purpose: CountPurpose): boolean {
  const kind = walkoverKind(m);
  if (!kind) return true;
  if (kind === 'bye' && !rules.walkover.byeCountsAsWalkover) return false;
  return purpose === 'standings' ? rules.walkover.countInStandings : rules.walkover.countInPlayerStats;
}
