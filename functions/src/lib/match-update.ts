/**
 * 챗봇 add_match / update_match의 판정 관련 순수 로직 (M0g, 감사 #6·#7 및 챗봇 부전승).
 * - add_match: 경기 type 기본값 = 대회 type (단체 대회면 'team')
 * - update_match: winnerId는 경기 참가자여야 하고, 세트 점수가 규칙상 다른 승자를 가리키면 거절한다.
 *   walkover: true면 부전승 표시(walkover, walkoverReason)와 규칙의 부전승 세트(기본 목표 점수 : 0 × 이겨야 하는 세트 수)를 쓴다.
 */
import { isObject, isTeamType, matchWinnerByRules, resolveCompetitionRules, resolveMatchScoring, toList } from "../shared/rules/competitionRules";
import { buildWalkoverSets } from "../shared/rules/walkover";

type Data = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** 대회 type → 새 경기 type (DB 규칙은 individual/team만 허용) */
export function defaultMatchType(tournamentType: unknown, requested: unknown, hasTeamIds: boolean): "individual" | "team" {
  if (requested === "team" || requested === "individual") return requested;
  if (hasTeamIds) return "team";
  return isTeamType(tournamentType) ? "team" : "individual";
}

function sideIds(m: Data): { s1: string; s2: string } {
  const team = isTeamType(m.type);
  const s1 = team ? (str(m.team1Id) || str(m.player1Id)) : (str(m.player1Id) || str(m.team1Id));
  const s2 = team ? (str(m.team2Id) || str(m.player2Id)) : (str(m.player2Id) || str(m.team2Id));
  return { s1, s2 };
}

export type MatchUpdatePlan = { updates: Data } | { error: string };

export function planMatchUpdate(match: Data, tournament: Data | null | undefined, fields: Data): MatchUpdatePlan {
  const updates: Data = { ...fields };
  const merged: Data = { ...match, ...fields };
  const { s1, s2 } = sideIds(merged);
  const valid = [match.player1Id, match.player2Id, match.team1Id, match.team2Id, fields.player1Id, fields.player2Id, fields.team1Id, fields.team2Id].filter(Boolean);

  const winnerId = "winnerId" in fields ? fields.winnerId : match.winnerId;
  if ("winnerId" in fields && typeof fields.winnerId === "string" && fields.winnerId !== "" && !valid.includes(fields.winnerId)) {
    return { error: "승자 ID가 경기 참가자와 일치하지 않습니다." };
  }

  const rules = resolveMatchScoring(merged, tournament);

  // 부전승: 표시 + 규칙의 부전승 세트
  if (fields.walkover === true) {
    const w = str(winnerId);
    if (!w || (w !== s1 && w !== s2)) return { error: "부전승은 승자(winnerId)를 경기 참가자 중 하나로 지정해야 합니다." };
    const side: 1 | 2 = w === s1 ? 1 : 2;
    const wo = resolveCompetitionRules(tournament, merged.stageId).walkover;
    updates.sets = buildWalkoverSets(rules, wo, side, w);
    updates.status = "completed";
    updates.winnerId = w;
    updates.walkover = true;
    updates.walkoverReason = str(fields.walkoverReason) || "부전승";
    updates.currentSet = 0;
    return { updates };
  }

  // 세트 점수가 규칙상 승자를 정하면 winnerId와 맞아야 한다
  const sets = toList<unknown>("sets" in fields ? fields.sets : match.sets).filter(isObject);
  const decided = sets.length > 0 ? matchWinnerByRules(sets, rules) : null;
  const decidedId = decided === 1 ? s1 : decided === 2 ? s2 : "";
  const w = str(winnerId);
  if (decidedId && w && w !== decidedId && ("winnerId" in fields || "sets" in fields)) {
    return { error: `세트 점수로는 승자가 ${decidedId}인데 winnerId가 ${w}입니다. 점수나 승자를 고쳐 주세요.` };
  }
  // 완료로 바꾸면서 승자를 안 주었으면 세트 점수의 승자를 쓴다
  if (fields.status === "completed" && !w && decidedId) updates.winnerId = decidedId;
  return { updates };
}
