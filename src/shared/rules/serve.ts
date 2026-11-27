/**
 * 서브 순서·사이드 체인지 규칙 (M0g). 심판 화면(개인·단체), 시뮬레이션, 관전 표시가 같은 함수를 쓴다.
 *
 * - 서브 수: ScoringRuleSet.servesPerTurn (없으면 개인 2, 단체 3). 소유자 요구: 일부 단체전은 21점 2서브.
 * - 사이드 체인지: 결정 세트(단판 포함)에서 한쪽이 sideChangeAt에 닿을 때 한 번(없으면 ceil(목표 점수/2)).
 *   결정 세트가 아닌 세트는 세트가 끝난 뒤 코트를 바꾼다(IBSA).
 * - 단체전 서브 순서: serveRotation 토큰("A1" = 그 세트 첫 서브 팀의 1번, "B1" = 상대 팀 1번).
 *   없으면 playersOnCourt(기본 3)로 A1,B1,A2,B2,A3,B3.
 *
 * 순수 모듈. functions/src/shared/rules/serve.ts는 이 파일의 사본이다.
 */
import { rotationFrom, setWinsByRules, type MatchKind, type ScoringRuleSet } from './competitionRules';

export const DEFAULT_SERVES_PER_TURN: Readonly<Record<MatchKind, number>> = { individual: 2, team: 3 };
export const DEFAULT_PLAYERS_ON_COURT = 3;

function posInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

/** 한 사람(팀)이 연속으로 넣는 서브 수 */
export function servesPerTurnOf(rules: Pick<ScoringRuleSet, 'servesPerTurn'>, kind: MatchKind): number {
  return posInt(rules.servesPerTurn) ?? DEFAULT_SERVES_PER_TURN[kind];
}

/** 사이드 체인지 점수 (결정 세트에서 한쪽이 이 점수에 닿으면) */
export function sideChangePointOf(rules: Pick<ScoringRuleSet, 'sideChangeAt' | 'winScore'>): number {
  return posInt(rules.sideChangeAt) ?? Math.ceil(rules.winScore / 2);
}

/** 사이드 체인지 기본값 (화면에 '자동' 값을 보여 줄 때) */
export function defaultSideChangePoint(winScore: number): number {
  return Math.ceil(winScore / 2);
}

/** 단체전 코트 위 선수 수 */
export function playersOnCourtOf(rules: Pick<ScoringRuleSet, 'playersOnCourt'>): number {
  return posInt(rules.playersOnCourt) ?? DEFAULT_PLAYERS_ON_COURT;
}

/** 기본 단체전 서브 순서: A1,B1,A2,B2,…(코트 위 선수 수만큼) */
export function defaultServeRotation(playersOnCourt: number): string[] {
  const n = Math.max(1, Math.floor(playersOnCourt));
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(`A${i}`, `B${i}`);
  return out;
}

/** 유효 단체전 서브 순서 (규칙 값이 잘못됐으면 기본 순서) */
export function serveRotationOf(rules: Pick<ScoringRuleSet, 'serveRotation' | 'playersOnCourt'>): string[] {
  const n = playersOnCourtOf(rules);
  const list = rotationFrom(rules.serveRotation);
  return list && isValidServeRotation(list, n) ? list : defaultServeRotation(n);
}

export interface RotationToken {
  /** A = 그 세트에 먼저 서브한 팀, B = 상대 팀 */
  team: 'A' | 'B';
  /** 1부터 */
  player: number;
}

export function parseRotationToken(tok: unknown): RotationToken | null {
  if (typeof tok !== 'string') return null;
  const m = /^([AB])([1-9])$/.exec(tok.trim().toUpperCase());
  return m ? { team: m[1] as 'A' | 'B', player: Number(m[2]) } : null;
}

/** 서브 순서가 올바른가: 모든 토큰이 A/B + 1..코트 선수 수이고, 두 팀이 모두 나오며, 같은 팀이 연달아 나오지 않는다 */
export function isValidServeRotation(list: readonly string[], playersOnCourt: number): boolean {
  if (list.length < 2) return false;
  const toks = list.map(parseRotationToken);
  if (toks.some(t => !t || t.player > playersOnCourt)) return false;
  const teams = new Set(toks.map(t => t!.team));
  if (teams.size !== 2) return false;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.team === toks[(i + 1) % toks.length]!.team) return false;
  }
  return true;
}

/**
 * 서브 차례가 넘어갈 때 다음 서버.
 * current: 지금 서브를 마친 쪽(A/B)과 선수 번호. 목록에서 그 토큰 다음 토큰을 돌려준다(없으면 목록 첫 토큰 중 상대 팀).
 */
export function nextRotationToken(rotation: readonly string[], current: RotationToken): RotationToken {
  const toks = rotation.map(parseRotationToken).filter((t): t is RotationToken => !!t);
  if (toks.length === 0) return { team: current.team === 'A' ? 'B' : 'A', player: 1 };
  const idx = toks.findIndex(t => t.team === current.team && t.player === current.player);
  if (idx >= 0) return toks[(idx + 1) % toks.length];
  return toks.find(t => t.team !== current.team) ?? toks[0];
}

/**
 * 결정 세트인가: 끝난 세트 기준으로 양쪽 모두 setsToWin - 1 세트를 땄다(단판 경기는 항상 결정 세트).
 * completedSets는 지금 진행 중인 세트를 뺀 목록이다.
 */
export function isDecidingSet(completedSets: ReadonlyArray<{ player1Score?: unknown; player2Score?: unknown }>, rules: ScoringRuleSet): boolean {
  const w = setWinsByRules(completedSets, rules);
  return w.player1 === rules.setsToWin - 1 && w.player2 === rules.setsToWin - 1;
}

/**
 * 세트 도중 사이드 체인지를 해야 하는가 (한 세트에 한 번).
 * 결정 세트에서만, 한쪽 점수가 사이드 체인지 점수 이상일 때.
 */
export function shouldChangeSidesMidSet(
  score: { player1Score: number; player2Score: number },
  completedSets: ReadonlyArray<{ player1Score?: unknown; player2Score?: unknown }>,
  rules: ScoringRuleSet,
  alreadyChanged: boolean,
): boolean {
  if (alreadyChanged) return false;
  if (!isDecidingSet(completedSets, rules)) return false;
  return Math.max(score.player1Score, score.player2Score) >= sideChangePointOf(rules);
}

/** 서브 한 번 뒤의 서버·서브 횟수 (servesPerTurn번 넣으면 상대에게 넘어간다) */
export function advanceServeTurn(
  currentServe: 'player1' | 'player2',
  serveCount: number,
  servesPerTurn: number,
): { currentServe: 'player1' | 'player2'; serveCount: number; turnChanged: boolean } {
  const next = serveCount + 1;
  if (next >= servesPerTurn) {
    return { currentServe: currentServe === 'player1' ? 'player2' : 'player1', serveCount: 0, turnChanged: true };
  }
  return { currentServe, serveCount: next, turnChanged: false };
}

/** 되돌리기: advanceServeTurn의 반대 */
export function revertServeTurn(
  currentServe: 'player1' | 'player2',
  serveCount: number,
  servesPerTurn: number,
): { currentServe: 'player1' | 'player2'; serveCount: number } {
  const prev = serveCount - 1;
  if (prev < 0) {
    return { currentServe: currentServe === 'player1' ? 'player2' : 'player1', serveCount: Math.max(0, servesPerTurn - 1) };
  }
  return { currentServe, serveCount: prev };
}
