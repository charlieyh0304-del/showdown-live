/**
 * Firebase RTDB 쓰기 데이터를 만드는 순수 함수 모음.
 * Firebase 없이 테스트할 수 있도록 useFirebase.ts의 bulk 쓰기 로직을 분리했다.
 *
 * 규칙 요약
 * - undefined: "건드리지 않음". Firebase는 undefined를 거부하므로 쓰기 전에 제거한다.
 * - null: "필드 삭제". RTDB는 null을 받으면 해당 경로를 지운다.
 */
import type { Match, MatchUpdate, ScheduleSlot, Team } from '../types';
import { showError, showSuccess, showWarning } from './toast';

// ===== 공통 =====

/** undefined 값을 가진 최상위 키를 제거한다. null은 삭제 표시이므로 유지한다. */
export function stripUndefined<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

/** 중첩 객체까지 undefined를 제거한 사본 (set()으로 노드 전체를 쓸 때 사용). */
export function toFirebaseValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** RTDB 키에 쓸 수 없는 문자(. # $ [ ] /)를 치환한다. */
export function toSafeKey(raw: string): string {
  return raw.replace(/[.#$[\]/]/g, '_');
}

// ===== 경기 필드 지우기 =====

/** 스케줄 초기화: 경기의 일정/경기장 필드를 삭제한다. */
export const CLEARED_SCHEDULE_FIELDS = {
  scheduledDate: null,
  scheduledTime: null,
  courtId: null,
  courtName: null,
} as const satisfies MatchUpdate;

/** 수동 일정 편집 값을 경기 업데이트로 변환한다. 빈 값은 해당 필드를 삭제한다. */
export function buildManualScheduleUpdate(edit: {
  scheduledDate: string;
  scheduledTime: string;
  courtId: string;
  courtName: string;
}): MatchUpdate {
  return {
    scheduledDate: edit.scheduledDate || null,
    scheduledTime: edit.scheduledTime || null,
    courtId: edit.courtId || null,
    courtName: edit.courtName || null,
  };
}

// ===== 팀 =====

/** 주어진 팀 집합만 정확히 담은 teams/{tid} 노드 값을 만든다 (삭제된 팀은 포함되지 않음). */
export function buildTeamsBulkData(teams: Team[]): Record<string, Team> {
  const bulkData: Record<string, Team> = {};
  for (const team of teams) {
    bulkData[toSafeKey(team.id)] = toFirebaseValue(team);
  }
  return bulkData;
}

// ===== 경기 일괄 생성 =====

/** 경기의 스테이지 키. stageId가 없는 경기(풀리그 등)는 ''로 묶는다. */
export function matchStageKey(match: { stageId?: string | null }): string {
  return match.stageId || '';
}

/**
 * 재생성 시 대기(pending) 경기를 교체할 스테이지 범위.
 * - string[]: 해당 stageId(''는 stageId 없는 경기)의 pending 경기만 교체
 * - 'all': 모든 스테이지의 pending 경기를 교체 (시뮬레이션의 전체 데이터 재생성 전용)
 */
export type StageReplaceScope = readonly string[] | 'all';

/**
 * setMatchesBulk용 multi-path update(matches/{tid} 기준 상대 경로)를 만든다.
 * - 새 경기를 newKey 위치에 추가한다.
 * - 범위에 속한 기존 pending 경기만 null로 삭제한다.
 * - 진행 중/완료 경기와 범위 밖 스테이지의 경기는 절대 건드리지 않는다.
 */
export function buildMatchesBulkUpdate(
  existing: Record<string, Partial<Match>> | null,
  newMatches: Array<{ key: string; match: Omit<Match, 'id'> }>,
  scope: StageReplaceScope,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (existing) {
    const stages = scope === 'all' ? null : new Set(scope);
    for (const [key, match] of Object.entries(existing)) {
      if (!match || match.status !== 'pending') continue;
      if (stages && !stages.has(matchStageKey(match))) continue;
      updates[key] = null;
    }
  }
  for (const { key, match } of newMatches) {
    updates[key] = toFirebaseValue(match);
  }
  return updates;
}

/**
 * 새로 만드는 경기들이 속한 스테이지만 교체 범위로 삼는다 (stageId 없는 경기는 '').
 * 예: 본선 슬롯 생성이면 본선 스테이지만, 조별 예선 생성이면 예선 스테이지만 교체된다.
 */
export function replaceStagesFor(newMatches: ReadonlyArray<{ stageId?: string | null }>): string[] {
  return [...new Set(newMatches.map(matchStageKey))];
}

// ===== 스케줄 =====

/** 스케줄 슬롯의 결정적 키 (matchId 기준). */
export function scheduleSlotKey(matchId: string): string {
  return toSafeKey(matchId);
}

/**
 * schedule/{tid} 노드 전체 값을 만든다. 슬롯은 matchId를 키로 하므로 같은 경기의 슬롯은 하나뿐이다.
 * - slots: 새로 쓸 슬롯 (같은 matchId가 여러 번 오면 마지막 것이 남음)
 * - keepMatchIds: 새 슬롯에 없더라도 기존 슬롯을 유지할 경기 ID (예: 완료된 경기)
 * 그 외의 기존 슬롯은 모두 제거된다 (재생성 시 누적 방지).
 */
export function buildScheduleBulkData(
  existing: Record<string, Omit<ScheduleSlot, 'id'>> | null,
  slots: Omit<ScheduleSlot, 'id'>[],
  keepMatchIds: Iterable<string> = [],
): Record<string, Omit<ScheduleSlot, 'id'>> {
  const bulkData: Record<string, Omit<ScheduleSlot, 'id'>> = {};
  const keep = new Set(keepMatchIds);
  if (existing && keep.size > 0) {
    for (const slot of Object.values(existing)) {
      if (slot?.matchId && keep.has(slot.matchId)) {
        bulkData[scheduleSlotKey(slot.matchId)] = toFirebaseValue(slot);
      }
    }
  }
  slots.forEach((slot, idx) => {
    const key = slot.matchId ? scheduleSlotKey(slot.matchId) : `unassigned_${idx}`;
    bulkData[key] = toFirebaseValue(slot);
  });
  return bulkData;
}

/**
 * 스케줄 자동 배정 시 기존 슬롯을 유지할 경기 ID.
 * - 미배정만 배정: 모든 기존 경기의 슬롯을 유지 (새로 배정한 경기는 새 슬롯이 덮어씀)
 * - 전체 재배정: 완료된 경기의 슬롯만 유지. 대기 경기는 새 슬롯으로만 남아 옛 슬롯이 사라진다.
 */
export function scheduleKeepMatchIds(
  matches: ReadonlyArray<{ id: string; status: Match['status'] }>,
  onlyUnassigned: boolean,
): string[] {
  return (onlyUnassigned ? matches : matches.filter(m => m.status === 'completed')).map(m => m.id);
}

// ===== 쓰기 결과 =====

/**
 * 쓰기 결과.
 * - 'written': 서버에 반영됨
 * - 'queued': 서버 반영이 확인되지 않아 기기의 재시도 큐에 저장됨 (서버 반영을 보장하지 않음)
 * - false: 실패, 충돌 또는 서버 거부
 */
export type WriteResult = 'written' | 'queued' | false;
export type WriteOutcome = 'written' | 'queued' | 'failed';

/** Firebase 오류의 code/message를 소문자 문자열로 모은다. */
function errorText(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err ?? '').toLowerCase();
  const { code, message } = err as { code?: unknown; message?: unknown };
  return `${String(code ?? '')} ${String(message ?? '')}`.toLowerCase();
}

/**
 * 다시 보내면 성공할 수 있는(연결 문제로 보이는) 쓰기 오류인지 판단한다.
 * RTDB 트랜잭션은 오프라인이어도 reject하지 않고 연결을 기다리므로, 예외는 대부분
 * 서버 거부(permission_denied: 보안 규칙/.validate 실패 포함), maxretry, 잘못된 데이터이다.
 * 이런 오류는 재전송해도 다시 실패하므로 큐에 넣지 않는다.
 */
export function isRetryableWriteError(err: unknown): boolean {
  const text = errorText(err);
  if (/permission_denied|permission denied|maxretry|validat|invalid|undefined/.test(text)) return false;
  return /disconnect|network|offline|unavailable|timeout|timed out|connection/.test(text);
}

/**
 * 서버 쓰기를 시도한다.
 * - 성공: 'written', 커밋되지 않음(충돌): false
 * - 연결 문제로 보이는 예외: 재시도 큐에 넣고 'queued' (written으로 보고하지 않음)
 * - 서버 거부 등 그 밖의 예외: 큐에 넣지 않고 false
 */
export async function writeOrQueue(
  attempt: () => Promise<boolean>,
  enqueue: () => void,
  shouldQueue: (err: unknown) => boolean = isRetryableWriteError,
): Promise<WriteResult> {
  try {
    return (await attempt()) ? 'written' : false;
  } catch (err) {
    if (!shouldQueue(err)) {
      console.warn('[dataWrites] write rejected, not queued:', err);
      return false;
    }
    enqueue();
    return 'queued';
  }
}

/** 여러 쓰기 결과를 하나로 요약한다. 하나라도 실패면 'failed', 하나라도 큐면 'queued'. */
export function combineWriteResults(results: ReadonlyArray<WriteResult | boolean | void>): WriteOutcome {
  if (results.some(r => r === false)) return 'failed';
  if (results.some(r => r === 'queued')) return 'queued';
  return 'written';
}

/**
 * 쓰기 결과를 토스트로 알린다.
 * - written: successMessage가 있으면 성공 알림
 * - queued: "서버 반영 미확인, 기기에 임시 저장" 경고
 * - failed: 오류 알림
 */
export function notifyWriteOutcome(
  outcome: WriteOutcome,
  t: (key: string) => string,
  successMessage?: string,
): WriteOutcome {
  if (outcome === 'failed') showError(t('common.write.failed'));
  else if (outcome === 'queued') showWarning(t('common.write.queued'));
  else if (successMessage) showSuccess(successMessage);
  return outcome;
}

/** updateTournament가 false(충돌/실패)를 반환하면 충돌 알림을 띄운다. 성공 여부를 반환한다. */
export function notifyTournamentWrite(
  result: boolean | void,
  t: (key: string) => string,
): boolean {
  if (result === false) {
    showError(t('common.write.tournamentConflict'));
    return false;
  }
  return true;
}
