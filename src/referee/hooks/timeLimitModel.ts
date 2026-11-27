/**
 * 심판 화면의 시간 제한·골든골 순수 로직 (M0f). 개인전·단체전 심판 훅이 같이 쓴다.
 * 판정은 shared/rules/timeLimit.ts(decideTimeExpiry, applyGoldenPoint)와 setEndOutcome(세트 종료)이 한다.
 * 여기서는 그 결과를 경기 쓰기(update)로 만든다. Firebase·React에 의존하지 않아 단위 테스트한다.
 */
import type { Match, ScoreHistoryEntry, SetScore } from '@shared/types';
import { matchWinnerByRules, setWinnerOf, type ScoringRuleSet } from '@shared/rules/competitionRules';
import {
  clockFrom,
  clockForNextSet,
  clockForUndoneSet,
  decideTimeExpiry,
  expireClock,
  newClock,
  type ClockPauseReason,
  type MatchClock,
  type TimeLimitConfig,
} from '@shared/rules/timeLimit';

type Side = 'player1' | 'player2';

/** 경기 상태에서 시계를 자동으로 멈출 이유 (우선순위: 타임아웃 → 워밍업 → 사이드 체인지 → 세트 종료 확인) */
export function clockAutoPauseReason(s: {
  activeTimeout?: unknown;
  warmup?: boolean;
  sideChange?: boolean;
  setBreak?: boolean;
}): ClockPauseReason | null {
  if (s.activeTimeout) return 'timeout';
  if (s.warmup) return 'warmup';
  if (s.sideChange) return 'side_change';
  if (s.setBreak) return 'set_break';
  return null;
}

/**
 * 규칙과 경기에 맞는 시계 (쓰기가 필요 없으면 null).
 * - 시계가 없으면 새로 만든다(시작 전).
 * - 규칙의 제한·단위가 바뀌었으면(만료 전) 따라 바꾼다.
 * - per_set인데 세트가 바뀌었는데 시계가 그대로면(다른 경로로 세트가 바뀐 경우) 새 세트 시계로 바꾼다.
 */
export function syncClockToRules(raw: unknown, cfg: TimeLimitConfig, currentSet: number): MatchClock | null {
  if (!cfg.enabled) return null;
  const c = clockFrom(raw);
  if (!c) return newClock(cfg, currentSet);
  if (cfg.unit === 'per_set' && c.setIndex !== currentSet) {
    return { ...newClock(cfg, currentSet), ...(c.started ? { started: true } : {}) };
  }
  if (!c.expired && (c.limitMs !== cfg.limitMs || c.unit !== cfg.unit)) return { ...c, limitMs: cfg.limitMs, unit: cfg.unit };
  return null;
}

/** 기록 한 줄 (시간 만료·골든골 서브 결정) */
function metaEntry(match: Pick<Match, 'currentSet' | 'sets' | 'currentServe' | 'serveCount'>, actionType: ScoreHistoryEntry['actionType'], label: string, time: string, serverName: string, serverSide: Side): ScoreHistoryEntry {
  const ci = match.currentSet ?? 0;
  const cs = match.sets?.[ci];
  const score = { player1: cs?.player1Score ?? 0, player2: cs?.player2Score ?? 0 };
  return {
    time, set: ci + 1, scoringPlayer: '', actionPlayer: '', actionType, actionLabel: label, points: 0,
    server: serverName, serveNumber: (match.serveCount ?? 0) + 1,
    scoreBefore: score, scoreAfter: score, serverSide,
  };
}

export type TimeExpiryPlan =
  /** 동점 → 골든골 동전 던지기 */
  | { kind: 'golden_goal'; update: Record<string, unknown> }
  /**
   * 세트(또는 경기)가 시간으로 끝났다. sets는 표시와 승자 ID를 붙인 세트.
   * 이어서 setEndOutcome으로 경기 완료/다음 세트를 정한다.
   */
  | { kind: 'decided'; sets: SetScore[]; setWinner: 1 | 2 | null; matchWinner: 1 | 2 | null; clock: MatchClock; entry: ScoreHistoryEntry };

