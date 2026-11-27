import { describe, it, expect } from 'vitest';
import {
  checkSetWinner,
  checkMatchWinner,
  matchSetWins,
  getEffectiveTimeLimitSeconds,
  getPenaltyAction,
  computePenaltyCounts,
} from './scoring';
import type { ScoreHistoryEntry } from '../types';

describe('checkSetWinner', () => {
  describe('개인전 (11점, 2점차)', () => {
    it('11-9: 1번 승', () => {
      expect(checkSetWinner(11, 9)).toBe(1);
    });

    it('9-11: 2번 승', () => {
      expect(checkSetWinner(9, 11)).toBe(2);
    });

    it('11-10: 1점차로 승자 없음 (듀스)', () => {
      expect(checkSetWinner(11, 10)).toBe(null);
    });

    it('12-10: 듀스 후 2점차로 1번 승', () => {
      expect(checkSetWinner(12, 10)).toBe(1);
    });

    it('15-13: 긴 듀스 끝에 1번 승', () => {
      expect(checkSetWinner(15, 13)).toBe(1);
    });

    it('11-0: 11-0 싱글 스코어 1번 승', () => {
      expect(checkSetWinner(11, 0)).toBe(1);
    });

    it('10-10: 양측 모두 winScore 미달 → 무승부', () => {
      expect(checkSetWinner(10, 10)).toBe(null);
    });

    it('0-0: 시작 상태 → 승자 없음', () => {
      expect(checkSetWinner(0, 0)).toBe(null);
    });

    it('5-3: 양측 모두 winScore 미달', () => {
      expect(checkSetWinner(5, 3)).toBe(null);
    });
  });

  describe('팀전 (31점, 2점차)', () => {
    const teamConfig = {
      SETS_TO_WIN: 1,
      MAX_SETS: 1,
      POINTS_TO_WIN: 31,
      MIN_POINT_DIFF: 2,
    };

    it('31-29: 1번 승', () => {
      expect(checkSetWinner(31, 29, teamConfig)).toBe(1);
    });

    it('31-30: 1점차 승자 없음', () => {
      expect(checkSetWinner(31, 30, teamConfig)).toBe(null);
    });

    it('33-31: 듀스 끝에 1번 승', () => {
      expect(checkSetWinner(33, 31, teamConfig)).toBe(1);
    });

    it('30-30: winScore 미달 무승부', () => {
      expect(checkSetWinner(30, 30, teamConfig)).toBe(null);
    });
  });

  describe('듀스 캡 (deuceCap)', () => {
    it('20-19 (캡 20): 1점차여도 1번 승', () => {
      expect(checkSetWinner(20, 19, undefined, 20)).toBe(1);
    });

    it('19-20 (캡 20): 1점차여도 2번 승', () => {
      expect(checkSetWinner(19, 20, undefined, 20)).toBe(2);
    });

    it('20-20 (캡 20): 동점 무승부', () => {
      expect(checkSetWinner(20, 20, undefined, 20)).toBe(null);
    });

    it('19-19 (캡 20 미달): 캡 적용 안 됨', () => {
      expect(checkSetWinner(19, 19, undefined, 20)).toBe(null);
    });
  });
});

describe('practice adapter delegates to the rules module', () => {
  it('checkMatchWinner needs more set wins than the opponent', () => {
    const sets = [{ player1Score: 11, player2Score: 5 }, { player1Score: 5, player2Score: 11 }].map(x => ({ ...x, player1Faults: 0, player2Faults: 0, player1Violations: 0, player2Violations: 0, winnerId: null }));
    expect(checkMatchWinner(sets)).toBe(null);
    expect(checkMatchWinner([...sets, { ...sets[0] }])).toBe(1);
  });
});

