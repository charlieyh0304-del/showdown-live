// 자동 생성 사본: 원본은 src/shared/rules/. 직접 고치지 말고 node scripts/sync-shared-rules.mjs를 실행하세요.
/**
 * 시간 제한 경기 · 경기 시계 · 골든골 (M0f). 심판 화면(개인·단체), 관전·중계 화면, 시뮬레이션이 같은 함수를 쓴다.
 *
 * 규칙(ScoringRuleSet, resolveMatchScoring으로 대회 → 스테이지 → 라운드 → 경기 순서로 덮어쓴다)
 * - timeLimitSeconds: 0/없음 = 시간 제한 없음
 * - timeLimitUnit: per_set(세트마다 새로 잰다) | per_match(경기 전체, 기본)
 * - goldenGoalMode: next_point(다음 1점, 반칙 포함 — IBSA, 기본) | goal_only(실제 골만 승부를 낸다)
 *
 * 시계(match.clock, DB에 저장해 새로고침·다른 기기·오프라인 큐에서도 이어진다)
 * - 경기 시간은 "흐른 플레이 시간"(elapsedMs)과 "지금 흐르기 시작한 시각"(runningSince, 서버 시각 기준 ms)으로 저장한다.
 *   남은 시간 = 제한 - (elapsedMs + (지금 - runningSince)). 화면은 이 값을 매 순간 계산만 하고, 쓰기는 시작·정지·재개 때만 한다.
 * - 심판이 '경기 시계 시작'을 누르면(워밍업 뒤) 흐르기 시작한다. 사이드 체인지·타임아웃(선수·심판·의료)·워밍업·세트 종료 확인
 *   동안에는 자동으로 멈추고 끝나면 다시 흐른다. 심판이 사유와 함께 직접 멈추고 다시 시작할 수도 있다.
 * - 시각은 서버 시각(Date.now() + .info/serverTimeOffset)을 쓴다. 기기 시계가 틀려도(앞서거나 늦어도)
 *   흐른 시간은 음수가 되지 않고(runningSince가 미래면 0으로 본다), 정지 시에는 흐른 시간이 줄지 않는다.
 *
 * 시간 만료(decideTimeExpiry)
 * - per_set: 그 세트에서 앞선 쪽이 세트를 이긴다(decidedBy 'time_limit'). 동점이면 골든골.
 * - per_match: 진행 중 세트가 끝난다. 그 세트에서 앞선 쪽이 세트를 가져가고(decidedBy 'time_limit', matchTimeUp),
 *   경기 승자는 세트 승수가 많은 쪽, 세트 승수가 같으면 진행 중 세트를 가져간 쪽(= 그 세트 점수가 앞선 쪽).
 *   진행 중 세트가 동점이면: 세트 승수가 많은 쪽이 이기고(그 세트는 동점 그대로 기록), 세트 승수도 같으면 골든골.
 * - 골든골: 동전 던지기로 서브를 정하고, next_point면 다음 1점(골·반칙·벌점)을 얻은 쪽, goal_only면 다음 골을 넣은 쪽이
 *   세트(per_match면 경기)를 이긴다. goal_only의 반칙 점수는 기록되지만 끝내지 않는다. 기록 점수에는 골든 포인트가 들어간다
 *   (예: 6:6 → 7:6, goal_only 7:7 → 9:7).
 *
 * 순수 모듈. functions/src/shared/rules/timeLimit.ts는 이 파일의 사본이다(scripts/sync-shared-rules.mjs).
 */
import {
  isTimeDecidedSet,
  matchWinnerByRules,
  setWinsByRules,
  type GoldenGoalMode,
  type ScoringRuleSet,
  type SetDecidedBy,
  type SetResultLike,
  type TimeLimitUnit,
} from './competitionRules';

// ===== 규칙 =====

export interface TimeLimitConfig {
  enabled: boolean;
  limitMs: number;
  unit: TimeLimitUnit;
  goldenGoalMode: GoldenGoalMode;
}

