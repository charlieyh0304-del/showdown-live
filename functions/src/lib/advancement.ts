/**
 * 레거시 링크(sourceMatch1/sourceMatch2/sourceType) 기반 승자·패자 자동 진출 (M0e)
 *
 * Firebase에 의존하지 않는 순수 로직이다. 다음 두 곳에서 쓴다.
 * - triggers/advance-on-match-result.ts: 실경기 트리거(onValueWritten)
 * - handlers/simulate.ts: 시뮬레이션 후 일괄 진출(sweepAdvancement)
 *
 * 링크 규약
 * - 하위 경기가 sourceMatch1(또는 구 클라이언트 필드 sourceMatch1Id)로 상위 경기를 가리키면
 *   상위 경기의 결과가 하위 경기의 1번 슬롯(player1*, team1*)에 들어간다. 2번도 같다.
 * - sourceType은 두 슬롯 모두에 적용된다. 'loser'면 패자(3/4위전), 없거나 'winner'면 승자.
 *
 * 채움 규칙
 * - 하위 경기가 pending일 때만 쓴다. 슬롯이 비어 있거나 이 트리거가 이전에 채운 값일 때만 바꾼다.
 *   이전에 채운 값인지는 하위 경기의 player{N}Source(출처 기록)로 판단한다.
 *   그래서 관리자가 직접 넣은 값은 절대 덮어쓰지 않는다(manual_override 충돌로 기록).
 * - 하위 경기가 이미 시작/완료됐으면 건드리지 않고 downstream_started 충돌로 기록한다.
 *
 * BYE 규칙
 * - isBye(서버) 또는 bye(클라이언트) 경기는 실제 선수 쪽이 자동 승자다. 패자는 없다(null).
 * - 그래서 BYE는 3/4위전(패자 슬롯)에 절대 들어가지 않는다.
 * - 한쪽 슬롯이 "영구히 빈 슬롯"(상위 경기가 끝났는데 보낼 선수가 없음)이고 다른 쪽에 선수가 있으면
 *   하위 경기를 부전승(autoWalkover)으로 완료한다. 양쪽 모두 영구히 비면 승자 없는 BYE로 완료한다.
 *   이 완료가 다시 트리거를 불러 다음 라운드로 연쇄 진출한다(BYE 연쇄).
 *   autoWalkover 경기는 트리거 소유이므로, 상위 결과가 정정되면 다시 pending으로 되돌릴 수 있다.
 * - BYE/부전승은 11:0 승리다(M0c, 소유자 요구). 자동 부전승은 대회 규칙(shared/rules)의 부전승 점수를
 *   이겨야 하는 세트 수만큼 기록하고(개인 3세트제 11:0 ×2, 팀 31:0), isBye + walkoverReason 'bye'로 표시한다.
 *   집계 여부는 규칙(walkover.countInStandings/countInPlayerStats/byeCountsAsWalkover)이 정한다.
 *   BYE를 부전승으로 보지 않는 규칙이면 점수를 쓰지 않는다. 양쪽 다 빈 BYE는 점수 없음.
 * - 쓰기는 isBye만 한다(구 클라이언트 필드 bye는 읽기만 하고, 되돌릴 때 함께 지운다).
 */
import {
  resolveCompetitionRules,
  resolveMatchScoring,
  type CompetitionRules,
} from "../shared/rules/competitionRules";
import { buildByeSets, BYE_WALKOVER_REASON } from "../shared/rules/walkover";

export type MatchData = Record<string, unknown>;
export type Side = 1 | 2;
export type Outcome = "winner" | "loser";

/** 서버 생성 BYE 슬롯의 ID 표기 */
export const BYE_ID = "BYE";

export interface Participant {
  id: string;
  name: string;
  /** 팀전 상위 경기의 team{N} 객체(구성원 정보). 있으면 하위 경기로 복사한다. */
  team?: Record<string, unknown>;
}

export interface ScoringRulesLite {
  setsToWin: number;
  winScore: number;
  minLead: number;
}

export type MatchResult =
  | { decided: false }
  | { decided: true; winner: Participant | null; loser: Participant | null };

