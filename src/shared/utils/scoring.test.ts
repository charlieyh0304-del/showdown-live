import { describe, it, expect } from 'vitest';
import { checkSetWinner, DEFAULT_GAME_CONFIG, TEAM_GAME_CONFIG } from './scoring';

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

describe('상수 검증', () => {
  it('DEFAULT_GAME_CONFIG는 11점 2점차 2세트 선승', () => {
    expect(DEFAULT_GAME_CONFIG.POINTS_TO_WIN).toBe(11);
    expect(DEFAULT_GAME_CONFIG.MIN_POINT_DIFF).toBe(2);
    expect(DEFAULT_GAME_CONFIG.SETS_TO_WIN).toBe(2);
  });

  it('TEAM_GAME_CONFIG는 31점 단일 세트', () => {
    expect(TEAM_GAME_CONFIG.POINTS_TO_WIN).toBe(31);
    expect(TEAM_GAME_CONFIG.SETS_TO_WIN).toBe(1);
    expect(TEAM_GAME_CONFIG.MAX_SETS).toBe(1);
  });
});
