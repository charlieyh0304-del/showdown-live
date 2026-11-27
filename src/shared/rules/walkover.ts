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
import { setWinnerByRules, type CompetitionRules, type ScoringRuleSet, type WalkoverRules } from './competitionRules';

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

export interface RetirementMatchFlags {
  walkover: true | null;
  walkoverReason: string | null;
  retired: true;
  retiredReason: string;
}

/**
 * 경기 포기(기권)를 저장할 때 경기에 쓰는 표시 (null = Firebase에서 삭제).
 * - as_walkover(규정 불이행 패처럼): 부전승으로도 표시한다. 그래야 순위표·통계가 부전승 규칙
 *   (승점 walkoverWin/forfeitLoss, countInStandings, countInPlayerStats, 부전승 세트 수)을 따른다.
 * - keep_played / as_recorded: 실제 경기로 집계한다(부전승 표시 없음).
 */
export function retirementMatchFlags(rules: Pick<CompetitionRules, 'retirement'>, reason: string): RetirementMatchFlags {
  const asWalkover = rules.retirement.mode === 'as_walkover';
  return {
    walkover: asWalkover ? true : null,
    walkoverReason: asWalkover ? reason : null,
    retired: true,
    retiredReason: reason,
  };
}

export interface SetScoreLike {
  player1Score?: unknown;
  player2Score?: unknown;
  player1Faults?: unknown;
  player2Faults?: unknown;
  player1Violations?: unknown;
  player2Violations?: unknown;
}

function scoreNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 경기 포기(기권, retirement) 세트 (IBSA 구분, docs/06 3장).
 *
 * - keep_played(경기 포기): 이미 끝난 세트와 점수는 그대로 둔다. 진행 중이던 세트는 상대에게 준다
 *   (기권한 쪽 점수는 남기고, 상대 점수는 max(목표 점수, 기권 쪽 점수 + 최소 점수 차)).
 *   상대가 이겨야 하는 세트 수에 이를 때까지 남은 세트는 0:목표 점수다.
 *   예) 3세트제, 기권 쪽이 1번: 11:5, 7:2에서 기권 → 11:5, 7:11, 0:11
 * - as_walkover(규정 불이행 패처럼): 얻은 점수를 지우고 모든 세트를 부전승 점수로 기록한다(buildWalkoverSets).
 * - as_recorded: 기록된 점수를 그대로 둔다(승자는 경기의 winnerId로만 정해진다).
 * 진행 중 세트의 상대 점수 = max(목표 점수, 기권 쪽 점수 + 최소 점수 차): 패자가 목표-1 이상이면 패자+2.
 *
 * retiringSide: 기권한 쪽. 승자는 상대(winnerId). retiringId는 기권한 쪽이 이긴 세트의 winnerId로 남긴다.
 */
export function buildRetirementSets(
  sets: ReadonlyArray<SetScoreLike>,
  retiringSide: 1 | 2,
  scoring: ScoringRuleSet,
  rules: Pick<CompetitionRules, 'walkover' | 'retirement'>,
  winnerId: string | null,
  retiringId: string | null = null,
): WalkoverSet[] {
  const winnerSide: 1 | 2 = retiringSide === 1 ? 2 : 1;
  if (rules.retirement.mode === 'as_walkover') {
    return buildWalkoverSets(scoring, rules.walkover, winnerSide, winnerId);
  }
  if (rules.retirement.mode === 'as_recorded') {
    return sets.map(s => ({
      player1Score: scoreNum(s.player1Score),
      player2Score: scoreNum(s.player2Score),
      player1Faults: scoreNum(s.player1Faults),
      player2Faults: scoreNum(s.player2Faults),
      player1Violations: scoreNum(s.player1Violations),
      player2Violations: scoreNum(s.player2Violations),
      winnerId: (() => {
        const w = setWinnerByRules(scoreNum(s.player1Score), scoreNum(s.player2Score), scoring);
        return w === null ? null : w === winnerSide ? winnerId : retiringId;
      })(),
    }));
  }
  const target = Math.max(1, scoring.winScore);
  const lead = Math.max(1, scoring.minLead);
  const need = Math.max(1, scoring.setsToWin);
  const out: WalkoverSet[] = [];
  let winnerSets = 0;

  for (const s of sets) {
    if (winnerSets >= need) break;
    const p1 = scoreNum(s.player1Score);
    const p2 = scoreNum(s.player2Score);
    const base = {
      player1Faults: scoreNum(s.player1Faults),
      player2Faults: scoreNum(s.player2Faults),
      player1Violations: scoreNum(s.player1Violations),
      player2Violations: scoreNum(s.player2Violations),
    };
    const done = setWinnerByRules(p1, p2, scoring);
    if (done !== null) {
      // 이미 끝난 세트: 그대로 둔다 (기권한 쪽이 이긴 세트도 남는다)
      out.push({ player1Score: p1, player2Score: p2, ...base, winnerId: done === winnerSide ? winnerId : retiringId });
      if (done === winnerSide) winnerSets++;
      continue;
    }
    // 진행 중 세트: 상대에게 준다. 기권한 쪽 점수는 남긴다.
    const retScore = retiringSide === 1 ? p1 : p2;
    const oppScore = Math.max(target, retScore + lead, retiringSide === 1 ? p2 : p1);
    out.push({
      player1Score: retiringSide === 1 ? retScore : oppScore,
      player2Score: retiringSide === 1 ? oppScore : retScore,
      ...base,
      winnerId,
    });
    winnerSets++;
    break;
  }
  // 남은 세트: 0:목표 점수
  while (winnerSets < need) {
    out.push({
      player1Score: winnerSide === 1 ? target : 0,
      player2Score: winnerSide === 2 ? target : 0,
      player1Faults: 0,
      player2Faults: 0,
      player1Violations: 0,
      player2Violations: 0,
      winnerId,
    });
    winnerSets++;
  }
  return out;
}