/** 하위 경기 슬롯에 남기는 출처 기록 (player1Source / player2Source) */
export interface SlotSource {
  matchId: string;
  outcome: Outcome;
  id: string;
  name: string;
  /** 처음 채우기 전 슬롯에 있던 표시 이름(예: "8강 승자1"). 비울 때 복원한다. */
  prevName: string;
}

export interface SourceLink {
  side: Side;
  matchId: string;
  outcome: Outcome;
}

export interface DownstreamLink extends SourceLink {
  downstreamId: string;
}

export type ConflictReason = "downstream_started" | "manual_override";

export type SlotDecision =
  | { kind: "noop" }
  | { kind: "patch"; patch: Record<string, unknown> }
  | { kind: "conflict"; reason: ConflictReason; current: Participant | null; expected: Participant | null };

// ===== 기본 접근자 =====

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function isByeMatch(m: MatchData): boolean {
  return m.isBye === true || m.bye === true;
}

/** 실제 참가자 ID인가 (빈 값과 "BYE"는 아님) */
export function isRealId(id: string): boolean {
  return !!id && id !== BYE_ID;
}

/**
 * 슬롯 필드 우선순위. 팀전은 team{N}*가 기준이다(관리자 팀 편집은 team 필드만 바꾸므로
 * 이전에 함께 채운 player{N}Id가 남아 있어도 team 쪽을 읽어야 한다). 개인전은 player{N}*가 기준이다.
 */
function sideKeys(m: MatchData, side: Side): [string, string] {
  return isTeamType(m.type) ? [`team${side}`, `player${side}`] : [`player${side}`, `team${side}`];
}

/** 기준 필드 ID, 비어 있으면 다른 쪽 ID (팀전: team{side}Id || player{side}Id, 개인전: 반대) */
export function getSideId(m: MatchData, side: Side): string {
  const [a, b] = sideKeys(m, side);
  return str(m[`${a}Id`]) || str(m[`${b}Id`]);
}

/** getSideId와 같은 우선순위의 표시 이름 */
export function getSideName(m: MatchData, side: Side): string {
  const [a, b] = sideKeys(m, side);
  return str(m[`${a}Name`]) || str(m[`${b}Name`]);
}

export function getSideParticipant(m: MatchData, side: Side): Participant | null {
  const id = getSideId(m, side);
  if (!isRealId(id)) return null;
  const team = m[`team${side}`];
  return { id, name: getSideName(m, side), ...(isObject(team) ? { team } : {}) };
}

/** 그 쪽의 유효 ID(getSideId)와 같은가. 남아 있는 다른 필드의 옛 ID와는 비교하지 않는다. */
function sideMatchesId(m: MatchData, side: Side, id: string): boolean {
  return !!id && getSideId(m, side) === id;
}

// ===== 점수 규칙 =====

function isTeamType(type: unknown): boolean {
  return type === "team" || type === "randomTeamLeague";
}

/**
 * 경기의 유효 점수 규칙. 대회 규칙 단일 설정원(shared/rules resolveMatchScoring)을 쓴다:
 * match.appliedScoringRules > stage.rules/scoringRules > tournament.rules/scoringRules
 * > (팀전이면 teamMatchSettings 또는 31점 1게임) > tournament.gameConfig > 11점 2세트선승
 */
export function resolveScoringRules(match: MatchData, tournament: MatchData | null | undefined): ScoringRulesLite {
  const r = resolveMatchScoring(match, tournament);
  return { setsToWin: r.setsToWin, winScore: r.winScore, minLead: r.minLead };
}

/** 자동 부전승(BYE) 경기에 기록할 세트. 빈 배열이면 점수 없음. */
export type WalkoverSetsFor = (m: MatchData, winnerSide: Side, winnerId: string) => unknown[];

/** 대회 규칙으로 부전승 세트를 만든다 (기본: 세트 목표 점수 : 0 × 이겨야 하는 세트 수) */
export function walkoverSetsForTournament(tournament: MatchData | null | undefined): WalkoverSetsFor {
  return (m, winnerSide, winnerId) => {
    const rules: CompetitionRules = resolveCompetitionRules(tournament, m.stageId);
    return buildByeSets(resolveMatchScoring(m, tournament), rules, winnerSide, winnerId);
  };
}