export function timeLimitOf(rules: Pick<ScoringRuleSet, 'timeLimitSeconds' | 'timeLimitUnit' | 'goldenGoalMode'> | null | undefined): TimeLimitConfig {
  const sec = rules && typeof rules.timeLimitSeconds === 'number' && Number.isFinite(rules.timeLimitSeconds) && rules.timeLimitSeconds > 0
    ? rules.timeLimitSeconds : 0;
  return {
    enabled: sec > 0,
    limitMs: sec * 1000,
    unit: rules?.timeLimitUnit === 'per_set' ? 'per_set' : 'per_match',
    goldenGoalMode: rules?.goldenGoalMode === 'goal_only' ? 'goal_only' : 'next_point',
  };
}

// ===== 시계 =====

/** 시계가 멈춘 이유. 자동(사이드 체인지·타임아웃·워밍업·세트 종료)과 심판 수동 정지 */
export type ClockPauseReason = 'side_change' | 'timeout' | 'warmup' | 'set_break' | 'manual';

export interface ClockPauseLog {
  reason: ClockPauseReason;
  /** 멈춘 시각 (서버 시각 ms) */
  at: number;
  /** 다시 흐른 시각 */
  until?: number;
  /** 수동 정지 사유 (심판 입력) */
  note?: string;
}

/** 골든골 단계: 동전 던지기(서브 결정) → 골든 포인트 진행 */
export type GoldenGoalPhase = 'coin_toss' | 'playing';

export interface MatchClock {
  /** 시계가 재는 세트(0부터). per_set이면 세트가 바뀔 때 새 시계가 된다. */
  setIndex: number;
  /** 이 시계의 제한(ms). 관전 화면이 규칙을 몰라도 남은 시간을 보여 주도록 함께 저장한다. */
  limitMs: number;
  unit: TimeLimitUnit;
  /** runningSince 이전까지 흐른 플레이 시간(ms) */
  elapsedMs: number;
  /** 흐르는 중이면 흐르기 시작한 서버 시각(ms). 멈췄으면 없음(Firebase는 null을 지운다). */
  runningSince?: number | null;
  /** 심판이 경기 시계를 시작했다(워밍업 뒤) */
  started?: boolean;
  /** 심판 수동 정지 중 (사유) */
  manualPause?: { at: number; note?: string } | null;
  /** 지금 자동으로 멈춘 이유 (관전 화면 표시용) */
  autoPause?: ClockPauseReason | null;
  /** 시간이 끝났다 */
  expired?: boolean;
  /** 시간 만료 후 동점 → 골든골 단계 */
  goldenGoal?: GoldenGoalPhase | null;
  /** 정지 기록 (최근 것이 끝) */
  pauses?: ClockPauseLog[];
  /** per_set: 바로 앞 세트가 끝날 때까지 흐른 시간(ms). 세트 전환을 되돌리면 이 값으로 앞 세트 시계를 되살린다. */
  prevSetElapsedMs?: number;
}

