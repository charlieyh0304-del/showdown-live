/**
 * 심판 화면의 순수 로직 (M0g): 여러 세트 진행(setsToWin > 1)과 세트 전환 되돌리기.
 * 단체전·개인전 심판 훅이 같이 쓴다. Firebase·React에 의존하지 않아 단위 테스트한다.
 */
import type { Match, ScoreHistoryEntry, SetScore } from '@shared/types';
import { matchWinnerByRules, setWinnerByRules, setWinsByRules, type ScoringRuleSet } from '@shared/rules/competitionRules';
import { createEmptySet } from '@shared/utils/scoring';

type Side = 'player1' | 'player2';

const other = (s: Side): Side => (s === 'player1' ? 'player2' : 'player1');

/**
 * 세트(0부터)의 첫 서버. 기록(scoreHistory, 최신순)에서 그 세트의 가장 오래된 서버 표시를 쓰고,
 * 없으면 코인 토스 결과로 정한 1세트 첫 서버에서 세트마다 번갈아 정한다.
 */
export function firstServerOfSet(
  match: Pick<Match, 'scoreHistory' | 'coinTossWinner' | 'coinTossChoice'>,
  setIndex: number,
): Side {
  const history = match.scoreHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.set === setIndex + 1 && (h.serverSide === 'player1' || h.serverSide === 'player2')) return h.serverSide;
  }
  let first: Side = 'player1';
  if (match.coinTossWinner && match.coinTossChoice) {
    const winner: Side = match.coinTossWinner === 'team1' || match.coinTossWinner === 'player1' ? 'player1' : 'player2';
    first = match.coinTossChoice === 'serve' ? winner : other(winner);
  }
  return setIndex % 2 === 0 ? first : other(first);
}

export interface SetTransitionUndo {
  update: {
    sets: SetScore[];
    currentSet: number;
    currentServe: Side;
    serveCount: number;
    sideChangeUsed: boolean;
    scoreHistory: ScoreHistoryEntry[];
  };
  /** 되돌린 뒤 이전 세트 점수 (안내용) */
  score: { player1: number; player2: number };
}

/**
 * 세트가 끝나 다음 세트로 넘어간 직후(새 세트 0:0, 최신 기록이 세트 시작)의 되돌리기.
 * 새 세트를 지우고, 이전 세트를 끝낸 마지막 득점까지 되돌린다(서브도 그 득점 전으로).
 * 해당하지 않으면 null (일반 되돌리기).
 * 세트 중 사이드 체인지는 결정 세트에서만 하므로, 다음 세트가 있었던 세트는 사이드 체인지 전 상태다.
 */
export function undoSetTransition(
  sets: readonly SetScore[],
  currentSet: number,
  history: readonly ScoreHistoryEntry[],
): SetTransitionUndo | null {
  if (currentSet <= 0 || history.length === 0) return null;
  const head = history[0];
  const cur = sets[currentSet];
  if (head.actionType !== 'side_change' || head.set !== currentSet + 1) return null;
  if (!cur || cur.player1Score !== 0 || cur.player2Score !== 0) return null;
  let k = 1;
  while (k < history.length && history[k].actionType === 'player_rotation') k++;
  const scoring = history[k];
  if (!scoring || scoring.set !== currentSet) return null;
  const prevSets = sets.slice(0, currentSet).map(s => ({ ...s }));
  const prev = prevSets[currentSet - 1];
  const score = { player1: scoring.scoreBefore.player1, player2: scoring.scoreBefore.player2 };
  prevSets[currentSet - 1] = { ...prev, player1Score: score.player1, player2Score: score.player2, winnerId: null };
  const serverSide: Side = scoring.serverSide === 'player2' ? 'player2' : 'player1';
  return {
    update: {
      sets: prevSets,
      currentSet: currentSet - 1,
      currentServe: serverSide,
      serveCount: Math.max(0, (scoring.serveNumber ?? 1) - 1),
      sideChangeUsed: false,
      scoreHistory: history.slice(k + 1),
    },
    score,
  };
}

export type SetEndOutcome =
  /** 이 세트로 경기가 끝났다 */
  | { kind: 'completed'; setWinner: 1 | 2; winnerId: string; sets: SetScore[]; wins: { player1: number; player2: number } }
  /** 경기가 아직 안 끝났다: 다음 세트(0:0)를 붙이고 코트를 바꾼다 */
  | {
    kind: 'next_set';
    setWinner: 1 | 2;
    sets: SetScore[];
    currentSet: number;
    /** 다음 세트 첫 서버 = 이전 세트 첫 서버의 반대 (IBSA) */
    currentServe: Side;
    serveCount: 0;
    sideChangeUsed: false;
    wins: { player1: number; player2: number };
    /** 세트 시작(코트 체인지) 기록 — 다음 세트 번호, 첫 서버 표시 */
    setStartEntry: ScoreHistoryEntry;
  };

/**
 * 세트(ci, 0부터)가 끝났을 때의 다음 상태. 그 세트에 승자가 없으면 null.
 * setsToWin > 1이면 matchWinnerByRules가 정할 때까지 다음 세트로 넘어간다(1세트로 끝내지 않는다).
 * match.scoreHistory는 이 세트까지의 기록(세트 시작 기록을 붙이기 전)이다.
 */
export function setEndOutcome(
  match: Pick<Match, 'scoreHistory' | 'coinTossWinner' | 'coinTossChoice'>,
  sets: readonly SetScore[],
  ci: number,
  rules: ScoringRuleSet,
  opts: { sideIds: [string, string]; serverName: (side: Side) => string; time: string; sideChangeLabel: string },
): SetEndOutcome | null {
  const cs = sets[ci];
  if (!cs) return null;
  const setWinner = setWinnerByRules(cs.player1Score, cs.player2Score, rules);
  if (!setWinner) return null;
  const next = sets.map(s => ({ ...s }));
  next[ci] = { ...cs, winnerId: opts.sideIds[setWinner - 1] };
  const matchWinner = matchWinnerByRules(next, rules);
  if (matchWinner) {
    return { kind: 'completed', setWinner, winnerId: opts.sideIds[matchWinner - 1], sets: next, wins: setWinsByRules(next, rules) };
  }
  const wins = setWinsByRules(next, rules);
  const nextFirst = other(firstServerOfSet(match, ci));
  next.push(createEmptySet());
  return {
    kind: 'next_set',
    setWinner,
    sets: next,
    currentSet: ci + 1,
    currentServe: nextFirst,
    serveCount: 0,
    sideChangeUsed: false,
    wins,
    setStartEntry: {
      time: opts.time,
      set: ci + 2,
      scoringPlayer: '',
      actionPlayer: '',
      actionType: 'side_change',
      actionLabel: opts.sideChangeLabel,
      points: 0,
      scoreBefore: { player1: 0, player2: 0 },
      scoreAfter: { player1: 0, player2: 0 },
      server: opts.serverName(nextFirst),
      serveNumber: 1,
      serverSide: nextFirst,
    },
  };
}
