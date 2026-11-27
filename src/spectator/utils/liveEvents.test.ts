import { describe, it, expect } from 'vitest';
import type { Match } from '@shared/types';
import { DEFAULT_INDIVIDUAL_SCORING } from '@shared/rules/competitionRules';
import { tFor, RAW_KEY } from '@shared/i18n/testing';
import { detectLiveEvents, describeLiveEvent } from './liveEvents';

const ko = tFor('ko');
const en = tFor('en');
const scoring = () => DEFAULT_INDIVIDUAL_SCORING;
const base = {
  id: 'm1', type: 'individual', status: 'in_progress', player1Id: 'p1', player1Name: '김철수', player2Id: 'p2', player2Name: '이영희', courtName: '1번 코트',
} as unknown as Match;
const withSets = (sets: Array<[number, number]>, extra: Partial<Match> = {}): Match =>
  ({ ...base, sets: sets.map(([a, b]) => ({ player1Score: a, player2Score: b })), ...extra } as Match);

describe('detectLiveEvents: only meaningful events are announced (never per point)', () => {
  it('an ordinary point that ends neither a set nor the match produces no event', () => {
    expect(detectLiveEvents([withSets([[3, 2]])], [withSets([[4, 2]])], scoring)).toEqual([]);
    expect(detectLiveEvents([withSets([[11, 9], [5, 5]])], [withSets([[11, 9], [6, 5]])], scoring)).toEqual([]);
    // 10:10 → 11:10은 2점 차가 아니라 세트가 끝나지 않는다
    expect(detectLiveEvents([withSets([[10, 10]])], [withSets([[11, 10]])], scoring)).toEqual([]);
  });

  it('first load (no previous snapshot) produces no event', () => {
    expect(detectLiveEvents([], [withSets([[11, 9]], { status: 'completed', winnerId: 'p1' })], scoring)).toEqual([]);
  });

  it('set end produces exactly one natural sentence (no score symbols like 11-9)', () => {
    const ev = detectLiveEvents([withSets([[10, 9]])], [withSets([[11, 9], [0, 0]])], scoring);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'set_end', setNumber: 1, winner: 1, score1: 11, score2: 9 });
    const s = describeLiveEvent(ev[0], ko);
    expect(s).toBe('1번 코트, 김철수 대 이영희, 1세트 끝. 김철수 승리, 11 대 9');
    expect(s).not.toMatch(/\d\s*[-:]\s*\d/);
    expect(describeLiveEvent(ev[0], en)).not.toMatch(RAW_KEY);
  });

  it('match end produces exactly one sentence (not an extra set_end)', () => {
    const ev = detectLiveEvents([withSets([[11, 9], [10, 10]])], [withSets([[11, 9], [12, 10]], { status: 'completed', winnerId: 'p1' })], scoring);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'match_end', winner: 1, sets1: 2, sets2: 0 });
    expect(describeLiveEvent(ev[0], ko)).toContain('김철수 승리, 세트 2 대 0');
    expect(describeLiveEvent(ev[0], en)).toBe('1번 코트: 김철수 vs 이영희, match over. 김철수 wins, sets 2 to 0');
    const noWinner = detectLiveEvents([withSets([[5, 5]])], [withSets([[5, 5]], { status: 'completed' })], scoring);
    expect(describeLiveEvent(noWinner[0], ko)).toBe('1번 코트, 김철수 대 이영희, 경기 끝');
  });

  it('golden goal is announced once, and not for clocked matches (the clock display announces it)', () => {
    const ev = detectLiveEvents([withSets([[5, 5]])], [withSets([[5, 5]], { goldenGoalActive: true })], scoring);
    expect(ev.map(e => e.kind)).toEqual(['golden_goal']);
    expect(describeLiveEvent(ev[0], ko)).toContain('골든골');
    expect(describeLiveEvent(ev[0], en)).not.toMatch(RAW_KEY);
    // 이미 골든골이면 다시 알리지 않는다
    expect(detectLiveEvents([withSets([[5, 5]], { goldenGoalActive: true })], [withSets([[6, 5]], { goldenGoalActive: true })], scoring)).toEqual([]);
    const clock = { durationMs: 1, startedAt: 0 } as unknown as Match['clock'];
    expect(detectLiveEvents([withSets([[5, 5]], { clock })], [withSets([[5, 5]], { clock, goldenGoalActive: true })], scoring)).toEqual([]);
  });
});