/** DB에서 읽은 값(배열이 숫자 키 객체일 수 있음)을 시계로. 형식이 아니면 null. */
export function clockFrom(v: unknown): MatchClock | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const limitMs = num(o.limitMs);
  if (limitMs === undefined) return null;
  const pausesRaw = Array.isArray(o.pauses) ? o.pauses : o.pauses && typeof o.pauses === 'object' ? Object.values(o.pauses) : [];
  const out: MatchClock = {
    setIndex: Math.max(0, Math.floor(num(o.setIndex) ?? 0)),
    limitMs: Math.max(0, limitMs),
    unit: o.unit === 'per_set' ? 'per_set' : 'per_match',
    elapsedMs: Math.max(0, num(o.elapsedMs) ?? 0),
  };
  const rs = num(o.runningSince);
  if (rs !== undefined) out.runningSince = rs;
  if (o.started === true) out.started = true;
  if (o.manualPause && typeof o.manualPause === 'object') {
    const mp = o.manualPause as Record<string, unknown>;
    out.manualPause = { at: num(mp.at) ?? 0, ...(typeof mp.note === 'string' && mp.note ? { note: mp.note } : {}) };
  }
  if (typeof o.autoPause === 'string') out.autoPause = o.autoPause as ClockPauseReason;
  if (o.expired === true) out.expired = true;
  if (o.goldenGoal === 'coin_toss' || o.goldenGoal === 'playing') out.goldenGoal = o.goldenGoal;
  const pauses = pausesRaw.filter((p): p is ClockPauseLog => !!p && typeof p === 'object' && typeof (p as ClockPauseLog).reason === 'string');
  if (pauses.length > 0) out.pauses = pauses;
  const prevSet = num(o.prevSetElapsedMs);
  if (prevSet !== undefined) out.prevSetElapsedMs = Math.max(0, prevSet);
  return out;
}

/** 새 시계 (아직 시작 전). 시작은 startClock. */
export function newClock(cfg: Pick<TimeLimitConfig, 'limitMs' | 'unit'>, setIndex = 0): MatchClock {
  return { setIndex, limitMs: cfg.limitMs, unit: cfg.unit, elapsedMs: 0 };
}

export function isClockRunning(c: MatchClock | null | undefined): boolean {
  return !!c && typeof c.runningSince === 'number';
}

/** 지금까지 흐른 플레이 시간(ms). 기기 시계가 runningSince보다 늦어도 음수가 되지 않는다. */
export function clockElapsedMs(c: MatchClock | null | undefined, now: number): number {
  if (!c) return 0;
  const running = typeof c.runningSince === 'number' ? Math.max(0, now - c.runningSince) : 0;
  return Math.max(0, c.elapsedMs) + running;
}

/** 남은 시간(ms, 0 이상) */
export function clockRemainingMs(c: MatchClock | null | undefined, now: number): number {
  if (!c) return 0;
  return Math.max(0, c.limitMs - clockElapsedMs(c, now));
}

/** 화면용 남은 초 (올림: 0.2초 남으면 1초) */
export function clockRemainingSeconds(c: MatchClock | null | undefined, now: number): number {
  return Math.ceil(clockRemainingMs(c, now) / 1000);
}

/** 흐르는 시계를 멈춘다(흐른 시간을 elapsedMs에 쌓는다). 이미 멈췄으면 그대로. */
function freeze(c: MatchClock, now: number): MatchClock {
  if (typeof c.runningSince !== 'number') return c;
  const elapsed = Math.min(c.limitMs, clockElapsedMs(c, now));
  const next: MatchClock = { ...c, elapsedMs: elapsed };
  delete next.runningSince;
  return next;
}

function addPause(c: MatchClock, reason: ClockPauseReason, now: number, note?: string): MatchClock {
  const pauses = [...(c.pauses ?? []), { reason, at: now, ...(note ? { note } : {}) }];
  // 기록은 최근 30개만 (DB 크기 제한)
  return { ...c, pauses: pauses.slice(-30) };
}

function closePause(c: MatchClock, now: number): MatchClock {
  const pauses = [...(c.pauses ?? [])];
  const last = pauses[pauses.length - 1];
  if (last && last.until === undefined) pauses[pauses.length - 1] = { ...last, until: now };
  return pauses.length > 0 ? { ...c, pauses } : c;
}

/** 시계를 멈춰야 하는 이유: 자동 정지 + 수동 정지 + 시작 전·만료·골든골 */
export interface ClockContext {
  /** 자동 정지 이유 (없으면 null) */
  autoPause: ClockPauseReason | null;
  /** 경기가 진행 중인가 */
  inProgress: boolean;
}