/** 시간 만료 처리 계획 */
export function planTimeExpiry(
  match: Pick<Match, 'currentSet' | 'sets' | 'currentServe' | 'serveCount' | 'scoreHistory' | 'clock'>,
  rules: ScoringRuleSet,
  cfg: TimeLimitConfig,
  now: number,
  opts: { sideIds: [string, string]; time: string; label: string; serverName: string },
): TimeExpiryPlan | null {
  const clock = clockFrom(match.clock);
  if (!clock || clock.expired) return null;
  const ci = match.currentSet ?? 0;
  const sets = (match.sets ?? []).map(s => ({ ...s }));
  if (!sets[ci]) return null;
  const entry = metaEntry(match, 'time_expired', opts.label, opts.time, opts.serverName, match.currentServe ?? 'player1');
  const out = decideTimeExpiry(sets, ci, rules, cfg.unit);
  if (out.kind === 'golden_goal') {
    return {
      kind: 'golden_goal',
      update: {
        clock: expireClock(clock, now, true),
        goldenGoalActive: true,
        scoreHistory: [entry, ...(match.scoreHistory ?? [])],
      },
    };
  }
  const marked = out.sets.map((s, i) => (i === ci && out.setWinner ? { ...s, winnerId: opts.sideIds[out.setWinner - 1] } : s)) as SetScore[];
  return { kind: 'decided', sets: marked, setWinner: out.setWinner, matchWinner: out.matchWinner, clock: expireClock(clock, now, false), entry };
}

/** 골든골 서브 결정 쓰기: 서브를 정하고 골든 포인트 단계로 */
export function planGoldenCoinToss(
  match: Pick<Match, 'currentSet' | 'sets' | 'currentServe' | 'serveCount' | 'scoreHistory' | 'clock'>,
  server: Side,
  opts: { time: string; label: string; serverName: string },
): Record<string, unknown> | null {
  const clock = clockFrom(match.clock);
  if (!clock || clock.goldenGoal !== 'coin_toss') return null;
  const entry = metaEntry({ ...match, serveCount: 0 }, 'coin_toss', opts.label, opts.time, opts.serverName, server);
  return {
    currentServe: server,
    serveCount: 0,
    clock: { ...clock, goldenGoal: 'playing' },
    scoreHistory: [entry, ...(match.scoreHistory ?? [])],
  };
}

/** 세트가 끝나 다음 세트로 갈 때의 시계 쓰기 (시간 제한이 없으면 빈 객체) */
export function nextSetClockPatch(rawClock: unknown, nextSetIndex: number, now: number): Record<string, unknown> {
  const clock = clockFrom(rawClock);
  if (!clock) return {};
  return { clock: clockForNextSet(clock, nextSetIndex, now), goldenGoalActive: null };
}

/** 세트 전환을 되돌려 앞 세트로 돌아갈 때의 시계 쓰기 (시간 제한이 없으면 빈 객체) */
export function undoneSetClockPatch(rawClock: unknown, prevSetIndex: number): Record<string, unknown> {
  const clock = clockFrom(rawClock);
  if (!clock) return {};
  return { clock: clockForUndoneSet(clock, prevSetIndex) };
}

/**
 * 시간 만료로 세트(경기)가 정해졌는데 아직 세트 종료를 확인하지 않은 상태인가 (개인전).
 * 확인 창은 기기의 화면 상태라 새로고침·다른 기기에서는 사라진다. DB 상태(만료된 시계 + 맨 위 기록이 시간 만료 +
 * 골든골 아님)로 다시 알아내 확인 창을 연다. 확인하면 다음 세트 시작 기록이 맨 위에 오거나 경기가 끝나 풀린다.
 */
export function pendingTimeExpirySetEnd(
  match: Pick<Match, 'status' | 'currentSet' | 'sets' | 'scoreHistory' | 'clock'> | null | undefined,
  rules: ScoringRuleSet,
): { setIndex: number; set: SetScore; setWinner: 1 | 2 | null; matchWinner: 1 | 2 | null } | null {
  if (!match || match.status !== 'in_progress') return null;
  const clock = clockFrom(match.clock);
  if (!clock?.expired || clock.goldenGoal) return null;
  if (match.scoreHistory?.[0]?.actionType !== 'time_expired') return null;
  const ci = match.currentSet ?? 0;
  const sets = match.sets ?? [];
  const cs = sets[ci];
  if (!cs) return null;
  return { setIndex: ci, set: cs, setWinner: setWinnerOf(cs, rules), matchWinner: matchWinnerByRules(sets, rules) };
}

/** 골든골 단계인가 (동전 던지기 또는 골든 포인트 진행) */
export function goldenPhaseOf(rawClock: unknown): 'coin_toss' | 'playing' | null {
  return clockFrom(rawClock)?.goldenGoal ?? null;
}