/** 점수 규칙만 아는 호출부용 기본값 (부전승 점수 = 세트 목표 점수) */
function defaultWalkoverSets(rulesFor: RulesFor): WalkoverSetsFor {
  return (m, winnerSide, winnerId) => {
    const r = rulesFor(m);
    return buildByeSets({ ...r, maxSets: r.setsToWin * 2 - 1 }, resolveCompetitionRules(null), winnerSide, winnerId);
  };
}

const EMPTY_SET = { player1Score: 0, player2Score: 0, player1Faults: 0, player2Faults: 0, player1Violations: 0, player2Violations: 0, winnerId: null };

function setWinner(p1: number, p2: number, rules: ScoringRulesLite): 1 | 2 | null {
  if (p1 >= rules.winScore && p1 - p2 >= rules.minLead) return 1;
  if (p2 >= rules.winScore && p2 - p1 >= rules.minLead) return 2;
  return null;
}

// ===== 결과 판정 =====

/**
 * 완료된 경기의 승자/패자. 판정할 수 없으면 decided:false.
 * - BYE 경기: 실제 선수가 승자, 패자 null(양쪽 다 비면 승자도 null).
 * - winnerId가 있으면 그것을 쓴다(어느 쪽과도 맞지 않으면 판정 불가).
 * - 없으면 세트 점수를 경기의 유효 규칙으로 판정한다. 동점/미완료 점수는 판정 불가.
 */
export function determineResult(m: MatchData | null | undefined, rules: ScoringRulesLite): MatchResult {
  if (!m || m.status !== "completed") return { decided: false };
  const p1 = getSideParticipant(m, 1);
  const p2 = getSideParticipant(m, 2);

  if (isByeMatch(m) && (!p1 || !p2)) {
    return { decided: true, winner: p1 || p2, loser: null };
  }

  const wId = str(m.winnerId);
  if (wId) {
    const is1 = sideMatchesId(m, 1, wId);
    const is2 = sideMatchesId(m, 2, wId);
    if (is1 === is2) return { decided: false };
    const winner = is1 ? p1 : p2;
    if (!winner) return { decided: false };
    return { decided: true, winner, loser: is1 ? p2 : p1 };
  }

  // 표시 없는 BYE: 한쪽이 "BYE" ID
  if (p1 && !p2 && getSideId(m, 2) === BYE_ID) return { decided: true, winner: p1, loser: null };
  if (p2 && !p1 && getSideId(m, 1) === BYE_ID) return { decided: true, winner: p2, loser: null };
  if (!p1 || !p2) return { decided: false };

  const rawSets = m.sets;
  const sets = Array.isArray(rawSets) ? rawSets : isObject(rawSets) ? Object.values(rawSets) : [];
  let w1 = 0;
  let w2 = 0;
  for (const s of sets) {
    if (!isObject(s)) continue;
    const w = setWinner(num(s.player1Score), num(s.player2Score), rules);
    if (w === 1) w1++;
    else if (w === 2) w2++;
  }
  if (w1 >= rules.setsToWin && w1 > w2) return { decided: true, winner: p1, loser: p2 };
  if (w2 >= rules.setsToWin && w2 > w1) return { decided: true, winner: p2, loser: p1 };
  return { decided: false };
}

/** 결과에서 링크가 원하는 참가자. undefined=아직 미정, null=결정됐지만 보낼 선수 없음(BYE) */
export function participantFor(result: MatchResult, outcome: Outcome): Participant | null | undefined {
  if (!result.decided) return undefined;
  return outcome === "loser" ? result.loser : result.winner;
}

// ===== 링크 =====

/** 하위 경기의 상위 링크 (sourceMatch1/2, 구 필드 sourceMatch1Id/2Id 모두 읽음). 자기 참조는 무시. */
export function getSourceLinks(m: MatchData, selfId?: string): SourceLink[] {
  const outcome: Outcome = m.sourceType === "loser" ? "loser" : "winner";
  const links: SourceLink[] = [];
  for (const side of [1, 2] as const) {
    const matchId = str(m[`sourceMatch${side}`]) || str(m[`sourceMatch${side}Id`]);
    if (matchId && matchId !== selfId) links.push({ side, matchId, outcome });
  }
  return links;
}