/** 지금 시계가 흘러야 하는가 */
export function shouldClockRun(c: MatchClock, ctx: ClockContext): boolean {
  return ctx.inProgress && !!c.started && !c.expired && !c.goldenGoal && !c.manualPause && !ctx.autoPause;
}

/**
 * 경기 상태에 맞춰 시계를 맞춘다. 바꿀 것이 없으면 null(쓰기 없음).
 * - 흘러야 하는데 멈춰 있으면 지금부터 흐르게 한다(정지 기록을 닫는다).
 * - 멈춰야 하는데 흐르면 지금까지 흐른 시간을 쌓고 멈춘다(자동 정지 이유를 기록한다).
 * - 자동 정지 이유만 바뀌었으면 표시용 autoPause만 고친다.
 */
export function reconcileClock(c: MatchClock, ctx: ClockContext, now: number): MatchClock | null {
  const run = shouldClockRun(c, ctx);
  const running = isClockRunning(c);
  const wantAuto = c.started && ctx.inProgress && !c.expired && !c.goldenGoal ? ctx.autoPause : null;
  if (run && !running) {
    const next: MatchClock = { ...closePause(c, now), runningSince: now };
    delete next.autoPause;
    return next;
  }
  if (!run && running) {
    let next = freeze(c, now);
    if (wantAuto) next = addPause({ ...next, autoPause: wantAuto }, wantAuto, now);
    else delete next.autoPause;
    return next;
  }
  if ((c.autoPause ?? null) !== (wantAuto ?? null) && !running) {
    let next: MatchClock = { ...c };
    if (wantAuto) next = { ...next, autoPause: wantAuto };
    else delete next.autoPause;
    return next;
  }
  return null;
}

/** 심판이 경기 시계를 시작한다(워밍업 뒤). 자동 정지 중이면 시작만 표시하고 정지가 끝나면 흐른다. */
export function startClock(c: MatchClock, ctx: ClockContext, now: number): MatchClock {
  const started: MatchClock = { ...c, started: true };
  return reconcileClock(started, ctx, now) ?? started;
}

/** 심판 수동 정지 (사유) */
export function pauseClockManually(c: MatchClock, now: number, note?: string): MatchClock {
  if (c.manualPause) return c;
  const frozen = freeze(c, now);
  const next: MatchClock = { ...frozen, manualPause: { at: now, ...(note ? { note } : {}) } };
  return addPause(next, 'manual', now, note);
}

/** 심판 수동 재개. 자동 정지 중이면 수동 정지만 풀고 자동 정지가 끝나면 흐른다. */
export function resumeClockManually(c: MatchClock, ctx: ClockContext, now: number): MatchClock {
  if (!c.manualPause) return c;
  const next: MatchClock = closePause({ ...c }, now);
  delete next.manualPause;
  return reconcileClock(next, ctx, now) ?? next;
}

/** 시간 만료 시 시계 (제한까지 흐른 것으로 고정). tie면 골든골 동전 던지기 단계로. */
export function expireClock(c: MatchClock, now: number, goldenGoal: boolean): MatchClock {
  const frozen = freeze(c, now);
  const next: MatchClock = { ...frozen, elapsedMs: c.limitMs, expired: true };
  delete next.autoPause;
  delete next.manualPause;
  if (goldenGoal) next.goldenGoal = 'coin_toss';
  else delete next.goldenGoal;
  return next;
}

/** 골든골 동전 던지기를 마쳤다 → 골든 포인트 진행 */
export function startGoldenPlay(c: MatchClock): MatchClock {
  return c.goldenGoal === 'coin_toss' ? { ...c, goldenGoal: 'playing' } : c;
}

/**
 * 다음 세트로 넘어갈 때의 시계.
 * - per_set: 새 세트의 새 시계(시작한 상태, 세트 사이 사이드 체인지가 끝나면 흐른다).
 * - per_match: 같은 시계를 이어 쓴다(세트 사이에는 멈춘다).
 */
