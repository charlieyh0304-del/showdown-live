/**
 * 싱글 엘리미네이션 본선 대진의 전체 골격(1라운드 ~ 결승 + 선택적 3/4위전)을 만든다 (M0e).
 *
 * - 2라운드 이후 경기는 sourceMatch1/sourceMatch2(sourceType 'winner')로 이전 라운드 두 경기를 가리킨다.
 * - 3/4위전은 4강 두 경기를 sourceType 'loser'로 가리킨다.
 * - 5~8위 결정전(fifthToEighth)은 8강 경기를 sourceType 'loser'로 가리킨다 (서버 finals-plan과 같은 구조·라벨).
 * - 서버 트리거(functions advanceOnMatchResult)가 이 링크를 읽어 승자/패자를 자동으로 채운다.
 * - 1라운드 배치(시드)는 호출부가 정한다. 표준 시드 배치는 shared/rules/seeding.ts의 placeSeeds를 쓴다(M0c).
 * - BYE 경기는 isBye + walkoverReason 'bye'로 쓰고(구 필드 bye는 쓰지 않음), 실제 선수 쪽 부전승 점수는
 *   호출부가 대회 규칙으로 만든 byeSets(기본 11:0 × 이겨야 하는 세트 수)를 기록한다.
 * - 미정 슬롯은 빈 ID + labels.undecided(현지화된 '미정')이다. 화면은 빈 ID 쪽을 미정 스타일로 그린다.
 *
 * roundLabel/bracketRound는 화면 문구가 아니라 저장 데이터다. 서버(getRoundName)와
 * 관전/관리자 대진표가 라운드 정렬·분류에 쓰는 표준 값("8강", "4강", "결승", "3/4위 결정전")을 그대로 쓴다.
 * ("결정전"이 들어간 roundLabel은 관전/현황 화면에서 순위결정전으로 분류된다.)
 */
import type { Match, MatchType, SetScore } from '../types';
import type { FifthToEighthFormat } from '../rules/competitionRules';
import { BYE_WALKOVER_REASON } from '../rules/walkover';
import { createEmptySet } from './scoring';

export interface SkeletonEntrant {
  id: string;
  name: string;
}

/** 1라운드 슬롯: 참가자, null(BYE), undefined(미정 — 관리자가 나중에 배정) */
export type FirstRoundSlot = SkeletonEntrant | null | undefined;

export interface SkeletonEntry {
  key: string;
  match: Omit<Match, 'id'>;
}

export interface SkeletonOptions {
  tournamentId: string;
  stageId: string;
  matchType: MatchType;
  /** 길이 = 2의 거듭제곱(대진 크기). [2k], [2k+1]이 1라운드 k번째 경기 */
  slots: FirstRoundSlot[];
  thirdPlace: boolean;
  /** 5~8위 결정전 방식 (대회 규칙 finalRanking.fifthToEighthMatches). 없으면 'none'. 8강이 있을 때만 만든다. */
  fifthToEighth?: FifthToEighthFormat;
  makeKey: () => string;
  now: number;
  labels: { undecided: string; bye: string };
  /** BYE 경기에서 실제 선수가 받는 부전승 세트. 없으면 점수 없이 완료한다. */
  byeSets?: (winnerSide: 1 | 2, winnerId: string) => SetScore[];
}

/** 표준 라운드 이름 (서버 functions/src/lib/finals-plan.ts roundName과 같은 값: 결승, N강) */
export function roundLabelFor(participants: number): string {
  return participants === 2 ? '결승' : `${participants}강`;
}

export const THIRD_PLACE_ROUND_LABEL = '3/4위 결정전';

export function thirdPlaceStageId(finalsStageId: string): string {
  return `${finalsStageId}_3rd`;
}

/** 5~8위 결정전 경기 수 (대진 크기 8 이상일 때만 생긴다): simple 2, full 4, round_robin 6 */
export function fifthToEighthMatchCount(format: FifthToEighthFormat, bracketSize: number): number {
  if (bracketSize < 8) return 0;
  return format === 'simple' ? 2 : format === 'full' ? 4 : format === 'round_robin' ? 6 : 0;
}