/** sourceId를 참조하는 모든 하위 경기 슬롯 */
export function findDownstreamLinks(all: Record<string, MatchData>, sourceId: string): DownstreamLink[] {
  const out: DownstreamLink[] = [];
  for (const [downstreamId, m] of Object.entries(all)) {
    if (!isObject(m) || downstreamId === sourceId) continue;
    for (const link of getSourceLinks(m, downstreamId)) {
      if (link.matchId === sourceId) out.push({ ...link, downstreamId });
    }
  }
  return out;
}

// ===== 슬롯 결정 =====

export function readSlotSource(m: MatchData, side: Side): SlotSource | null {
  const raw = m[`player${side}Source`];
  if (!isObject(raw)) return null;
  const matchId = str(raw.matchId);
  if (!matchId) return null;
  return {
    matchId,
    outcome: raw.outcome === "loser" ? "loser" : "winner",
    id: str(raw.id),
    name: str(raw.name),
    prevName: str(raw.prevName),
  };
}

/** 트리거가 상태를 바꿔도 되는 하위 경기인가: pending 또는 트리거가 만든 자동 부전승 */
function isModifiable(m: MatchData): boolean {
  return m.status === "pending" || m.autoWalkover === true;
}

function fillPatch(side: Side, target: Participant, source: SlotSource, clearTeam: boolean): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    [`player${side}Id`]: target.id,
    [`player${side}Name`]: target.name,
    [`team${side}Id`]: target.id,
    [`team${side}Name`]: target.name,
    [`player${side}Source`]: { ...source },
  };
  if (target.team) patch[`team${side}`] = target.team;
  else if (clearTeam) patch[`team${side}`] = null;
  return patch;
}

function clearPatch(side: Side, prevName: string): Record<string, unknown> {
  return {
    [`player${side}Id`]: "",
    [`player${side}Name`]: prevName,
    [`team${side}Id`]: "",
    [`team${side}Name`]: prevName,
    [`team${side}`]: null,
    [`player${side}Source`]: null,
  };
}

/**
 * 하위 경기 한 슬롯에 대해 무엇을 할지 정한다.
 * @param desired participantFor()의 결과. undefined(미정)와 null(BYE) 모두 "이전에 채운 값 비우기"를 뜻한다.
 */
export function resolveSlot(
  downstream: MatchData,
  side: Side,
  link: { matchId: string; outcome: Outcome },
  desired: Participant | null | undefined,
): SlotDecision {
  const curId = getSideId(downstream, side);
  const curName = getSideName(downstream, side);
  const current: Participant | null = isRealId(curId) ? { id: curId, name: curName } : null;
  const prov = readSlotSource(downstream, side);
  const ours = prov && prov.matchId === link.matchId && prov.outcome === link.outcome ? prov : null;
  // 슬롯이 아직 이 트리거가 채운 값 그대로인가 (관리자가 바꾸지 않았는가)
  const derived = ours && ours.id === curId ? ours : null;
  const target = desired ?? null;
  const targetId = target?.id ?? "";
  const modifiable = isModifiable(downstream);

  if (curId === targetId || (!target && !isRealId(curId))) {
    if (!target) {
      // 둘 다 비어 있음: 남은 출처 기록만 정리
      return ours && modifiable ? { kind: "patch", patch: { [`player${side}Source`]: null } } : { kind: "noop" };
    }
    if (!modifiable) return { kind: "noop" };
    if (derived && derived.name === target.name && curName === target.name) return { kind: "noop" };
    if (prov && !ours) return { kind: "noop" }; // 다른 출처가 기록한 값과 우연히 같음
    // 같은 선수가 이미 있음(시뮬레이션이 기록 없이 채웠거나 이름만 바뀜): 출처 기록/이름 갱신
    const source: SlotSource = {
      matchId: link.matchId, outcome: link.outcome, id: target.id, name: target.name,
      prevName: ours ? ours.prevName : "",
    };
    return { kind: "patch", patch: fillPatch(side, target, source, false) };
  }

  if (!modifiable) {
    if (!target && !derived) return { kind: "noop" }; // 비울 우리 값이 없음
    return { kind: "conflict", reason: "downstream_started", current, expected: target };
  }

  if (isRealId(curId) && !derived) {
    // 관리자가 직접 넣은 값: 절대 덮어쓰지 않는다
    if (!target) return { kind: "noop" };
    return { kind: "conflict", reason: "manual_override", current, expected: target };
  }

  const prevName = ours ? ours.prevName : curName;
  if (!target) return { kind: "patch", patch: clearPatch(side, prevName) };
  const source: SlotSource = {
    matchId: link.matchId, outcome: link.outcome, id: target.id, name: target.name, prevName,
  };
  return { kind: "patch", patch: fillPatch(side, target, source, !!derived) };
}