describe('tournament match helpers read the resolver', () => {
  it('matchSetWins honours the deuce cap of the tournament rules', () => {
    // 15점 캡: 15:14는 1점 차라도 세트 승리
    const tour = { rules: { scoring: { individual: { winScore: 11, setsToWin: 2, deuceCap: 15 } } } };
    const m = { type: 'individual', sets: [{ player1Score: 15, player2Score: 14 }, { player1Score: 11, player2Score: 3 }] };
    expect(matchSetWins(m, tour)).toEqual({ player1: 2, player2: 0 });
    expect(matchSetWins(m, {})).toEqual({ player1: 1, player2: 0 });
  });
  it('matchSetWins uses the team target (31)', () => {
    expect(matchSetWins({ type: 'team', sets: [{ player1Score: 31, player2Score: 20 }] }, {})).toEqual({ player1: 1, player2: 0 });
  });
  it('getEffectiveTimeLimitSeconds comes from resolveMatchScoring and a stage 0 clears it', () => {
    const tour = { scoringRules: { winScore: 11, setsToWin: 2, timeLimitSeconds: 600 }, stages: [{ id: 'f', scoringRules: { winScore: 11, setsToWin: 2, timeLimitSeconds: 0 } }, { id: 'q', rules: { scoring: { individual: { timeLimitSeconds: 300 } } } }] };
    expect(getEffectiveTimeLimitSeconds({ type: 'individual' }, tour)).toBe(600);
    expect(getEffectiveTimeLimitSeconds({ type: 'individual', stageId: 'f' }, tour)).toBe(0);
    expect(getEffectiveTimeLimitSeconds({ type: 'individual', stageId: 'q' }, tour)).toBe(300);
    expect(getEffectiveTimeLimitSeconds({ type: 'individual', appliedScoringRules: { winScore: 11, setsToWin: 2, timeLimitSeconds: 120 } }, tour)).toBe(120);
  });
});

// 시간 제한·골든골 판정 테스트는 src/shared/rules/timeLimit.test.ts (M0f)

describe('getPenaltyAction', () => {
  it('electronic 은 항상 즉시 감점 (2점)', () => {
    expect(getPenaltyAction('penalty_electronic', 0)).toEqual({ isWarning: false, points: 2 });
    expect(getPenaltyAction('penalty_electronic', 1)).toEqual({ isWarning: false, points: 2 });
    expect(getPenaltyAction('penalty_electronic', 5)).toEqual({ isWarning: false, points: 2 });
  });

  it('table_pushing: 경고 → 감점(2) 사이클', () => {
    expect(getPenaltyAction('penalty_table_pushing', 0)).toEqual({ isWarning: true, points: 0 });
    expect(getPenaltyAction('penalty_table_pushing', 1)).toEqual({ isWarning: false, points: 2 });
    expect(getPenaltyAction('penalty_table_pushing', 2)).toEqual({ isWarning: true, points: 0 });
    expect(getPenaltyAction('penalty_table_pushing', 3)).toEqual({ isWarning: false, points: 2 });
  });

  it('talking: 경고 → 감점(1) 사이클', () => {
    expect(getPenaltyAction('penalty_talking', 0)).toEqual({ isWarning: true, points: 0 });
    expect(getPenaltyAction('penalty_talking', 1)).toEqual({ isWarning: false, points: 1 });
    expect(getPenaltyAction('penalty_talking', 2)).toEqual({ isWarning: true, points: 0 });
  });
});

describe('computePenaltyCounts', () => {
  const makeEntry = (actionType: string, actionPlayer: string, penaltyWarning?: boolean): ScoreHistoryEntry => ({
    time: '00:00',
    scoringPlayer: '',
    actionPlayer,
    actionType: actionType as ScoreHistoryEntry['actionType'],
    actionLabel: '',
    points: 0,
    set: 1,
    server: '',
    serveNumber: 1,
    scoreBefore: { player1: 0, player2: 0 },
    scoreAfter: { player1: 0, player2: 0 },
    penaltyWarning,
  });

  it('빈 히스토리 → 0, 0', () => {
    expect(computePenaltyCounts([], 'Player A')).toEqual({ warnings: 0, penalties: 0 });
  });

  it('경고와 감점을 분리', () => {
    const history = [
      makeEntry('penalty_table_pushing', 'A', true),
      makeEntry('penalty_table_pushing', 'A', false),
      makeEntry('penalty_talking', 'A', true),
    ];
    expect(computePenaltyCounts(history, 'A')).toEqual({ warnings: 2, penalties: 1 });
  });

  it('다른 선수 히스토리 무시', () => {
    const history = [
      makeEntry('penalty_table_pushing', 'A', true),
      makeEntry('penalty_table_pushing', 'B', false),
    ];
    expect(computePenaltyCounts(history, 'A')).toEqual({ warnings: 1, penalties: 0 });
  });

  it('penalty가 아닌 actionType 무시', () => {
    const history = [
      makeEntry('goal', 'A', undefined),
      makeEntry('foul', 'A', undefined),
      makeEntry('penalty_electronic', 'A', false),
    ];
    expect(computePenaltyCounts(history, 'A')).toEqual({ warnings: 0, penalties: 1 });
  });
});
