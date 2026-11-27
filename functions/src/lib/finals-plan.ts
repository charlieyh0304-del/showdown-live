/**
 * 본선 대진 생성 계획 (generate_finals의 순수 로직, M0c).
 *
 * Firebase에 의존하지 않는다. handlers/generate-finals.ts가 읽기/쓰기만 맡는다.
 *
 * 가드 (모두 명확한 에러 코드로 거절)
 * - finals_exist: 이 본선 스테이지(또는 하위 3/4위전·순위전)의 경기가 이미 있다(멱등).
 * - no_qualifying: 예선 경기가 없다.
 * - qualifying_incomplete: 예선 경기가 다 끝나지 않았다(force: true면 진행).
 * - unresolved_tie: 진출 경계에 동률 규칙으로 풀리지 않는 동률이 있다. 동률 정보(ties)를 돌려준다.
 *   관리자가 순서를 정하면 tournaments/{tid}/rules/tiebreakDecisions에 기록되고 동률 모듈이 그 순서를 쓴다.
 *   resolveTiesByLot: true(시뮬레이션 전용)면 seed로 추첨하고 그 결정을 기록하도록 돌려준다.
 * - not_enough_qualifiers: 진출자 2명 미만.
 *
 * 규칙은 모두 대회 규칙 단일 설정원(shared/rules)에서 읽는다: 진출 인원·와일드카드(명시적일 때만)·
 * 동률·시드(표준 시드 위치 + 조별 교차, 같은 조 1라운드 회피)·부전승 점수(BYE = 11:0)·
 * 3/4위전·5~8위 결정전 방식·순위 결정전 리그(티어 크기)·순위 표시 범위(finalRanking).
 * 5~8위 결정전은 8강 경기에서 패자 링크(sourceType 'loser')로 만들고, 진출 트리거가 8강 결과로 채운다.
 * 랜덤팀 리그도 경기 type은 'team'으로 쓴다(DB 규칙은 individual/team만 허용).
 */
import { resolveCompetitionRules, resolveMatchScoring, isTeamType, toList, tiebreakDecisionKey, type FifthToEighthFormat, type TiebreakDecision } from "../shared/rules/competitionRules";
import { resultContextFor, type MatchLike } from "../shared/rules/standings";
import { selectQualifiers, type Qualifier } from "../shared/rules/qualification";
import { crossGroupSeedOrder, placeSeeds, nextPowerOfTwo, findDuplicateSlot } from "../shared/rules/seeding";
import { buildByeSets, BYE_WALKOVER_REASON } from "../shared/rules/walkover";
import { seededShuffle } from "../shared/rules/rng";

type Data = Record<string, unknown>;

export interface FinalsPlanInput {
  advancePerGroup?: number;
  wildcardCount?: number;
  /** 없으면 대회 규칙(finalRanking.thirdPlace) */
  includeThirdPlace?: boolean;
  /** 없으면 대회 규칙(finalRanking.fifthToEighthMatches). true인데 규칙이 'none'이면 'full'. */
  includeFifthToEighth?: boolean;
  /** 5~8위 결정전 방식 지정 (includeFifthToEighth보다 우선) */
  fifthToEighthFormat?: FifthToEighthFormat;
  /** 없으면 대회 규칙(finalRanking.classificationGroups) */
  includeClassification?: boolean;
  /** 없으면 대회 규칙(finalRanking.rankingUpTo) */
  rankingUpTo?: number;
  /** 예선 미완료여도 생성 */
  force?: boolean;
  /** 시뮬레이션 전용: 미해결 동률을 lotSeed로 추첨하고 결정을 기록 */
  resolveTiesByLot?: boolean;
  lotSeed?: string;
}

export interface TieInfo {
  scope: string;
  fromRank: number;
  toRank: number;
  participants: Array<{ id: string; name: string }>;
}

export type FinalsPlanError =
  | { error: string; code: "finals_exist"; existingCount: number }
  | { error: string; code: "no_qualifying" }
  | { error: string; code: "qualifying_incomplete"; incompleteCount: number }
  | { error: string; code: "unresolved_tie"; ties: TieInfo[] }
  | { error: string; code: "not_enough_qualifiers"; count: number }
  | { error: string; code: "invalid_bracket" };

export interface FinalsPlan {
  finalsStageId: string;
  /** 스테이지 목록에 본선 스테이지가 없어 새로 추가해야 함 */
  newStage: Data | null;
  matches: Array<{ key: string; match: Data }>;
  /** 기록할 동률 결정 (resolveTiesByLot일 때) */
  decisions: Record<string, TiebreakDecision>;
  qualifiers: Qualifier[];
  eliminated: Qualifier[];
  summary: string[];
  groupRankings: string;
}

