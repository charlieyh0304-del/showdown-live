/**
 * 순위표(standings) 계산 (M0c). 비교자 없이 경기 결과를 정규화한 뒤 합산한다.
 *
 * - 세트 승자는 그 경기의 유효 점수 규칙으로 판정한다(기본 11점 고정이 아님, 팀 31점도 정확).
 * - 0:0 같은 끝나지 않은 세트는 세트로 세지 않는다.
 * - 부전승/BYE는 규칙(walkover.countInStandings / countInPlayerStats / byeCountsAsWalkover)에 따라
 *   기록된 점수(기본 11:0) 그대로 일반 승리처럼 집계한다. BYE-vs-BYE는 경기 없음.
 * - 승점은 standingsPoints(승/무/패/부전승/부전패)로 계산한다.
 *
 * 순수 모듈. functions/src/shared/rules/standings.ts는 이 파일의 사본이다.
 */
import {
  isTeamType,
  matchWinnerByRules,
  resolveCompetitionRules,
  resolveMatchScoring,
  setWinnerOf,
  toList,
  type CompetitionRules,
  type ScoringRuleSet,
  type TournamentLike,
} from './competitionRules';
import { isByeMatch, isRealParticipantId, walkoverCounts, walkoverKind, type CountPurpose } from './walkover';

