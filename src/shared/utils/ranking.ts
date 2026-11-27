/**
 * 화면용 순위표. 계산은 모두 대회 규칙 단일 설정원(shared/rules)을 거친다.
 * - 세트 승자: 경기의 유효 점수 규칙 (팀 31점 포함)
 * - 부전승/BYE: 규칙에 따라 기록된 점수(기본 11:0)로 집계 (BYE-vs-BYE 제외)
 * - 정렬: 규칙의 동률 기준(기본 승점 → 상대 전적 → 세트 득실 → 점수 득실 → 득점). 이름순 금지.
 *   풀리지 않는 동률은 같은 순위 + tied 표시.
 * tournament를 주지 않으면 기본 규칙(IBSA 기본)을 쓴다.
 */
import type { Match, PlayerRanking, TeamRanking, TiebreakerRule, Tournament } from '../types';
import { criteriaFromLegacy, isTeamType, toList } from '../rules/competitionRules';
import { resultContextFor, type ResultContext } from '../rules/standings';
import { rankMatches } from '../rules/qualification';
import { computeFinalPlacements } from '../rules/finalRanking';
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

/** 개인전 순위 (완료 경기가 있는 선수만) */
export function calculateIndividualRanking(
  matches: Match[],
  tiebreakers?: TiebreakerRule[],
  tournament?: Partial<RankingTournament> | null,
): PlayerRanking[] {
  return toPlayerRankings(rankMatches(matches, rankingContext(tournament, tiebreakers)), true);
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

/** 팀전 순위 */
export function calculateTeamRanking(matches: Match[], tournament?: Partial<RankingTournament> | null): TeamRanking[] {
  const ctx = rankingContext(tournament ?? { type: 'team' });
  const teamMatches = matches.filter(m => isTeamType(m.type) || !!(m.team1Id || m.team2Id));
  return rankMatches(teamMatches, ctx).ranked
    .filter(r => r.row.played > 0)
    .map(r => ({
      teamId: r.row.id,
      teamName: r.row.name,
      played: r.row.played,
      wins: r.row.wins,
      losses: r.row.losses,
      pointsFor: r.row.pointsFor,
      pointsAgainst: r.row.pointsAgainst,
      rank: r.rank,
      points: r.row.points,
      tied: r.tied,
      decidedBy: r.decidedBy,
    }));
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
  const placements = computeFinalPlacements({ matches, ctx });
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
