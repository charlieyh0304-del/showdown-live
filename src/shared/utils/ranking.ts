/**
 * 화면용 순위표. 계산은 모두 대회 규칙 단일 설정원(shared/rules)을 거친다.
 * - 세트 승자: 경기의 유효 점수 규칙 (팀 31점 포함)
 * - 부전승/BYE: 규칙에 따라 기록된 점수(기본 11:0)로 집계 (BYE-vs-BYE 제외)
 * - 정렬: 규칙의 동률 기준(기본 승점 → 상대 전적 → 세트 득실 → 점수 득실 → 득점). 이름순 금지.
 *   풀리지 않는 동률은 같은 순위 + tied 표시.
 * tournament를 주지 않으면 기본 규칙(IBSA 기본)을 쓴다.
 */
import type { Match, PlayerRanking, TiebreakerRule, Tournament } from '../types';
import { criteriaFromLegacy, toList } from '../rules/competitionRules';
import { resultContextFor, type ResultContext } from '../rules/standings';
import { rankMatches, selectQualifiers, splitByGroup, type QualificationResult } from '../rules/qualification';
import type { UnresolvedTie } from '../rules/tiebreak';
import { isRealParticipantId } from '../rules/walkover';
import { finalPlacementsFor } from '../rules/finalRanking';
import type { RankingResult } from '../rules/tiebreak';
import type { CountPurpose } from '../rules/walkover';

export type RankingTournament = Pick<Tournament, 'type' | 'gameConfig' | 'scoringRules' | 'stages' | 'rules' | 'rankingMatchConfig' | 'finalsConfig'> & {
  teamMatchSettings?: unknown;
  tiebreakerRules?: unknown;
};

/**
 * 순위 문맥. stageId를 주면 그 스테이지 규칙(stages[i].rules: 동률 기준·승점·부전승 집계)을 반영한다.
 * 레거시 tiebreakers 인자를 주면 동률 기준만 그것으로 바꾼다.
 */
export function rankingContext(tournament?: Partial<RankingTournament> | null, tiebreakers?: TiebreakerRule[], purpose: CountPurpose = 'standings', stageId?: string): ResultContext {
  const ctx = resultContextFor(tournament ?? null, purpose, stageId);
  const legacy = tiebreakers ? criteriaFromLegacy(tiebreakers) : null;
  if (!legacy) return ctx;
  return { ...ctx, rules: { ...ctx.rules, tiebreak: { ...ctx.rules.tiebreak, criteria: legacy } } };
}

function toPlayerRankings(result: RankingResult, onlyPlayed: boolean): PlayerRanking[] {
  return result.ranked
    .filter(r => !onlyPlayed || r.row.played > 0)
    .map(r => ({
      playerId: r.row.id,
      playerName: r.row.name,
      played: r.row.played,
      wins: r.row.wins,
      losses: r.row.losses,
      setsWon: r.row.setsWon,
      setsLost: r.row.setsLost,
      pointsFor: r.row.pointsFor,
      pointsAgainst: r.row.pointsAgainst,
      rank: r.rank,
      points: r.row.points,
      tied: r.tied,
      decidedBy: r.decidedBy,
    }));
}

/**
 * 선수(팀) 개인 전적: 'stats' 문맥(부전승 개인 전적 반영 규칙 walkover.countInPlayerStats)으로
 * 경기 결과를 정규화하고(세트 승자 = 그 경기의 유효 점수 규칙) 동률 규칙 순서로 돌려준다.
 * 관전 선수 목록·선수 상세 통계가 쓴다(승수순 직접 정렬·세트 점수 단순 비교 금지).
 */
export function participantStats(
  matches: Match[],
  tournament?: Partial<RankingTournament> | null,
  opts: { includeUnplayed?: boolean } = {},
): PlayerRanking[] {
  return toPlayerRankings(rankMatches(matches, rankingContext(tournament, undefined, 'stats')), !opts.includeUnplayed);
}

/** 조별 순위표의 진출 표시 */
export type QualifierMark = 'qualified' | 'wildcard' | 'tie';

/** 실제 참가자가 있는 경기 (BYE-vs-BYE 같은 빈 경기는 완료 판단에서 뺀다) */
function isPlayable(m: Pick<Match, 'player1Id' | 'player2Id' | 'team1Id' | 'team2Id'>): boolean {
  return isRealParticipantId(m.player1Id) || isRealParticipantId(m.player2Id) || isRealParticipantId(m.team1Id) || isRealParticipantId(m.team2Id);
}

/**
 * 경계 동률을 확정된 것(settled: 그 범위 경기가 다 끝남)과 아직 진행 중인 것(pending)으로 나눈다.
 * 조 동률은 그 조 경기가 다 끝나야, 와일드카드 동률은 모든 조 경기가 끝나야 확정이다.
 * (경기 전에는 모두 0전 동률이라 진행 중 동률을 '동률 결정 필요'로 보이면 모든 선수에 붙는다.)
 */
export function splitQualificationTies(
  result: Pick<QualificationResult, 'blockingTies' | 'complete'>,
  qualifyingMatches: ReadonlyArray<Match>,
): { settled: UnresolvedTie[]; pending: UnresolvedTie[] } {
  const groupDone = new Map<string, boolean>();
  for (const g of splitByGroup(qualifyingMatches)) {
    groupDone.set(g.groupId, g.matches.filter(isPlayable).every(m => m.status === 'completed'));
  }
  const settled: UnresolvedTie[] = [];
  const pending: UnresolvedTie[] = [];
  for (const tie of result.blockingTies) {
    const done = groupDone.has(tie.scope) ? groupDone.get(tie.scope)! : result.complete;
    (done ? settled : pending).push(tie);
  }
  return { settled, pending };
}