/** 5~8위 결정전 스테이지 ID (서버 finals-plan과 같은 값) */
export function fifthToEighthStageId(finalsStageId: string): string {
  return `${finalsStageId}_5to8`;
}

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * 참가자 수로 1라운드 슬롯을 만든다. 대진 크기 B = N 이상인 최소 2의 거듭제곱.
 * 앞쪽 N - B/2 경기는 실제 경기, 나머지 B - N 경기는 BYE 경기다.
 * entrants를 주면 순서대로 [0,1], [2,3] ... 실제 경기에 넣고, 남은 참가자를 BYE 경기에 넣는다.
 */
export function buildFirstRoundSlots(entrantCount: number, entrants?: readonly SkeletonEntrant[]): FirstRoundSlot[] {
  const n = Math.max(2, entrantCount);
  const size = nextPowerOfTwo(n);
  const half = size / 2;
  const realMatches = n - half;
  const slots: FirstRoundSlot[] = [];
  for (let k = 0; k < half; k++) {
    if (k < realMatches) {
      slots.push(entrants?.[2 * k], entrants?.[2 * k + 1]);
    } else {
      slots.push(entrants?.[realMatches * 2 + (k - realMatches)], null);
    }
  }
  return slots;
}

function sideFields(side: 1 | 2, matchType: MatchType, id: string, name: string): Partial<Match> {
  const player = side === 1 ? { player1Id: id, player1Name: name } : { player2Id: id, player2Name: name };
  if (matchType !== 'team') return player;
  const team = side === 1 ? { team1Id: id, team1Name: name } : { team2Id: id, team2Name: name };
  return { ...player, ...team };
}

