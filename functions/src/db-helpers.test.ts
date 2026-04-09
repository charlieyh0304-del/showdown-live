/**
 * Unit tests for pure utility functions in db-helpers.ts
 * Firebase-dependent functions (loadOptional, loadRequired) are intentionally
 * skipped — they require an emulator.
 */
import { describe, it, expect, vi } from 'vitest';

// Prevent firebase-admin from trying to initialize a real app at import time.
vi.mock('firebase-admin', () => ({
  database: () => ({ ref: () => ({ once: async () => ({ exists: () => false, val: () => null }) }) }),
}));

import {
  addDays,
  asString,
  asNumber,
  asBoolean,
  getStageCategory,
  getMatchPlayers,
  getMatchWinnerLoser,
  hashPinSHA256,
  hashPinPBKDF2,
} from './db-helpers';

describe('addDays', () => {
  it('crosses month boundary', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
  });
  it('crosses year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('adds zero days', () => {
    expect(addDays('2026-04-09', 0)).toBe('2026-04-09');
  });
});

describe('asString', () => {
  it('returns fallback for undefined', () => {
    expect(asString(undefined)).toBe('');
  });
  it('returns string value', () => {
    expect(asString('hi')).toBe('hi');
  });
  it('returns custom fallback for null', () => {
    expect(asString(null, 'fb')).toBe('fb');
  });
  it('returns fallback for number', () => {
    expect(asString(42, 'fb')).toBe('fb');
  });
});

describe('asNumber', () => {
  it('returns 0 for NaN', () => {
    expect(asNumber(NaN)).toBe(0);
  });
  it('returns 0 for numeric string (not a real number)', () => {
    expect(asNumber('42')).toBe(0);
  });
  it('returns number value', () => {
    expect(asNumber(42)).toBe(42);
  });
  it('respects custom fallback', () => {
    expect(asNumber(undefined, 99)).toBe(99);
  });
});

describe('asBoolean', () => {
  it('returns false for string "true" (not a real bool)', () => {
    expect(asBoolean('true')).toBe(false);
  });
  it('returns true for true', () => {
    expect(asBoolean(true)).toBe(true);
  });
  it('returns false for false', () => {
    expect(asBoolean(false)).toBe(false);
  });
});

describe('getStageCategory', () => {
  it('detects finals', () => {
    expect(getStageCategory({ stageId: 'stage_finals_x' })).toBe('finals');
  });
  it('detects ranking via class token', () => {
    expect(getStageCategory({ stageId: 'stage_finals_x_class_5to8' })).toBe('ranking');
  });
  it('detects qualifying', () => {
    expect(getStageCategory({ stageId: 'stage_qualifying_x' })).toBe('qualifying');
  });
  it('returns unknown for empty input (no stageId, no bracketRound)', () => {
    expect(getStageCategory({})).toBe('unknown');
  });
  it('returns unknown when stageId is unrecognized and bracketRound is set', () => {
    expect(getStageCategory({ stageId: 'stage_weird', bracketRound: 'R1' })).toBe('unknown');
  });
  it('returns qualifying when stageId is unrecognized but bracketRound is empty', () => {
    expect(getStageCategory({ stageId: 'stage_weird' })).toBe('qualifying');
  });
});

describe('getMatchPlayers', () => {
  it('handles individual shape', () => {
    const r = getMatchPlayers({
      player1Id: 'p1',
      player2Id: 'p2',
      player1Name: 'Alice',
      player2Name: 'Bob',
    });
    expect(r).toEqual({ p1Id: 'p1', p2Id: 'p2', p1Name: 'Alice', p2Name: 'Bob' });
  });
  it('handles team shape', () => {
    const r = getMatchPlayers({
      team1Id: 't1',
      team2Id: 't2',
      team1Name: 'Red',
      team2Name: 'Blue',
    });
    expect(r).toEqual({ p1Id: 't1', p2Id: 't2', p1Name: 'Red', p2Name: 'Blue' });
  });
});

describe('getMatchWinnerLoser', () => {
  const match = {
    player1Id: 'p1',
    player2Id: 'p2',
    player1Name: 'Alice',
    player2Name: 'Bob',
  };
  it('returns p1 as winner when winnerId === player1Id', () => {
    expect(getMatchWinnerLoser({ ...match, winnerId: 'p1' })).toEqual({
      winnerId: 'p1',
      winnerName: 'Alice',
      loserId: 'p2',
      loserName: 'Bob',
    });
  });
  it('returns p2 as winner when winnerId === player2Id', () => {
    expect(getMatchWinnerLoser({ ...match, winnerId: 'p2' })).toEqual({
      winnerId: 'p2',
      winnerName: 'Bob',
      loserId: 'p1',
      loserName: 'Alice',
    });
  });
  it('returns null when no winnerId', () => {
    expect(getMatchWinnerLoser(match)).toBeNull();
  });
});

describe('hashPinSHA256', () => {
  it('produces known SHA-256 of "1234"', async () => {
    const h = await hashPinSHA256('1234');
    expect(h).toBe('03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
  });
});

describe('hashPinPBKDF2', () => {
  it('returns "salt:hex" format and is deterministic', async () => {
    const a = await hashPinPBKDF2('1234', 'abcd');
    const b = await hashPinPBKDF2('1234', 'abcd');
    expect(a).toBe(b);
    expect(a.startsWith('abcd:')).toBe(true);
    expect(a).toBe('abcd:588ac30a53ebfa1e367bdd9a017ef3a83539ba77292cec6925ab8e816711953c');
  });
});
