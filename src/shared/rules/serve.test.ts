import { describe, it, expect } from 'vitest';
import { resolveMatchScoring, type ScoringRuleSet } from './competitionRules';
import {
  advanceServeTurn,
  defaultServeRotation,
  isDecidingSet,
  isValidServeRotation,
  nextRotationToken,
  revertServeTurn,
  serveRotationOf,
  servesPerTurnOf,
  shouldChangeSidesMidSet,
  sideChangePointOf,
} from './serve';

const ind: ScoringRuleSet = { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2 };
const set = (a: number, b: number) => ({ player1Score: a, player2Score: b });

describe('servesPerTurn', () => {
  it('defaults: individual 2, team 3', () => {
    expect(servesPerTurnOf(ind, 'individual')).toBe(2);
    expect(servesPerTurnOf(ind, 'team')).toBe(3);
  });
  it('team event with 21 points and 2 serves (owner requirement) via tournament rules', () => {
    const tour = { type: 'team', rules: { scoring: { team: { winScore: 21, servesPerTurn: 2 } } } };
    const r = resolveMatchScoring({ type: 'team' }, tour);
    expect(r.winScore).toBe(21);
    expect(servesPerTurnOf(r, 'team')).toBe(2);
    expect(sideChangePointOf(r)).toBe(11);
  });
  it('advance / revert follow the configured count', () => {
    expect(advanceServeTurn('player1', 0, 2)).toEqual({ currentServe: 'player1', serveCount: 1, turnChanged: false });
    expect(advanceServeTurn('player1', 1, 2)).toEqual({ currentServe: 'player2', serveCount: 0, turnChanged: true });
    expect(advanceServeTurn('player1', 1, 3)).toEqual({ currentServe: 'player1', serveCount: 2, turnChanged: false });
    expect(revertServeTurn('player2', 0, 3)).toEqual({ currentServe: 'player1', serveCount: 2 });
  });
});

describe('side change', () => {
  it('default point is ceil(winScore / 2): 11→6, 21→11, 31→16', () => {
    expect(sideChangePointOf(ind)).toBe(6);
    expect(sideChangePointOf({ ...ind, winScore: 21 })).toBe(11);
    expect(sideChangePointOf({ ...ind, winScore: 31 })).toBe(16);
    expect(sideChangePointOf({ ...ind, sideChangeAt: 8 })).toBe(8);
  });
  it('a stage can reset a tournament side change point to automatic with 0', () => {
    const tour = { rules: { scoring: { individual: { sideChangeAt: 8 } } }, stages: [{ id: 'f', rules: { scoring: { individual: { sideChangeAt: 0 } } } }] };
    expect(sideChangePointOf(resolveMatchScoring({ type: 'individual' }, tour))).toBe(8);
    expect(sideChangePointOf(resolveMatchScoring({ type: 'individual', stageId: 'f' }, tour))).toBe(6);
  });
  it('a layer that changes the target score drops an inherited side change point (falls back to half)', () => {
    const tour = { rules: { scoring: { team: { winScore: 21, sideChangeAt: 11 } } }, stages: [{ id: 'f', rules: { scoring: { team: { winScore: 31 } } } }, { id: 'g', rules: { scoring: { team: { winScore: 11, sideChangeAt: 5 } } } }, { id: 'h', rules: { scoring: { team: { setsToWin: 2 } } } }] };
    expect(sideChangePointOf(resolveMatchScoring({ type: 'team' }, tour))).toBe(11);
    expect(sideChangePointOf(resolveMatchScoring({ type: 'team', stageId: 'f' }, tour))).toBe(16);
    expect(sideChangePointOf(resolveMatchScoring({ type: 'team', stageId: 'g' }, tour))).toBe(5);
    // 목표 점수를 바꾸지 않는 층은 그대로 상속
    expect(sideChangePointOf(resolveMatchScoring({ type: 'team', stageId: 'h' }, tour))).toBe(11);
    // 라운드별 규칙에서 목표 점수를 바꿔도 같다 (16 상속 → 11점 경기에서 영영 안 바뀌는 문제)
    const t2 = { rules: { scoring: { individual: { winScore: 31, sideChangeAt: 16 } }, roundScoring: { fromRound: 4, individual: { winScore: 11 } } }, stages: [{ id: 'fin', type: 'finals' }] };
    expect(sideChangePointOf(resolveMatchScoring({ type: 'individual', stageId: 'fin', roundLabel: '4강' }, t2))).toBe(6);
  });
  it('only in the deciding set (single-set matches always)', () => {
    expect(isDecidingSet([], ind)).toBe(false);
    expect(isDecidingSet([set(11, 5), set(5, 11)], ind)).toBe(true);
    expect(isDecidingSet([], { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2 })).toBe(true);
    expect(shouldChangeSidesMidSet(set(6, 2), [], ind, false)).toBe(false);
    expect(shouldChangeSidesMidSet(set(6, 2), [set(11, 5), set(5, 11)], ind, false)).toBe(true);
    expect(shouldChangeSidesMidSet(set(6, 2), [set(11, 5), set(5, 11)], ind, true)).toBe(false);
    const team3: ScoringRuleSet = { winScore: 21, setsToWin: 2, maxSets: 3, minLead: 2 };
    // 단체 3세트제: 1세트에는 세트 중 사이드 체인지 없음(세트 뒤에 바꿈)
    expect(shouldChangeSidesMidSet(set(11, 3), [], team3, false)).toBe(false);
    expect(shouldChangeSidesMidSet(set(11, 3), [set(21, 3), set(3, 21)], team3, false)).toBe(true);
  });
});

describe('team serve rotation', () => {
  it('default rotation from players on court', () => {
    expect(defaultServeRotation(3)).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(serveRotationOf({})).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(serveRotationOf({ playersOnCourt: 2 })).toEqual(['A1', 'B1', 'A2', 'B2']);
  });
  it('custom rotation is used when valid, otherwise the default', () => {
    expect(serveRotationOf({ serveRotation: ['A1', 'B2', 'A2', 'B1'], playersOnCourt: 2 })).toEqual(['A1', 'B2', 'A2', 'B1']);
    expect(serveRotationOf({ serveRotation: ['A1', 'A2'], playersOnCourt: 2 })).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect(isValidServeRotation(['A1', 'B4'], 3)).toBe(false);
    expect(isValidServeRotation(['A1', 'B1', 'A2'], 3)).toBe(false); // 마지막→처음이 같은 팀
  });
  it('next token follows the list and wraps around', () => {
    const rot = defaultServeRotation(3);
    expect(nextRotationToken(rot, { team: 'A', player: 1 })).toEqual({ team: 'B', player: 1 });
    expect(nextRotationToken(rot, { team: 'B', player: 1 })).toEqual({ team: 'A', player: 2 });
    expect(nextRotationToken(rot, { team: 'B', player: 3 })).toEqual({ team: 'A', player: 1 });
  });
});