export function clockForNextSet(c: MatchClock, nextSetIndex: number, now: number): MatchClock {
  if (c.unit === 'per_set') {
    const prevSetElapsedMs = Math.min(c.limitMs, clockElapsedMs(c, now));
    return { setIndex: nextSetIndex, limitMs: c.limitMs, unit: c.unit, elapsedMs: 0, started: true, autoPause: 'set_break', prevSetElapsedMs };
  }
  const frozen = freeze(c, now);
  return { ...frozen, setIndex: nextSetIndex };
}

/**
 * 세트 전환을 되돌릴 때(앞 세트로 돌아감)의 시계.
 * - per_set: 앞 세트가 끝날 때까지 흐른 시간(prevSetElapsedMs)으로 앞 세트 시계를 되살린다(남은 시간이 처음으로 돌아가지 않는다).
 * - per_match: 같은 시계를 그대로 쓰고 세트 번호만 되돌린다.
 */
export function clockForUndoneSet(c: MatchClock, prevSetIndex: number): MatchClock {
  if (c.unit !== 'per_set') return { ...c, setIndex: prevSetIndex };
  const elapsedMs = Math.min(c.limitMs, c.prevSetElapsedMs ?? 0);
  return { setIndex: prevSetIndex, limitMs: c.limitMs, unit: c.unit, elapsedMs, started: true, autoPause: 'set_break' };
}

// ===== 알림 =====

/** 남은 시간 알림 시점(ms): 5분, 1분, 30초, 종료(0) */
export const CLOCK_ALERT_MILESTONES_MS: readonly number[] = [5 * 60_000, 60_000, 30_000, 0];

/**
 * 남은 시간이 prev → next로 줄면서 지난 알림 시점들 (큰 것부터).
 * prev가 없으면(첫 관찰·새로고침) 이미 지난 시점은 알리지 않는다.
 * 제한이 시점보다 짧으면(예: 3분 제한의 5분 알림) 그 시점은 지나간 것이 아니라 처음부터 없던 것이다.
 */
export function crossedMilestones(prevRemainingMs: number | null | undefined, nextRemainingMs: number, milestones: readonly number[] = CLOCK_ALERT_MILESTONES_MS): number[] {
  if (prevRemainingMs === null || prevRemainingMs === undefined || !Number.isFinite(prevRemainingMs)) return [];
  if (nextRemainingMs >= prevRemainingMs) return [];
  return milestones.filter(m => prevRemainingMs > m && nextRemainingMs <= m);
}

// ===== 시간 만료 판정 =====

export interface TimedSet extends SetResultLike {
  player1Score: number;
  player2Score: number;
  winnerId?: string | null;
  decidedBy?: SetDecidedBy;
  decidedWinner?: 1 | 2;
  matchTimeUp?: boolean;
}

export type TimeExpiryOutcome<S extends TimedSet> =
  /** 세트가 시간으로 끝났다. sets는 표시를 붙인 세트 목록. matchWinner가 있으면 경기도 끝났다. */
  | { kind: 'decided'; sets: S[]; setWinner: 1 | 2 | null; matchWinner: 1 | 2 | null }
  /** 동점: 골든골 (세트에는 아직 표시를 붙이지 않는다) */
  | { kind: 'golden_goal' };

/**
 * 시간이 끝났을 때 (현재 세트 ci, 0부터).
 * 반환하는 세트에는 decidedBy·matchTimeUp 표시만 붙는다. winnerId는 호출자가 승자 ID로 채운다.
 */
