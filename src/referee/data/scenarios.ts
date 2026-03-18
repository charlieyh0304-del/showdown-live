import type { PracticeScenario } from '@shared/types';

export const PRACTICE_SCENARIOS: PracticeScenario[] = [
  {
    id: 'deuce-practice',
    name: '듀스 연습',
    description: '10:10에서 시작하여 듀스 규칙을 올바르게 적용하는 연습',
    category: 'deuce',
    matchType: 'individual',
    difficulty: 'intermediate',
    initialState: {
      sets: [{
        player1Score: 10, player2Score: 10,
        player1Faults: 1, player2Faults: 2,
        player1Violations: 0, player2Violations: 0,
        winnerId: null,
      }],
      currentSet: 0,
    },
    events: [
      { type: 'score', player: 1, description: '선수1이 서브 에이스로 득점', expectedRefereeAction: '선수1 +1점' },
      { type: 'score', player: 2, description: '선수2가 리턴 에이스로 동점', expectedRefereeAction: '선수2 +1점' },
      { type: 'score', player: 1, description: '선수1이 스매시로 득점', expectedRefereeAction: '선수1 +1점' },
      { type: 'score', player: 1, description: '선수1이 서브 에이스 (세트 승리!)', expectedRefereeAction: '선수1 +1점' },
    ],
    expectedActions: [
      { type: 'score', player: 1, detail: '+1' },
      { type: 'score', player: 2, detail: '+1' },
      { type: 'score', player: 1, detail: '+1' },
      { type: 'score', player: 1, detail: '+1' },
    ],
  },
  {
    id: 'fault-recording',
    name: '폴트 기록 연습',
    description: '폴트가 발생했을 때 올바르게 기록하는 연습',
    category: 'fault_heavy',
    matchType: 'individual',
    difficulty: 'beginner',
    initialState: {
      sets: [{
        player1Score: 5, player2Score: 3,
        player1Faults: 0, player2Faults: 0,
        player1Violations: 0, player2Violations: 0,
        winnerId: null,
      }],
      currentSet: 0,
    },
    events: [
      { type: 'fault', player: 1, description: '선수1이 서브 폴트', expectedRefereeAction: '선수1 폴트 기록' },
      { type: 'score', player: 2, description: '선수2 득점', expectedRefereeAction: '선수2 +1점' },
      { type: 'fault', player: 2, description: '선수2가 테이블 밖으로 공을 침', expectedRefereeAction: '선수2 폴트 기록' },
      { type: 'fault', player: 1, description: '선수1이 두 번째 서브 폴트', expectedRefereeAction: '선수1 폴트 기록' },
    ],
    expectedActions: [
      { type: 'fault', player: 1 },
      { type: 'score', player: 2, detail: '+1' },
      { type: 'fault', player: 2 },
      { type: 'fault', player: 1 },
    ],
  },
  {
    id: 'timeout-management',
    name: '타임아웃 관리',
    description: '타임아웃 요청 처리와 60초 카운트다운 관리 연습',
    category: 'timeout',
    matchType: 'individual',
    difficulty: 'beginner',
    initialState: {
      sets: [{
        player1Score: 7, player2Score: 8,
        player1Faults: 0, player2Faults: 0,
        player1Violations: 0, player2Violations: 0,
        winnerId: null,
      }],
      currentSet: 0,
    },
    events: [
      { type: 'score', player: 1, description: '선수1 득점', expectedRefereeAction: '선수1 +1점' },
      { type: 'timeout_request', player: 2, description: '선수2가 타임아웃 요청', expectedRefereeAction: '선수2 타임아웃 시작' },
      { type: 'score', player: 2, description: '타임아웃 후 선수2 득점', expectedRefereeAction: '선수2 +1점' },
    ],
    expectedActions: [
      { type: 'score', player: 1, detail: '+1' },
      { type: 'timeout', player: 2 },
      { type: 'score', player: 2, detail: '+1' },
    ],
  },
  {
    id: 'close-game',
    name: '접전 상황',
    description: '9:9에서 시작하는 박빙의 승부',
    category: 'close_game',
    matchType: 'individual',
    difficulty: 'intermediate',
    initialState: {
      sets: [{
        player1Score: 9, player2Score: 9,
        player1Faults: 2, player2Faults: 1,
        player1Violations: 0, player2Violations: 0,
        winnerId: null,
      }],
      currentSet: 0,
    },
    events: [
      { type: 'score', player: 1, description: '선수1 득점 (10:9)', expectedRefereeAction: '선수1 +1점' },
      { type: 'score', player: 2, description: '선수2 동점 (10:10 듀스)', expectedRefereeAction: '선수2 +1점' },
      { type: 'fault', player: 1, description: '선수1 폴트', expectedRefereeAction: '선수1 폴트 기록' },
      { type: 'score', player: 2, description: '선수2 득점 (11:10)', expectedRefereeAction: '선수2 +1점' },
      { type: 'score', player: 2, description: '선수2 득점 (세트 승리 12:10)', expectedRefereeAction: '선수2 +1점' },
    ],
    expectedActions: [
      { type: 'score', player: 1, detail: '+1' },
      { type: 'score', player: 2, detail: '+1' },
      { type: 'fault', player: 1 },
      { type: 'score', player: 2, detail: '+1' },
      { type: 'score', player: 2, detail: '+1' },
    ],
  },
  {
    id: 'team-deuce',
    name: '팀전 듀스',
    description: '30:30에서 시작하는 팀전 듀스 상황',
    category: 'deuce',
    matchType: 'team',
    difficulty: 'intermediate',
    initialState: {
      sets: [{
        player1Score: 30, player2Score: 30,
        player1Faults: 3, player2Faults: 4,
        player1Violations: 0, player2Violations: 1,
        winnerId: null,
      }],
      currentSet: 0,
    },
    events: [
      { type: 'score', player: 1, description: '팀1 득점 (31:30)', expectedRefereeAction: '팀1 +1점' },
      { type: 'score', player: 2, description: '팀2 동점 (31:31)', expectedRefereeAction: '팀2 +1점' },
      { type: 'score', player: 1, description: '팀1 득점 (32:31)', expectedRefereeAction: '팀1 +1점' },
      { type: 'score', player: 1, description: '팀1 득점 (경기 승리 33:31)', expectedRefereeAction: '팀1 +1점' },
    ],
    expectedActions: [
      { type: 'score', player: 1, detail: '+1' },
      { type: 'score', player: 2, detail: '+1' },
      { type: 'score', player: 1, detail: '+1' },
      { type: 'score', player: 1, detail: '+1' },
    ],
  },
];