// ===== 자동 부전승 =====

/**
 * 영구히 빈 슬롯이 있는 하위 경기를 부전승으로 완료(또는 자동 부전승을 되돌림)하는 패치.
 * 바꿀 것이 없으면 null.
 */
export function computeAutoWalkover(
  m: MatchData,
  permanentlyEmpty: Record<Side, boolean>,
  walkoverSets?: WalkoverSetsFor,
): Record<string, unknown> | null {
  const owned = m.autoWalkover === true;
  if (m.status !== "pending" && !owned) return null;
  const p1 = getSideParticipant(m, 1);
  const p2 = getSideParticipant(m, 2);
  let want: { winnerId: string | null; side: Side } | null = null;
  if (permanentlyEmpty[1] && permanentlyEmpty[2] && !p1 && !p2) want = { winnerId: null, side: 1 };
  else if (permanentlyEmpty[1] && !p1 && p2) want = { winnerId: p2.id, side: 2 };
  else if (permanentlyEmpty[2] && !p2 && p1) want = { winnerId: p1.id, side: 1 };

  if (want) {
    const sets = want.winnerId && walkoverSets ? walkoverSets(m, want.side, want.winnerId) : [];
    if (owned && m.status === "completed" && (str(m.winnerId) || null) === want.winnerId &&
      JSON.stringify(m.sets ?? []) === JSON.stringify(sets)) return null;
    return {
      status: "completed", winnerId: want.winnerId, sets,
      walkover: true, walkoverReason: BYE_WALKOVER_REASON, autoWalkover: true, isBye: true, bye: null,
    };
  }
  if (owned) {
    return {
      status: "pending", winnerId: null, sets: [{ ...EMPTY_SET }],
      walkover: null, walkoverReason: null, autoWalkover: null, isBye: null, bye: null,
    };
  }
  return null;
}

/** 패치를 노드 값에 적용한 사본 (null은 키 삭제) */
export function applyPatch(m: MatchData, patch: Record<string, unknown>): MatchData {
  const next: MatchData = { ...m };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  return next;
}

export type RulesFor = (m: MatchData) => ScoringRulesLite;

/** 하위 경기의 한 슬롯이 영구히 비었는가: 상위 경기가 결정됐지만 보낼 선수가 없음(BYE) */
export function isSlotPermanentlyEmpty(
  m: MatchData, selfId: string, side: Side, all: Record<string, MatchData>, rulesFor: RulesFor,
): boolean {
  const link = getSourceLinks(m, selfId).find(l => l.side === side);
  if (!link) return false;
  const src = all[link.matchId];
  if (!src) return false;
  return participantFor(determineResult(src, rulesFor(src)), link.outcome) === null;
}