export function buildSingleEliminationSkeleton(opts: SkeletonOptions): SkeletonEntry[] {
  const { tournamentId, stageId, matchType, slots, thirdPlace, fifthToEighth = 'none', makeKey, now, labels, byeSets } = opts;
  const size = nextPowerOfTwo(Math.max(2, slots.length));
  const totalRounds = Math.log2(size);
  const entries: SkeletonEntry[] = [];

  const base = (round: number, bracketPosition: number, label: string): Omit<Match, 'id'> => ({
    tournamentId,
    type: matchType,
    status: 'pending',
    round,
    bracketPosition,
    roundLabel: label,
    bracketRound: label as Match['bracketRound'],
    stageId,
    player1Id: '',
    player2Id: '',
    player1Name: labels.undecided,
    player2Name: labels.undecided,
    ...(matchType === 'team' ? { team1Id: '', team2Id: '', team1Name: labels.undecided, team2Name: labels.undecided } : {}),
    sets: [createEmptySet()],
    currentSet: 0,
    player1Timeouts: 0,
    player2Timeouts: 0,
    winnerId: null,
    createdAt: now + entries.length,
  });

  // 1라운드
  let prevKeys: string[] = [];
  const firstLabel = roundLabelFor(size);
  for (let k = 0; k < size / 2; k++) {
    const s1 = slots[2 * k];
    const s2 = slots[2 * k + 1];
    const match = base(1, k, firstLabel);
    if (s1) Object.assign(match, sideFields(1, matchType, s1.id, s1.name));
    if (s2) Object.assign(match, sideFields(2, matchType, s2.id, s2.name));
    if (s1 === null || s2 === null) {
      // BYE 경기: 실제 선수 쪽이 자동 진출. BYE 쪽 ID는 빈 값으로 둬서 통계에 가짜 선수가 생기지 않게 한다.
      if (s1 === null) Object.assign(match, sideFields(1, matchType, '', labels.bye));
      if (s2 === null) Object.assign(match, sideFields(2, matchType, '', labels.bye));
      match.isBye = true;
      const realSide = s1 || s2;
      if (realSide) {
        match.status = 'completed';
        match.winnerId = realSide.id;
        match.walkover = true;
        match.walkoverReason = BYE_WALKOVER_REASON;
        match.sets = byeSets ? byeSets(s1 ? 1 : 2, realSide.id) : [];
      }
    }
    const key = makeKey();
    entries.push({ key, match });
    prevKeys.push(key);
  }

  // 2라운드 ~ 결승
  let semifinalKeys: string[] = size === 4 ? [...prevKeys] : [];
  let quarterKeys: string[] = size === 8 ? [...prevKeys] : [];
  for (let round = 2; round <= totalRounds; round++) {
    const participants = size / Math.pow(2, round - 1);
    const label = roundLabelFor(participants);
    const keys: string[] = [];
    for (let k = 0; k < prevKeys.length / 2; k++) {
      const match = base(round, k, label);
      match.sourceMatch1 = prevKeys[2 * k];
      match.sourceMatch2 = prevKeys[2 * k + 1];
      match.sourceType = 'winner';
      const key = makeKey();
      entries.push({ key, match });
      keys.push(key);
    }
    if (participants === 4) semifinalKeys = [...keys];
    if (participants === 8) quarterKeys = [...keys];
    prevKeys = keys;
  }

  // 3/4위전: 4강 두 경기의 패자
  if (thirdPlace && semifinalKeys.length === 2) {
    const match = base(totalRounds + 1, 0, THIRD_PLACE_ROUND_LABEL);
    match.stageId = thirdPlaceStageId(stageId);
    delete match.bracketRound; // BracketRound 타입은 본선 라운드만 표현한다
    match.sourceMatch1 = semifinalKeys[0];
    match.sourceMatch2 = semifinalKeys[1];
    match.sourceType = 'loser';
    entries.push({ key: makeKey(), match });
  }

  // 5~8위 결정전: 8강 네 경기의 패자 (서버 finals-plan과 같은 방식·라벨)
  if (fifthToEighth !== 'none' && quarterKeys.length === 4) {
    const placement = (round: number, pos: number, label: string, s1: string, s2: string, type: 'winner' | 'loser'): string => {
      const match = base(round, pos, label);
      match.stageId = fifthToEighthStageId(stageId);
      delete match.bracketRound; // BracketRound 타입은 본선 라운드만 표현한다
      match.sourceMatch1 = s1;
      match.sourceMatch2 = s2;
      match.sourceType = type;
      const key = makeKey();
      entries.push({ key, match });
      return key;
    };
    if (fifthToEighth === 'round_robin') {
      let n = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) placement(totalRounds + 1, n++, '5~8위 순위 결정전', quarterKeys[i], quarterKeys[j], 'loser');
      }
    } else {
      const c1 = placement(totalRounds + 1, 0, '5-8위 결정전', quarterKeys[0], quarterKeys[1], 'loser');
      const c2 = placement(totalRounds + 1, 1, '5-8위 결정전', quarterKeys[2], quarterKeys[3], 'loser');
      if (fifthToEighth === 'full') {
        placement(totalRounds + 2, 0, '5/6위 결정전', c1, c2, 'winner');
        placement(totalRounds + 2, 1, '7/8위 결정전', c1, c2, 'loser');
      }
    }
  }

  return entries;
}

/** 실제 참가자 ID가 아닌 값(빈 값, 서버 BYE 표기) */
function isUndecidedId(id: string | undefined): boolean {
  return !id || id === 'BYE';
}

/**
 * 한쪽이라도 참가자가 정해지지 않은 경기인가 (앞 경기 결과 대기, 미배정 슬롯, BYE).
 * 심판이 이런 경기를 시작하지 못하게 할 때 쓴다.
 */
export function hasUndecidedParticipant(match: Pick<Match, 'player1Id' | 'player2Id' | 'team1Id' | 'team2Id'>): boolean {
  return isUndecidedId(match.player1Id || match.team1Id) || isUndecidedId(match.player2Id || match.team2Id);
}
