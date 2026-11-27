import { describe, it, expect } from 'vitest';
import type { ScoreHistoryEntry, SetScore } from '@shared/types';
import type { ScoringRuleSet } from '@shared/rules/competitionRules';
import { firstServerOfSet, setEndOutcome, undoSetTransition } from './teamScoringModel';

const set = (a: number, b: number, winnerId: string | null = null): SetScore => ({
  player1Score: a, player2Score: b, player1Faults: 0, player2Faults: 0, player1Violations: 0, player2Violations: 0, winnerId,
});
const entry = (p: Partial<ScoreHistoryEntry>): ScoreHistoryEntry => ({
  time: '10:00', scoringPlayer: '', actionPlayer: '', actionType: 'goal', actionLabel: '', points: 0,
  set: 1, server: '', serveNumber: 1, scoreBefore: { player1: 0, player2: 0 }, scoreAfter: { player1: 0, player2: 0 }, ...p,
});

describe('setEndOutcome: best-of-3 must not end after set 1 (team and individual hooks)', () => {
  const rules: ScoringRuleSet = { winScore: 21, setsToWin: 2, maxSets: 3, minLead: 2 };
  const opts = { sideIds: ['T1', 'T2'] as [string, string], serverName: (s: 'player1' | 'player2') => (s === 'player1' ? 'Team 1' : 'Team 2'), time: '10:00', sideChangeLabel: 'side change' };
  // 1세트 첫 서버: team1 (경기 시작 기록)
  const match = { scoreHistory: [entry({ set: 1, serverSide: 'player2' }), entry({ set: 1, actionType: 'match_start', serverSide: 'player1' })] };

  it('no set winner yet → null', () => {
    expect(setEndOutcome(match, [set(20, 19)], 0, rules, opts)).toBe(null);
    expect(setEndOutcome(match, [set(21, 20)], 0, rules, opts)).toBe(null); // 2점 차 필요
  });
  it('after set 1 a new set is pushed, the other team serves first, and the match stays open', () => {
    const r = setEndOutcome(match, [set(21, 15)], 0, rules, opts);
    expect(r?.kind).toBe('next_set');
    if (r?.kind !== 'next_set') return;
    expect(r.setWinner).toBe(1);
    expect(r.sets).toHaveLength(2);
    expect(r.sets[0].winnerId).toBe('T1');
    expect(r.sets[1]).toMatchObject({ player1Score: 0, player2Score: 0 });
    expect(r.currentSet).toBe(1);
    expect(r.currentServe).toBe('player2');
    expect(r.serveCount).toBe(0);
    expect(r.sideChangeUsed).toBe(false);
    expect(r.wins).toEqual({ player1: 1, player2: 0 });
    expect(r.setStartEntry).toMatchObject({ actionType: 'side_change', set: 2, serverSide: 'player2', server: 'Team 2', serveNumber: 1 });
  });
  it('the second set win completes the match with the right winner', () => {
    const r = setEndOutcome(match, [set(15, 21, 'T2'), set(19, 21)], 1, rules, opts);
    expect(r).toMatchObject({ kind: 'completed', setWinner: 2, winnerId: 'T2', wins: { player1: 0, player2: 2 } });
  });
  it('1:1 goes to a third set; set 3 first server is the opposite of set 2 first server', () => {
    const h = [entry({ set: 2, actionType: 'side_change', serverSide: 'player2' }), ...match.scoreHistory];
    const r = setEndOutcome({ scoreHistory: h }, [set(21, 15, 'T1'), set(18, 21)], 1, rules, opts);
    expect(r).toMatchObject({ kind: 'next_set', currentSet: 2, currentServe: 'player1', wins: { player1: 1, player2: 1 } });
  });
  it('single-set match (setsToWin 1) completes after set 1', () => {
    const single: ScoringRuleSet = { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2 };
    expect(setEndOutcome(match, [set(31, 25)], 0, single, opts)).toMatchObject({ kind: 'completed', winnerId: 'T1' });
  });
  it('does not mutate the input sets', () => {
    const input = [set(21, 15)];
    setEndOutcome(match, input, 0, rules, opts);
    expect(input).toHaveLength(1);
    expect(input[0].winnerId).toBe(null);
  });
});

describe('firstServerOfSet', () => {
  it('reads the oldest server marker of the set from history (newest first)', () => {
    const history = [
      entry({ set: 2, serverSide: 'player1' }),
      entry({ set: 2, actionType: 'side_change', serverSide: 'player2' }),
      entry({ set: 1, serverSide: 'player2' }),
      entry({ set: 1, actionType: 'match_start', serverSide: 'player1' }),
    ];
    expect(firstServerOfSet({ scoreHistory: history }, 0)).toBe('player1');
    expect(firstServerOfSet({ scoreHistory: history }, 1)).toBe('player2');
  });
  it('falls back to the coin toss and alternates per set', () => {
    expect(firstServerOfSet({ coinTossWinner: 'team2', coinTossChoice: 'serve' }, 0)).toBe('player2');
    expect(firstServerOfSet({ coinTossWinner: 'team2', coinTossChoice: 'serve' }, 1)).toBe('player1');
    expect(firstServerOfSet({ coinTossWinner: 'team1', coinTossChoice: 'receive' }, 0)).toBe('player2');
  });
});

describe('undoSetTransition', () => {
  const history = [
    entry({ set: 2, actionType: 'side_change', serverSide: 'player2' }),
    entry({ set: 1, actionType: 'player_rotation', serverSide: 'player2' }),
    entry({ set: 1, actionType: 'goal', points: 2, serverSide: 'player1', serveNumber: 3, scoreBefore: { player1: 19, player2: 10 }, scoreAfter: { player1: 21, player2: 10 } }),
    entry({ set: 1, actionType: 'goal', points: 2 }),
  ];
  it('removes the new set and restores the winning point of the previous set', () => {
    const r = undoSetTransition([set(21, 10, 't1'), set(0, 0)], 1, history)!;
    expect(r.update.sets).toEqual([set(19, 10, null)]);
    expect(r.update.currentSet).toBe(0);
    expect(r.update.currentServe).toBe('player1');
    expect(r.update.serveCount).toBe(2);
    expect(r.update.scoreHistory).toHaveLength(1);
    expect(r.score).toEqual({ player1: 19, player2: 10 });
  });
  it('is not a transition once the new set has points', () => {
    expect(undoSetTransition([set(21, 10, 't1'), set(2, 0)], 1, history)).toBe(null);
    expect(undoSetTransition([set(5, 3)], 0, history)).toBe(null);
  });
});