/** 하위 경기 노드 하나에 슬롯 결정 + 자동 부전승을 적용한다. 변경 없으면 next === downstream. */
export function planDownstreamUpdate(
  downstream: MatchData,
  downstreamId: string,
  link: SourceLink,
  desired: Participant | null | undefined,
  all: Record<string, MatchData>,
  rulesFor: RulesFor,
  walkoverSets: WalkoverSetsFor = defaultWalkoverSets(rulesFor),
): { next: MatchData; decision: SlotDecision } {
  const decision = resolveSlot(downstream, link.side, link, desired);
  let next = decision.kind === "patch" ? applyPatch(downstream, decision.patch) : downstream;
  const perm: Record<Side, boolean> = {
    1: link.side === 1 ? desired === null : isSlotPermanentlyEmpty(next, downstreamId, 1, all, rulesFor),
    2: link.side === 2 ? desired === null : isSlotPermanentlyEmpty(next, downstreamId, 2, all, rulesFor),
  };
  const wo = computeAutoWalkover(next, perm, walkoverSets);
  if (wo) next = applyPatch(next, wo);
  return { next, decision };
}

/** 노드 전/후 차이를 multi-path update용 필드 패치로 */
export function diffPatch(before: MatchData, after: MatchData): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) patch[k] = b === undefined ? null : b;
  }
  return patch;
}

// ===== 시뮬레이션용 일괄 진출 =====

/**
 * 모든 pending(또는 자동 부전승) 하위 경기에 대해 결정된 상위 결과를 반영한 필드 패치.
 * 미정인 상위 결과로 슬롯을 비우지는 않는다(시뮬레이션은 결과를 쌓기만 한다).
 * 반환: { [matchId]: { field: value } }
 */
export function sweepAdvancement(
  all: Record<string, MatchData>,
  rulesFor: RulesFor,
  walkoverSets: WalkoverSetsFor = defaultWalkoverSets(rulesFor),
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, m] of Object.entries(all)) {
    if (!isObject(m) || !isModifiable(m)) continue;
    const links = getSourceLinks(m, id);
    if (links.length === 0) continue;
    let next = m;
    for (const link of links) {
      const src = all[link.matchId];
      if (!src) continue;
      const desired = participantFor(determineResult(src, rulesFor(src)), link.outcome);
      if (desired === undefined) continue;
      next = planDownstreamUpdate(next, id, link, desired, all, rulesFor, walkoverSets).next;
    }
    const patch = diffPatch(m, next);
    if (Object.keys(patch).length > 0) out[id] = patch;
  }
  return out;
}

// ===== 트리거 처리 =====

const RESULT_FIELDS = [
  "status", "winnerId", "player1Id", "player2Id", "team1Id", "team2Id",
  "player1Name", "player2Name", "team1Name", "team2Name", "isBye", "bye",
  "sets", "stageId", "type", "appliedScoringRules",
];

/**
 * 점수 갱신마다 불리므로 DB 읽기 없이 걸러낸다.
 * 완료 전/후가 바뀌었거나, 완료 상태에서 결과에 영향을 주는 필드가 바뀐 경우만 true.
 */