/**
 * selectQualifiers 결과로 진출 표시를 만든다 (관전 순위표·관리자 본선 화면 공용).
 * - 확정된 경계 동률에 걸린 선수: 'tie' (관리자 결정 전에는 진출 확정 아님)
 * - 진행 중인 경계 동률에 걸린 선수: 표시 없음
 * - 그 밖의 진출자: 'qualified' / 'wildcard' (조 경기가 진행 중이면 잠정)
 */
export function marksFromQualification(result: QualificationResult, qualifyingMatches: ReadonlyArray<Match>): Map<string, QualifierMark> {
  const out = new Map<string, QualifierMark>();
  const { settled, pending } = splitQualificationTies(result, qualifyingMatches);
  const pendingIds = new Set(pending.flatMap(tie => tie.ids));
  for (const q of result.qualifiers) if (!pendingIds.has(q.id)) out.set(q.id, q.wildcard ? 'wildcard' : 'qualified');
  for (const tie of settled) for (const id of tie.ids) out.set(id, 'tie');
  return out;
}

/**
 * 예선 경기 전체로 진출자를 고른 결과(본선 생성기와 같은 selectQualifiers: 조당 인원 + 명시적 와일드카드 + 동률 규칙).
 * 표시 규칙은 marksFromQualification (진행 중인 조의 경계 동률은 'tie'로 표시하지 않는다).
 */
export function qualifierMarks(matches: Match[], tournament?: Partial<RankingTournament> | null): Map<string, QualifierMark> {
  const qual = matches.filter(m => !!m.groupId);
  if (qual.length === 0) return new Map();
  const result = selectQualifiers(qual, rankingContext(tournament, undefined, 'standings', groupStageIdOf(qual, tournament)));
  return marksFromQualification(result, qual);
}

/**
 * 조 경기들이 속한 스테이지 ID: 경기의 stageId, 없으면 대회의 예선 스테이지.
 * 조별 순위표와 진출 표시가 서버 진출자 선정(예선 스테이지 규칙)과 같은 규칙을 쓰게 한다.
 */
export function groupStageIdOf(matches: ReadonlyArray<Pick<Match, 'stageId'>>, tournament?: Partial<RankingTournament> | null): string | undefined {
  const fromMatch = matches.find(m => !!m.stageId)?.stageId;
  if (fromMatch) return fromMatch;
  const stages = toList<{ id?: unknown; type?: unknown }>(tournament?.stages);
  const q = stages.find(s => s && s.type === 'qualifying');
  return q && typeof q.id === 'string' ? q.id : undefined;
}

/**
 * 그룹/조별 순위. pending 경기에만 나오는 선수도 0전 행으로 넣는다
 * (조 편성만 되고 아직 경기 안 한 선수도 표에 보여야 한다).
 * stageId를 주지 않으면 경기(또는 대회 예선)의 스테이지 규칙을 쓴다.
 */
export function calculateGroupRanking(
  matches: Match[],
  tiebreakers?: TiebreakerRule[],
  tournament?: Partial<RankingTournament> | null,
  scope = '',
  stageId?: string,
): PlayerRanking[] {
  const ctx = rankingContext(tournament, tiebreakers, 'standings', stageId ?? groupStageIdOf(matches, tournament));
  return toPlayerRankings(rankMatches(matches, ctx, scope), false);
}

export interface FinalRankingRow {
  id: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
  /** 최종 순위 (아직 정해지지 않았으면 null) */
  place: number | null;
  joint: boolean;
  /** 동률 규칙으로 풀리지 않아 관리자 결정이 필요 */
  unresolved: boolean;
}

/**
 * 최종 순위표 행: 순위는 대진 결과(shared/rules/finalRanking — 결승 → 3/4위전 → 순위결정전 → 라운드),
 * 대진이 없으면 순위표 + 동률 규칙. 전적 숫자는 규칙대로 집계한 순위표에서 가져온다.
 * 순위가 정해진 사람이 먼저(순위순), 나머지는 순위 없음(null)으로 뒤에 둔다.
 */
export function finalRankingRows(matches: Match[], tournament?: Partial<RankingTournament> | null): FinalRankingRow[] {
  const ctx = rankingContext(tournament);
  const placements = finalPlacementsFor(matches, tournament);
  const ranking = rankMatches(matches, ctx).ranked.filter(r => r.row.played > 0);
  const statsOf = new Map(ranking.map(r => [r.row.id, r.row]));
  const toRow = (id: string, name: string, place: number | null, joint: boolean, unresolved: boolean): FinalRankingRow => {
    const s = statsOf.get(id);
    return {
      id, name: name || s?.name || id,
      played: s?.played ?? 0, wins: s?.wins ?? 0, losses: s?.losses ?? 0,
      setsWon: s?.setsWon ?? 0, setsLost: s?.setsLost ?? 0, pointsFor: s?.pointsFor ?? 0, pointsAgainst: s?.pointsAgainst ?? 0,
      place, joint, unresolved,
    };
  };
  const rows = placements.map(p => toRow(p.id, p.name, p.place, p.joint, !!p.unresolved));
  const placed = new Set(rows.map(r => r.id));
  for (const r of ranking) if (!placed.has(r.row.id)) rows.push(toRow(r.row.id, r.row.name, null, false, false));
  return rows;
}