export function decideTimeExpiry<S extends TimedSet>(sets: readonly S[], ci: number, rules: ScoringRuleSet, unit: TimeLimitUnit): TimeExpiryOutcome<S> {
  const cs = sets[ci];
  if (!cs) return { kind: 'golden_goal' };
  const p1 = cs.player1Score ?? 0;
  const p2 = cs.player2Score ?? 0;
  const leader: 1 | 2 | null = p1 > p2 ? 1 : p2 > p1 ? 2 : null;
  const marked = (extra: Partial<TimedSet>): S[] => sets.map((s, i) => (i === ci ? { ...s, decidedBy: 'time_limit', ...extra } as S : { ...s }));

  if (unit === 'per_set') {
    if (!leader) return { kind: 'golden_goal' };
    const next = marked({});
    return { kind: 'decided', sets: next, setWinner: leader, matchWinner: matchWinnerByRules(next, rules) };
  }
  // per_match
  if (leader) {
    const next = marked({ matchTimeUp: true });
    return { kind: 'decided', sets: next, setWinner: leader, matchWinner: matchWinnerByRules(next, rules) };
  }
  const before = setWinsByRules(sets.filter((_, i) => i !== ci), rules);
  if (before.player1 === before.player2) return { kind: 'golden_goal' };
  const next = marked({ matchTimeUp: true });
  return { kind: 'decided', sets: next, setWinner: null, matchWinner: matchWinnerByRules(next, rules) };
}

// ===== 골든골 =====

export interface GoldenPointInput {
  actionType: string;
  /** 점수를 얻는 쪽 (반칙이면 상대) */
  scorer: 1 | 2;
  points: number;
  /** 반칙·벌점 등 상대에게 점수가 가는 동작 */
  toOpponent: boolean;
}

/** 이 점수가 골든골을 끝내는가 */
export function isGoldenPointDecisive(mode: GoldenGoalMode, input: GoldenPointInput): boolean {
  if (input.points <= 0) return false;
  if (mode === 'goal_only') return input.actionType === 'goal' && !input.toOpponent;
  return true;
}

/**
 * 골든골 중 점수 하나를 반영한다. 점수는 항상 기록에 들어간다(골든 포인트 포함).
 * 끝내는 점수면 그 세트에 decidedBy 'golden_goal' + decidedWinner(+ per_match면 matchTimeUp)를 붙인다.
 */
export function applyGoldenPoint<S extends TimedSet>(
  sets: readonly S[],
  ci: number,
  input: GoldenPointInput,
  cfg: Pick<TimeLimitConfig, 'goldenGoalMode' | 'unit'>,
  rules: ScoringRuleSet,
): { sets: S[]; decisive: boolean; matchWinner: 1 | 2 | null } {
  const next = sets.map(s => ({ ...s }));
  const cs = next[ci];
  if (!cs) return { sets: next, decisive: false, matchWinner: null };
  if (input.scorer === 1) cs.player1Score += input.points;
  else cs.player2Score += input.points;
  const decisive = isGoldenPointDecisive(cfg.goldenGoalMode, input);
  if (!decisive) return { sets: next, decisive: false, matchWinner: null };
  const marked = { ...cs, decidedBy: 'golden_goal', decidedWinner: input.scorer, ...(cfg.unit === 'per_match' ? { matchTimeUp: true } : {}) } as S;
  next[ci] = marked;
  return { sets: next, decisive: true, matchWinner: matchWinnerByRules(next, rules) };
}

/** 세트의 시간 제한 표시를 지운다 (되돌리기) */
export function stripTimeDecision<S extends TimedSet>(s: S): S {
  if (!isTimeDecidedSet(s) && s.matchTimeUp === undefined && s.decidedWinner === undefined) return s;
  const out = { ...s };
  delete out.decidedBy;
  delete out.decidedWinner;
  delete out.matchTimeUp;
  return out;
}

/** 경기를 끝낸 방식 (기록·표시용): 마지막 세트가 시간 제한·골든골로 끝났으면 그 방식 */
export function matchDecidedBy(sets: ReadonlyArray<SetResultLike | null | undefined>): SetDecidedBy | null {
  for (let i = sets.length - 1; i >= 0; i--) {
    const s = sets[i];
    if (!s) continue;
    return s.decidedBy === 'golden_goal' || s.decidedBy === 'time_limit' ? s.decidedBy : null;
  }
  return null;
}