export const UNDECIDED_NAME = "미정";
export const BYE_NAME = "부전승";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function roundName(participants: number): string {
  return participants === 2 ? "결승" : `${participants}강`;
}

export function planFinals(
  tid: string,
  tour: Data,
  allMatches: Record<string, Data>,
  input: FinalsPlanInput,
  deps: { makeKey: () => string; now: number; teams?: Record<string, { memberIds?: string[]; memberNames?: string[]; coachName?: string }> },
): FinalsPlan | FinalsPlanError {
  const stages = toList<Data>(tour.stages).filter(s => s && typeof s === "object");
  const qualStage = stages.find(s => s.type === "qualifying");
  const existingFinals = stages.find(s => s.type === "finals");
  const finalsStageId = str(existingFinals?.id) || `stage_finals_${tid}`;
  const newStage = existingFinals ? null : { id: finalsStageId, type: "finals", name: "본선 토너먼트", format: "single_elimination", status: "pending", order: stages.length };

  const list = Object.entries(allMatches).map(([id, m]) => ({ id, ...m } as Data & { id: string }));
  const existing = list.filter(m => {
    const sid = str(m.stageId);
    return sid === finalsStageId || sid.startsWith(`${finalsStageId}_`);
  });
  if (existing.length > 0) {
    return { code: "finals_exist", existingCount: existing.length, error: `이미 본선 경기가 ${existing.length}건 있습니다. 중복 생성하지 않습니다.` };
  }

  const qualStageId = str(qualStage?.id);
  const qualMatches = list.filter(m => (qualStageId ? m.stageId === qualStageId : !!str(m.groupId)));
  if (qualMatches.length === 0) return { code: "no_qualifying", error: "예선 경기가 없습니다." };

  let rules = resolveCompetitionRules(tour, qualStageId || undefined);
  const perGroup = typeof input.advancePerGroup === "number" && input.advancePerGroup > 0 ? input.advancePerGroup : rules.qualification.perGroup;
  const wildcards = typeof input.wildcardCount === "number" && input.wildcardCount >= 0 ? input.wildcardCount : rules.qualification.wildcards;
  const ctxBase = resultContextFor(tour, "standings", qualStageId || undefined);
  let qual = selectQualifiers(qualMatches as MatchLike[], ctxBase, { perGroup, wildcards });

  if (!qual.complete && !input.force) {
    return { code: "qualifying_incomplete", incompleteCount: qual.incompleteCount, error: `예선 경기 ${qual.incompleteCount}건이 끝나지 않았습니다. 모두 끝난 뒤 생성하거나 force로 강제하세요.` };
  }

  const decisions: Record<string, TiebreakDecision> = {};
  if (qual.blockingTies.length > 0 && input.resolveTiesByLot) {
    const seed = input.lotSeed || `${tid}-${deps.now}`;
    for (const tie of qual.blockingTies) {
      const key = tiebreakDecisionKey(tie.scope, tie.ids);
      decisions[key] = { ids: seededShuffle(tie.ids, `${seed}|${tie.scope}`), scope: tie.scope, decidedAt: deps.now, decidedBy: "lot", note: `seed=${seed}` };
    }
    rules = { ...rules, tiebreakDecisions: { ...rules.tiebreakDecisions, ...decisions } };
    qual = selectQualifiers(qualMatches as MatchLike[], { ...ctxBase, rules }, { perGroup, wildcards, rules });
  }
  if (qual.blockingTies.length > 0) {
    const nameOf = new Map(qual.groups.flatMap(g => g.ranking.ranked.map(r => [r.row.id, r.row.name] as const)));
    const ties = qual.blockingTies.map(t => ({ scope: t.scope, fromRank: t.fromRank, toRank: t.toRank, participants: t.ids.map(id => ({ id, name: nameOf.get(id) || id })) }));
    return {
      code: "unresolved_tie", ties,
      error: `진출 경계에 동률이 있습니다: ${ties.map(t => `${t.scope || "리그"} ${t.fromRank}~${t.toRank}위 (${t.participants.map(p => p.name).join(", ")})`).join("; ")}. 관리자 화면에서 순서를 정해 주세요.`,
    };
  }

  const qualifiers = qual.qualifiers;
  if (qualifiers.length < 2) return { code: "not_enough_qualifiers", count: qualifiers.length, error: `진출자 ${qualifiers.length}명. 최소 2명 필요.` };

  const finalsRules = resolveCompetitionRules(tour, finalsStageId);
  const seedOrder = crossGroupSeedOrder(qualifiers, { avoidSameGroup: finalsRules.qualification.avoidSameGroupFirstRound });
  const size = nextPowerOfTwo(seedOrder.length);
  const slots = placeSeeds(seedOrder, size);
  if (findDuplicateSlot(slots)) return { code: "invalid_bracket", error: "같은 선수가 두 번 배치되었습니다." };
  const seedNo = new Map(seedOrder.map((q, i) => [q.id, i + 1]));

  const isTeam = isTeamType(tour.type);
  const matchType = isTeam ? "team" : "individual";
  const teams = deps.teams || {};
  const teamObj = (id: string) => {
    const t = teams[id];
    return t ? { memberIds: t.memberIds || [], memberNames: t.memberNames || [], coachName: t.coachName || "" } : undefined;
  };
  const side = (n: 1 | 2, id: string, name: string): Data => {
    const out: Data = { [`player${n}Id`]: id, [`player${n}Name`]: name };
    if (isTeam) {
      out[`team${n}Id`] = id;
      out[`team${n}Name`] = name;
      const obj = id ? teamObj(id) : undefined;
      if (obj) out[`team${n}`] = obj;
    }
    return out;
  };
  const emptySet = () => ({ player1Score: 0, player2Score: 0, player1Faults: 0, player2Faults: 0, player1Violations: 0, player2Violations: 0, winnerId: null });
  let order = 0;
  const base = (round: number, pos: number, label: string, stageId = finalsStageId): Data => ({
    tournamentId: tid, type: matchType, status: "pending", round, bracketPosition: pos,
    bracketRound: label, roundLabel: label, stageId,
    ...side(1, "", UNDECIDED_NAME), ...side(2, "", UNDECIDED_NAME),
    sets: [emptySet()], currentSet: 0, player1Timeouts: 0, player2Timeouts: 0,
    winnerId: null, createdAt: deps.now + order++,
  });

  const out: Array<{ key: string; match: Data }> = [];
  const summary: string[] = [];
  const firstLabel = roundName(size);
  let prevKeys: string[] = [];
  let realCount = 0;
  const r1Lines: string[] = [];
  const label = (q: Qualifier) => `${q.name}(${q.groupId || "리그"} ${q.groupRank}위${q.wildcard ? ", WC" : ""})`;
  for (let k = 0; k < size / 2; k++) {
    const a = slots[2 * k];
    const b = slots[2 * k + 1];
    const m = base(1, k, firstLabel);
    if (a) Object.assign(m, side(1, a.id, a.name), { player1Seed: seedNo.get(a.id) });
    if (b) Object.assign(m, side(2, b.id, b.name), { player2Seed: seedNo.get(b.id) });
    if (!a || !b) {
      const real = a || b;
      if (!a) Object.assign(m, side(1, "", BYE_NAME));
      if (!b) Object.assign(m, side(2, "", BYE_NAME));
      m.isBye = true;
      if (real) {
        const winnerSide = a ? 1 : 2;
        m.status = "completed";
        m.winnerId = real.id;
        m.walkover = true;
        m.walkoverReason = BYE_WALKOVER_REASON;
        m.sets = buildByeSets(resolveMatchScoring(m, tour), finalsRules, winnerSide, real.id);
        r1Lines.push(`  (부전승) ${label(real)}`);
      } else {
        m.status = "completed";
        m.sets = [];
      }
    } else {
      realCount++;
      r1Lines.push(`  ${realCount}. ${label(a)} vs ${label(b)}`);
    }
    const key = deps.makeKey();
    out.push({ key, match: m });
    prevKeys.push(key);
  }
  summary.push(`[ ${firstLabel} ] ${realCount}경기${size / 2 - realCount > 0 ? ` (부전승 ${size / 2 - realCount})` : ""}`, ...r1Lines);

  let semifinalKeys: string[] = size === 4 ? [...prevKeys] : [];
  let quarterKeys: string[] = size === 8 ? [...prevKeys] : [];
  const rounds = Math.log2(size);
  for (let round = 2; round <= rounds; round++) {
    const participants = size / Math.pow(2, round - 1);
    const rLabel = roundName(participants);
    const keys: string[] = [];
    for (let k = 0; k < prevKeys.length / 2; k++) {
      const m = base(round, k, rLabel);
      Object.assign(m, { sourceMatch1: prevKeys[2 * k], sourceMatch2: prevKeys[2 * k + 1], sourceType: "winner" });
      const key = deps.makeKey();
      out.push({ key, match: m });
      keys.push(key);
    }
    summary.push(`[ ${rLabel} ] ${keys.length}경기`);
    if (participants === 4) semifinalKeys = [...keys];
    if (participants === 8) quarterKeys = [...keys];
    prevKeys = keys;
  }

  // 3/4위전: 명시적 입력이 있으면 그것, 없으면 대회 규칙(finalRanking.thirdPlace, 레거시 rankingMatchConfig.thirdPlace 포함)
  const includeThirdPlace = typeof input.includeThirdPlace === "boolean" ? input.includeThirdPlace : finalsRules.finalRanking.thirdPlace === "match";
  if (includeThirdPlace && semifinalKeys.length === 2) {
    const m = base(rounds + 1, 0, "3/4위 결정전", `${finalsStageId}_3rd`);
    delete m.bracketRound;
    m.bracketRound = "3/4위";
    Object.assign(m, { sourceMatch1: semifinalKeys[0], sourceMatch2: semifinalKeys[1], sourceType: "loser" });
    out.push({ key: deps.makeKey(), match: m });
    summary.push("[ 3/4위 결정전 ] 1경기");
  }

  // 5~8위 결정전: 8강 패자 (패자 링크, 진출 트리거가 채운다)
  const fr = finalsRules.finalRanking;
  const fifthFormat: FifthToEighthFormat = input.fifthToEighthFormat
    ?? (input.includeFifthToEighth === false ? "none"
      : input.includeFifthToEighth === true ? (fr.fifthToEighthMatches === "none" ? "full" : fr.fifthToEighthMatches)
        : fr.fifthToEighthMatches);
  if (fifthFormat !== "none" && quarterKeys.length === 4) {
    const stage58 = `${finalsStageId}_5to8`;
    const placement = (round: number, pos: number, lbl: string, s1: string, s2: string, type: "winner" | "loser"): string => {
      const m = base(round, pos, lbl, stage58);
      m.bracketRound = lbl.replace(/\s*결정전$/, "");
      Object.assign(m, { sourceMatch1: s1, sourceMatch2: s2, sourceType: type });
      const key = deps.makeKey();
      out.push({ key, match: m });
      return key;
    };
    if (fifthFormat === "round_robin") {
      let n = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) placement(rounds + 1, n++, "5~8위 순위 결정전", quarterKeys[i], quarterKeys[j], "loser");
      }
      summary.push("[ 5~8위 순위 결정전 ] 8강 패자 4명, 6경기");
    } else {
      const c1 = placement(rounds + 1, 0, "5-8위 결정전", quarterKeys[0], quarterKeys[1], "loser");
      const c2 = placement(rounds + 1, 1, "5-8위 결정전", quarterKeys[2], quarterKeys[3], "loser");
      if (fifthFormat === "full") {
        placement(rounds + 2, 0, "5/6위 결정전", c1, c2, "winner");
        placement(rounds + 2, 1, "7/8위 결정전", c1, c2, "loser");
        summary.push("[ 5~8위 결정전 ] 교차전 2경기 → 5/6위전·7/8위전");
      } else {
        summary.push("[ 5~8위 결정전 ] 교차전 2경기 (승자 공동 5위, 패자 공동 7위)");
      }
    }
  }

  // 하위 순위 결정전: 예선 탈락자를 티어별 풀리그로 (classificationGroups 또는 rankingUpTo만 설정)
  const rankingUpTo = typeof input.rankingUpTo === "number" ? input.rankingUpTo : fr.rankingUpTo;
  const includeClassification = typeof input.includeClassification === "boolean" ? input.includeClassification : fr.classificationGroups;
  const includeFifth = fifthFormat !== "none";
  const eliminated = [...qual.eliminated].sort((x, y) => x.groupRank - y.groupRank || (x.groupId < y.groupId ? -1 : 1));
  if ((includeClassification || (rankingUpTo > 0 && !includeFifth)) && eliminated.length >= 2) {
    const tierSize = Math.max(2, fr.classificationGroupSize);
    const maxSlots = rankingUpTo > 0 ? Math.max(0, rankingUpTo - qualifiers.length) : eliminated.length;
    let remaining = eliminated.slice(0, Math.min(maxSlots, eliminated.length));
    let tierStart = qualifiers.length + 1;
    let t = 0;
    while (remaining.length >= 2) {
      const members = remaining.slice(0, tierSize);
      const tierEnd = tierStart + members.length - 1;
      const tLabel = `${tierStart}~${tierEnd}위 순위 결정전`;
      let n = 0;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const m = base(++n, n - 1, tLabel, `${finalsStageId}_class_${t}`);
          delete m.bracketPosition;
          Object.assign(m, side(1, members[i].id, members[i].name), side(2, members[j].id, members[j].name));
          out.push({ key: deps.makeKey(), match: m });
        }
      }
      summary.push(`[ ${tLabel} ] ${members.length}명, ${n}경기`);
      remaining = remaining.slice(tierSize);
      tierStart = tierEnd + 1;
      t++;
    }
  }

  const groupRankings = qual.groups
    .map(g => `${g.groupId || "리그"}: ${g.ranking.ranked.map(r => `${r.rank}.${r.row.name}(${r.row.wins}승)`).join(", ")}`)
    .join("\n");

  return { finalsStageId, newStage, matches: out, decisions, qualifiers, eliminated: qual.eliminated, summary, groupRankings };
}

export function isPlanError(p: FinalsPlan | FinalsPlanError): p is FinalsPlanError {
  return "code" in p;
}
