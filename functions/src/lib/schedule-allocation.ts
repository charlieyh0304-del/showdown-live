/**
 * 스케줄 슬롯 할당 (handlers/schedule.ts generate_schedule).
 *
 * 로직은 대회 규칙 단일 설정원의 shared/rules/scheduling.ts에 있다(클라이언트 ScheduleTab과 같은 함수).
 * - 선수 휴식: 앞 경기 종료(시작 + 경기 시간) → 다음 경기 시작, 최소값은 그 경기 스테이지의
 *   resolveCompetitionRules(t, stageId).schedule.minRestMinutes(기본 30분). 단체전은 팀원 전원에 적용.
 * - 대진 선후관계: sourceMatch1/2 원천 경기 종료 + 최소 휴식 이후에 시작, 원천 경기를 먼저 배정.
 * 여기서는 DB에서 읽은 원시 경기 목록을 배정 입력으로 바꾸기만 한다.
 */
import {
  allocateMatches,
  nextScheduleDate,
  toAllocMatch,
  toFixedMatches,
  type AllocCourt,
  type AllocResult,
  type AllocSettings,
  type AllocSlot,
} from "../shared/rules/scheduling";
import type { TournamentLike } from "../shared/rules/competitionRules";

export type ScheduleCourt = AllocCourt;
export type ScheduleSettings = AllocSettings;
export type ScheduleSlot = AllocSlot;
export type AllocationResult = AllocResult;
export type RawMatch = Record<string, unknown> & { id: string };

/** 다음 사용 가능 날짜 — scheduleDates에 다음 항목이 있으면 사용, 없으면 +1일 */
export const getNextScheduleDate = nextScheduleDate;

export interface AllocateOptions {
  /** 이번 배정에만 쓰는 최소 휴식(분). 없으면 경기 스테이지의 대회 규칙 값 */
  minRestOverride?: number | null;
  /** 배정하지 않는 경기까지 포함한 전체 경기 (이미 일정이 있는 경기를 고정 점유로 본다) */
  allMatches?: readonly RawMatch[];
}

/**
 * 원시 경기 목록 → 슬롯.
 * targets는 이번에 배정할 경기(입력 순서 유지, 원천 경기는 먼저 오도록 정렬된다).
 */
export function allocateSchedule(
  targets: readonly RawMatch[],
  courts: readonly ScheduleCourt[],
  settings: ScheduleSettings,
  tournament: TournamentLike | null | undefined,
  opts: AllocateOptions = {},
): AllocationResult {
  const targetIds = new Set(targets.map(m => m.id));
  const fixed = toFixedMatches(opts.allMatches ?? [], targetIds);
  return allocateMatches(targets.map(m => toAllocMatch(m, tournament, opts.minRestOverride)), courts, settings, fixed);
}