/** 순위 계산에 필요한 경기 필드 (클라이언트 Match와 서버 원시 데이터 모두 받는다) */
export interface MatchLike {
  id?: unknown;
  status?: unknown;
  type?: unknown;
  stageId?: unknown;
  groupId?: unknown;
  player1Id?: unknown;
  player2Id?: unknown;
  team1Id?: unknown;
  team2Id?: unknown;
  player1Name?: unknown;
  player2Name?: unknown;
  team1Name?: unknown;
  team2Name?: unknown;
  winnerId?: unknown;
  sets?: unknown;
  isBye?: unknown;
  bye?: unknown;
  walkover?: unknown;
  walkoverReason?: unknown;
  autoWalkover?: unknown;
  appliedScoringRules?: unknown;
  roundLabel?: unknown;
  bracketRound?: unknown;
  round?: unknown;
  bracketPosition?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 한 쪽의 ID/이름. 팀전은 team{N}*가 기준, 개인전은 player{N}*가 기준(advancement.ts와 같은 규칙). */
export function sideOf(m: MatchLike, side: 1 | 2): { id: string; name: string } {
  const p = { id: str(side === 1 ? m.player1Id : m.player2Id), name: str(side === 1 ? m.player1Name : m.player2Name) };
  const t = { id: str(side === 1 ? m.team1Id : m.team2Id), name: str(side === 1 ? m.team1Name : m.team2Name) };
  const [a, b] = isTeamType(m.type) ? [t, p] : [p, t];
  return { id: a.id || b.id, name: a.name || b.name };
}

/** 정규화된 경기 결과 하나 */
export interface ResultRecord {
  /** 실제 참가자 ID (BYE 경기에서 상대가 없으면 b는 '') */
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** 승자 ID, 무승부면 null */
  winner: string | null;
  walkover: 'bye' | 'forfeit' | null;
  setsA: number;
  setsB: number;
  ptsA: number;
  ptsB: number;
  groupId: string;
  stageId: string;
}

export interface ResultContext {
  rules: CompetitionRules;
  scoringFor: (m: MatchLike) => ScoringRuleSet;
  purpose: CountPurpose;
}

/** 대회 노드로 결과 문맥을 만든다 (경기마다 스테이지 규칙 반영) */
export function resultContextFor(tournament: TournamentLike | null | undefined, purpose: CountPurpose = 'standings', stageId?: string): ResultContext {
  return {
    rules: resolveCompetitionRules(tournament, stageId),
    scoringFor: m => resolveMatchScoring(m, tournament),
    purpose,
  };
}

/** 완료된 경기 하나를 정규화한다. 집계 대상이 아니면 null. */
export function normalizeResult(m: MatchLike, ctx: ResultContext): ResultRecord | null {
  if (!m || m.status !== 'completed') return null;
  const s1 = sideOf(m, 1);
  const s2 = sideOf(m, 2);
  const real1 = isRealParticipantId(s1.id);
  const real2 = isRealParticipantId(s2.id);
  if (!real1 && !real2) return null; // BYE-vs-BYE 또는 빈 경기
  const kind = walkoverKind(m);
  if (!walkoverCounts(m, ctx.rules, ctx.purpose)) return null;
  if (!real1 || !real2) {
    // 상대가 없는 경기는 BYE일 때만 의미가 있다
    if (!isByeMatch(m)) return null;
  }
  if (real1 && real2 && s1.id === s2.id) return null; // 자기 자신과의 경기(잘못된 데이터)

  const scoring = ctx.scoringFor(m);
  const sets = toList<Record<string, unknown>>(m.sets).filter(s => s && typeof s === 'object');
  let setsA = 0, setsB = 0, ptsA = 0, ptsB = 0;
  for (const s of sets) {
    const p1 = num(s.player1Score);
    const p2 = num(s.player2Score);
    ptsA += p1;
    ptsB += p2;
    // 시간 제한으로 끝난 세트(decidedBy)는 점수와 상관없이 그 결과를 센다
    const w = setWinnerOf(s, scoring);
    if (w === 1) setsA++;
    else if (w === 2) setsB++;
  }

  let winner: string | null = null;
  const wId = str(m.winnerId);
  if (wId && wId === s1.id && real1) winner = s1.id;
  else if (wId && wId === s2.id && real2) winner = s2.id;
  else if (real1 && !real2) winner = s1.id;
  else if (real2 && !real1) winner = s2.id;
  else {
    const w = matchWinnerByRules(sets, scoring);
    winner = w === 1 ? s1.id : w === 2 ? s2.id : null;
  }

  // 부전승은 점수와 상관없이 이겨야 하는 세트 수만큼 이긴 것으로 센다.
  // (부전승 세트 점수를 세트 목표 점수보다 낮게 설정하면(예: 6:0) 세트 판정으로는 세트가 0이 되기 때문)
  if (kind && winner) {
    const need = Math.max(1, scoring.setsToWin);
    if (winner === s1.id && setsA < need) setsA = need;
    else if (winner === s2.id && setsB < need) setsB = need;
  }

  return {
    a: real1 ? s1.id : '',
    b: real2 ? s2.id : '',
    aName: s1.name,
    bName: s2.name,
    winner,
    walkover: kind,
    setsA, setsB, ptsA, ptsB,
    groupId: str(m.groupId),
    stageId: str(m.stageId),
  };
}

export function normalizeResults(matches: ReadonlyArray<MatchLike>, ctx: ResultContext): ResultRecord[] {
  const out: ResultRecord[] = [];
  for (const m of matches) {
    const r = normalizeResult(m, ctx);
    if (r) out.push(r);
  }
  return out;
}

export interface StandingRow {
  id: string;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  walkoverWins: number;
  walkoverLosses: number;
  /** 승점 */
  points: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
}

export function emptyRow(id: string, name: string): StandingRow {
  return { id, name, played: 0, wins: 0, draws: 0, losses: 0, walkoverWins: 0, walkoverLosses: 0, points: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 };
}

/**
 * 결과를 합산한다.
 * @param onlyIds 주면 두 참가자가 모두 이 집합에 있는 경기만 센다(상대 전적 미니 테이블).
 * @param participants 경기가 없어도 표에 넣을 참가자(조 편성만 된 선수 등)
 */
export function aggregateStandings(
  results: ReadonlyArray<ResultRecord>,
  rules: CompetitionRules,
  opts: { onlyIds?: ReadonlySet<string>; participants?: ReadonlyArray<{ id: string; name: string }> } = {},
): Map<string, StandingRow> {
  const rows = new Map<string, StandingRow>();
  const get = (id: string, name: string) => {
    let r = rows.get(id);
    if (!r) { r = emptyRow(id, name); rows.set(id, r); }
    else if (!r.name && name) r.name = name;
    return r;
  };
  for (const p of opts.participants || []) if (isRealParticipantId(p.id)) get(p.id, p.name);
  const sp = rules.standingsPoints;
  for (const r of results) {
    if (opts.onlyIds && (!r.a || !r.b || !opts.onlyIds.has(r.a) || !opts.onlyIds.has(r.b))) continue;
    const sides: Array<{ id: string; name: string; sf: number; sa: number; pf: number; pa: number }> = [];
    if (r.a) sides.push({ id: r.a, name: r.aName, sf: r.setsA, sa: r.setsB, pf: r.ptsA, pa: r.ptsB });
    if (r.b) sides.push({ id: r.b, name: r.bName, sf: r.setsB, sa: r.setsA, pf: r.ptsB, pa: r.ptsA });
    for (const s of sides) {
      const row = get(s.id, s.name);
      row.played++;
      row.setsWon += s.sf;
      row.setsLost += s.sa;
      row.pointsFor += s.pf;
      row.pointsAgainst += s.pa;
      if (r.winner === null) {
        row.draws++;
        row.points += sp.draw;
      } else if (r.winner === s.id) {
        row.wins++;
        if (r.walkover) { row.walkoverWins++; row.points += sp.walkoverWin; }
        else row.points += sp.win;
      } else {
        row.losses++;
        if (r.walkover) { row.walkoverLosses++; row.points += sp.forfeitLoss; }
        else row.points += sp.loss;
      }
    }
  }
  return rows;
}

/** 경기 목록에 나오는 실제 참가자 (pending 포함, 등장 순서) */
export function participantsOf(matches: ReadonlyArray<MatchLike>): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const m of matches) {
    for (const side of [1, 2] as const) {
      const s = sideOf(m, side);
      if (isRealParticipantId(s.id) && !seen.has(s.id)) seen.set(s.id, s.name);
      else if (isRealParticipantId(s.id) && !seen.get(s.id) && s.name) seen.set(s.id, s.name);
    }
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}