export function needsAdvancementCheck(before: MatchData | null, after: MatchData | null): boolean {
  const wasCompleted = before?.status === "completed";
  const isCompleted = after?.status === "completed";
  if (!wasCompleted && !isCompleted) return false;
  if (wasCompleted !== isCompleted) return true;
  return RESULT_FIELDS.some(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
}

export interface ConflictRecord {
  downstreamMatchId: string;
  side: Side;
  sourceMatchId: string;
  outcome: Outcome;
  reason: ConflictReason;
  downstreamStatus: string;
  currentId: string;
  currentName: string;
  expectedId: string;
  expectedName: string;
  createdAt: number;
  updatedAt: number;
}

/** 트리거가 쓰는 저장소. Firebase 구현은 triggers/advance-on-match-result.ts, 테스트는 메모리 구현. */
export interface AdvancementStore {
  getTournament(): Promise<MatchData | null>;
  getMatches(): Promise<Record<string, MatchData>>;
  /** 노드 트랜잭션. update가 undefined를 반환하면 중단(쓰기 없음). */
  transactMatch(matchId: string, update: (cur: MatchData | null) => MatchData | null | undefined): Promise<void>;
  getConflict(downstreamId: string, side: Side): Promise<ConflictRecord | null>;
  setConflict(downstreamId: string, side: Side, record: ConflictRecord | null): Promise<void>;
}

export interface AdvancementReport {
  skipped?: "irrelevant" | "opt_out" | "unchanged" | "no_downstream";
  updated: string[];
  conflicts: Array<{ downstreamId: string; side: Side; reason: ConflictReason }>;
}

function resultKey(r: MatchResult): string {
  if (!r.decided) return "undecided";
  return JSON.stringify([r.winner?.id ?? null, r.winner?.name ?? null, r.loser?.id ?? null, r.loser?.name ?? null]);
}

/**
 * /matches/{tid}/{matchId} 쓰기 한 건을 처리한다. 멱등이다: 같은 입력으로 두 번 돌려도 결과가 같다.
 * 트리거가 하위 경기에 쓰면 그 경기에 대해 다시 불리지만, 하위 경기가 완료로 바뀐 경우가 아니면
 * needsAdvancementCheck에서 바로 끝난다(재귀 안전).
 */
export async function processMatchWrite(
  store: AdvancementStore,
  matchId: string,
  before: MatchData | null,
  after: MatchData | null,
  now: number,
): Promise<AdvancementReport> {
  const report: AdvancementReport = { updated: [], conflicts: [] };
  if (!needsAdvancementCheck(before, after)) return { ...report, skipped: "irrelevant" };

  const tournament = await store.getTournament();
  if (tournament?.autoAdvance === false) return { ...report, skipped: "opt_out" };
  const rulesFor: RulesFor = m => resolveScoringRules(m, tournament);
  const walkoverSets = walkoverSetsForTournament(tournament);

  const resBefore = before ? determineResult(before, rulesFor(before)) : { decided: false as const };
  const resAfter = after ? determineResult(after, rulesFor(after)) : { decided: false as const };
  if (before?.status === "completed" && after?.status === "completed" && resultKey(resBefore) === resultKey(resAfter)) {
    return { ...report, skipped: "unchanged" };
  }

  const all = { ...(await store.getMatches()) };
  if (after) all[matchId] = after;
  else delete all[matchId];

  const links = findDownstreamLinks(all, matchId);
  if (links.length === 0) return { ...report, skipped: "no_downstream" };

  for (const link of links) {
    const desired = participantFor(resAfter, link.outcome);
    let decision: SlotDecision | null = null;
    let downstreamStatus = "";
    let wrote = false;
    await store.transactMatch(link.downstreamId, cur => {
      // RTDB는 첫 호출에 캐시가 없으면 null을 준다. null을 돌려주면 서버 값으로 다시 호출된다.
      if (cur === null) { decision = null; wrote = false; return null; }
      const plan = planDownstreamUpdate(cur, link.downstreamId, link, desired, { ...all, [link.downstreamId]: cur }, rulesFor, walkoverSets);
      decision = plan.decision;
      downstreamStatus = str(cur.status);
      wrote = plan.next !== cur;
      return wrote ? plan.next : undefined;
    });
    if (wrote) report.updated.push(link.downstreamId);

    const d = decision as SlotDecision | null;
    if (!d) continue; // 하위 경기가 사라짐
    const existing = await store.getConflict(link.downstreamId, link.side);
    if (d.kind === "conflict") {
      report.conflicts.push({ downstreamId: link.downstreamId, side: link.side, reason: d.reason });
      const record: ConflictRecord = {
        downstreamMatchId: link.downstreamId,
        side: link.side,
        sourceMatchId: matchId,
        outcome: link.outcome,
        reason: d.reason,
        downstreamStatus,
        currentId: d.current?.id ?? "",
        currentName: d.current?.name ?? "",
        expectedId: d.expected?.id ?? "",
        expectedName: d.expected?.name ?? "",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const same = existing && existing.reason === record.reason && existing.sourceMatchId === record.sourceMatchId &&
        existing.currentId === record.currentId && existing.expectedId === record.expectedId &&
        existing.expectedName === record.expectedName && existing.downstreamStatus === record.downstreamStatus;
      if (!same) await store.setConflict(link.downstreamId, link.side, record);
    } else if (existing && existing.sourceMatchId === matchId) {
      // 결과가 다시 맞춰졌으면 이 출처의 충돌 기록을 지운다
      await store.setConflict(link.downstreamId, link.side, null);
    }
  }
  return report;
}
