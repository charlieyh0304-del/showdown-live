import { describe, it, expect, vi } from 'vitest';
import {
  stripUndefined,
  monotonicUpdatedAt,
  toSafeKey,
  CLEARED_SCHEDULE_FIELDS,
  buildManualScheduleUpdate,
  buildTeamsBulkData,
  matchStageKey,
  buildMatchesBulkUpdate,
  scheduleSlotKey,
  buildScheduleBulkData,
  writeOrQueue,
  isRetryableWriteError,
  replaceStagesFor,
  scheduleKeepMatchIds,
  combineWriteResults,
  notifyWriteOutcome,
  notifyTournamentWrite,
} from './dataWrites';
import { onToast, type ToastEvent } from './toast';
import type { Match, MatchStatus, ScheduleSlot, Team } from '../types';

// ---- RTDB 동작을 흉내 내는 최소 헬퍼 ----

/** update(): 각 키에 값을 쓰고, null이면 해당 키를 삭제한다. */
function applyUpdate<T>(node: Record<string, T>, updates: Record<string, unknown>): Record<string, T> {
  const next: Record<string, T> = { ...node };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete next[key];
    else next[key] = value as T;
  }
  return next;
}

const t = (key: string) => key;

function makeMatch(overrides: Partial<Match> = {}): Omit<Match, 'id'> {
  return {
    tournamentId: 't1',
    type: 'individual',
    status: 'pending',
    round: 1,
    createdAt: 1,
    ...overrides,
  };
}

function slot(matchId: string, overrides: Partial<ScheduleSlot> = {}): Omit<ScheduleSlot, 'id'> {
  return {
    matchId,
    courtId: 'c1',
    courtName: 'Court 1',
    scheduledTime: '09:00',
    scheduledDate: '2026-11-27',
    label: `${matchId} label`,
    status: 'pending',
    ...overrides,
  };
}

function captureToasts() {
  const events: ToastEvent[] = [];
  const unsub = onToast(e => events.push(e));
  return { events, unsub };
}

// ---- 1. 필드 지우기 (undefined vs null) ----

describe('schedule reset clears fields', () => {
  it('CLEARED_SCHEDULE_FIELDS sends null for every schedule field', () => {
    expect(CLEARED_SCHEDULE_FIELDS).toEqual({
      scheduledDate: null, scheduledTime: null, courtId: null, courtName: null,
    });
  });

  it('null survives payload cleaning and deletes the fields on the match', () => {
    const stored = { status: 'pending', scheduledDate: '2026-11-27', scheduledTime: '09:00', courtId: 'c1', courtName: 'Court 1' };
    const payload = stripUndefined({ ...CLEARED_SCHEDULE_FIELDS, updatedAt: 5 });
    const after = applyUpdate<unknown>(stored, payload);
    expect(after).toEqual({ status: 'pending', updatedAt: 5 });
  });

  it('regression: undefined is stripped and would leave the old values in place', () => {
    const stored = { scheduledDate: '2026-11-27', courtId: 'c1' };
    const payload = stripUndefined({ scheduledDate: undefined, courtId: undefined });
    expect(payload).toEqual({});
    expect(applyUpdate<unknown>(stored, payload)).toEqual(stored);
  });

  it('manual edit with emptied fields clears them, filled fields are kept', () => {
    expect(buildManualScheduleUpdate({ scheduledDate: '', scheduledTime: '10:30', courtId: '', courtName: '' })).toEqual({
      scheduledDate: null, scheduledTime: '10:30', courtId: null, courtName: null,
    });
  });
});

// ---- 2. 팀 ----

describe('buildTeamsBulkData', () => {
  const teams: Team[] = [
    { id: 'a', name: 'A', memberIds: ['p1'] },
    { id: 'b', name: 'B', memberIds: ['p2'] },
    { id: 'c', name: 'C', memberIds: ['p3'] },
  ];

  it('deleting a team removes it from the written node', () => {
    const written = buildTeamsBulkData(teams.filter(tm => tm.id !== 'b'));
    expect(Object.keys(written).sort()).toEqual(['a', 'c']);
    expect(written.b).toBeUndefined();
  });

  it('writes exactly the given set (no stale keys)', () => {
    const written = buildTeamsBulkData([teams[0]]);
    expect(Object.keys(written)).toEqual(['a']);
  });

  it('drops undefined nested fields so set() does not reject the write', () => {
    const written = buildTeamsBulkData([{ ...teams[0], coachName: undefined, genderRatio: undefined }]);
    expect('coachName' in written.a).toBe(false);
    expect('genderRatio' in written.a).toBe(false);
  });
});

// ---- 3. 스케줄 ----

describe('buildScheduleBulkData', () => {
  const matchIds = ['m1', 'm2', 'm3'];

  it('regenerating the schedule twice keeps slot count == match count', () => {
    let db = buildScheduleBulkData(null, matchIds.map(id => slot(id)));
    expect(Object.keys(db)).toHaveLength(3);
    db = buildScheduleBulkData(db, matchIds.map(id => slot(id, { scheduledTime: '10:00' })), []);
    expect(Object.keys(db)).toHaveLength(3);
    expect(Object.values(db).every(s => s.scheduledTime === '10:00')).toBe(true);
  });

  it('"only unassigned" mode keeps existing slots and adds new ones without duplicates', () => {
    const first = buildScheduleBulkData(null, [slot('m1'), slot('m2')]);
    // m1, m2 already scheduled; m3 newly assigned. Keep all existing matches' slots.
    const second = buildScheduleBulkData(first, [slot('m3')], matchIds);
    expect(Object.keys(second).sort()).toEqual(['m1', 'm2', 'm3']);
    // Running it again for m3 still yields one slot per match
    const third = buildScheduleBulkData(second, [slot('m3', { scheduledTime: '11:00' })], matchIds);
    expect(Object.keys(third)).toHaveLength(3);
    expect(third.m3.scheduledTime).toBe('11:00');
  });

  it('keeps slots of completed matches that were not regenerated, drops others', () => {
    const existing = buildScheduleBulkData(null, [slot('done', { status: 'completed' }), slot('m1'), slot('deleted')]);
    const next = buildScheduleBulkData(existing, [slot('m1', { scheduledTime: '12:00' })], ['done']);
    expect(Object.keys(next).sort()).toEqual(['done', 'm1']);
    expect(next.done.status).toBe('completed');
  });

  it('collapses legacy duplicate slots (push-keyed) into one per match', () => {
    const legacy = {
      '-Nabc1': slot('m1'),
      '-Nabc2': slot('m1', { scheduledTime: '13:00' }),
      '-Nabc3': slot('m2'),
    };
    const next = buildScheduleBulkData(legacy, [], ['m1', 'm2']);
    expect(Object.keys(next).sort()).toEqual(['m1', 'm2']);
  });

  it('reset (no slots, nothing kept) empties the schedule', () => {
    const existing = buildScheduleBulkData(null, [slot('m1')]);
    expect(buildScheduleBulkData(existing, [], [])).toEqual({});
  });

  describe('scheduleKeepMatchIds (caller scope)', () => {
    const matches: Array<{ id: string; status: MatchStatus }> = [
      { id: 'done', status: 'completed' },
      { id: 'm1', status: 'pending' },
      { id: 'm2', status: 'pending' },
    ];

    it('full regeneration: a moved pending match keeps exactly one slot and the old slot is gone', () => {
      const existing = buildScheduleBulkData(null, [
        slot('done', { status: 'completed', scheduledTime: '08:00' }),
        slot('m1', { scheduledTime: '09:00', courtId: 'c1' }),
        slot('m2', { scheduledTime: '09:30' }),
      ]);
      const keep = scheduleKeepMatchIds(matches, false);
      expect(keep).toEqual(['done']);
      // m1 moves to 14:00 on court 2; m2 is not re-placed this time
      const next = buildScheduleBulkData(existing, [slot('m1', { scheduledTime: '14:00', courtId: 'c2' })], keep);
      expect(Object.values(next).filter(s => s.matchId === 'm1')).toHaveLength(1);
      expect(next.m1).toMatchObject({ scheduledTime: '14:00', courtId: 'c2' });
      expect(next.m2).toBeUndefined();
      expect(next.done.scheduledTime).toBe('08:00');
      expect(Object.keys(next).sort()).toEqual(['done', 'm1']);
    });

    it('only-unassigned mode keeps every existing match slot', () => {
      expect(scheduleKeepMatchIds(matches, true)).toEqual(['done', 'm1', 'm2']);
      const existing = buildScheduleBulkData(null, [slot('done'), slot('m1')]);
      const next = buildScheduleBulkData(existing, [slot('m2')], scheduleKeepMatchIds(matches, true));
      expect(Object.keys(next).sort()).toEqual(['done', 'm1', 'm2']);
    });
  });

  it('keys are deterministic and RTDB-safe', () => {
    expect(scheduleSlotKey('-NabcXYZ')).toBe('-NabcXYZ');
    expect(toSafeKey('a.b#c$d[e]f/g')).toBe('a_b_c_d_e_f_g');
  });
});

// ---- 4. 경기 일괄 생성 (스테이지 범위 교체) ----

describe('buildMatchesBulkUpdate', () => {
  const existing: Record<string, Partial<Match>> = {
    q_pending: makeMatch({ stageId: 'qualifying', groupId: 'A' }),
    q_done: makeMatch({ stageId: 'qualifying', status: 'completed' }),
    q_live: makeMatch({ stageId: 'qualifying', status: 'in_progress' }),
    f_pending: makeMatch({ stageId: 'finals' }),
    league_pending: makeMatch({}),
  };

  it('creating finals slots keeps pending qualifying matches', () => {
    const newFinals = [0, 1].map(i => ({ key: `new_f${i}`, match: makeMatch({ stageId: 'finals2', bracketPosition: i }) }));
    const updates = buildMatchesBulkUpdate(existing, newFinals, ['finals2']);
    const after = applyUpdate(existing, updates);
    expect(after.q_pending).toBeDefined();
    expect(after.league_pending).toBeDefined();
    expect(after.f_pending).toBeDefined();
    expect(after.new_f0).toBeDefined();
    expect(after.new_f1).toBeDefined();
  });

  it('regenerating a stage replaces only that stage\'s pending matches', () => {
    const updates = buildMatchesBulkUpdate(existing, [{ key: 'new_q', match: makeMatch({ stageId: 'qualifying' }) }], ['qualifying']);
    const after = applyUpdate(existing, updates);
    expect(after.q_pending).toBeUndefined();
    expect(after.new_q).toBeDefined();
    // never deleted: other stages and non-pending matches
    expect(after.f_pending).toBeDefined();
    expect(after.league_pending).toBeDefined();
    expect(after.q_done).toBeDefined();
    expect(after.q_live).toBeDefined();
  });

  it('non-pending matches are never written (no rewrite, no delete)', () => {
    const updates = buildMatchesBulkUpdate(existing, [], 'all');
    expect(Object.keys(updates).sort()).toEqual(['f_pending', 'league_pending', 'q_pending']);
    expect('q_done' in updates).toBe(false);
    expect('q_live' in updates).toBe(false);
  });

  it("'' scope targets only matches without stageId", () => {
    const updates = buildMatchesBulkUpdate(existing, [], ['']);
    expect(updates).toEqual({ league_pending: null });
    expect(matchStageKey({})).toBe('');
    expect(matchStageKey({ stageId: 'x' })).toBe('x');
  });

  describe('replaceStagesFor (caller scope)', () => {
    it('a finals batch derives only the finals stage and keeps pending qualifying/league matches', () => {
      const finalsBatch = [0, 1].map(i => makeMatch({ stageId: 'finals', bracketPosition: i }));
      const scope = replaceStagesFor(finalsBatch);
      expect(scope).toEqual(['finals']);
      const updates = buildMatchesBulkUpdate(existing, finalsBatch.map((match, i) => ({ key: `nf${i}`, match })), scope);
      const after = applyUpdate(existing, updates);
      expect(after.q_pending).toBeDefined();
      expect(after.league_pending).toBeDefined();
      expect(after.f_pending).toBeUndefined();
      expect(after.nf0).toBeDefined();
      expect(after.nf1).toBeDefined();
    });

    it('a group round-robin batch derives the qualifying stage; matches without stageId map to the empty key', () => {
      expect(replaceStagesFor([makeMatch({ stageId: 'qualifying' }), makeMatch({ stageId: 'qualifying' })])).toEqual(['qualifying']);
      expect(replaceStagesFor([makeMatch({}), makeMatch({ stageId: null as unknown as string })])).toEqual(['']);
      expect(replaceStagesFor([])).toEqual([]);
    });
  });

  it('works with an empty tournament and strips undefined fields from new matches', () => {
    const updates = buildMatchesBulkUpdate(null, [{ key: 'k', match: makeMatch({ courtId: undefined }) }], ['']);
    expect(Object.keys(updates)).toEqual(['k']);
    expect('courtId' in (updates.k as object)).toBe(false);
  });
});

// ---- 5. 쓰기 결과 (큐 vs 실제 저장) ----

describe('writeOrQueue / combineWriteResults', () => {
  it('a queued write is not reported as written', async () => {
    const enqueue = vi.fn();
    const result = await writeOrQueue(async () => { throw new Error('offline'); }, enqueue);
    expect(result).toBe('queued');
    expect(result).not.toBe('written');
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('committed write is written; uncommitted (conflict) is false and not queued', async () => {
    const enqueue = vi.fn();
    expect(await writeOrQueue(async () => true, enqueue)).toBe('written');
    expect(await writeOrQueue(async () => false, enqueue)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('server rejections (permission_denied / .validate, maxretry) are failures and are not queued', async () => {
    const enqueue = vi.fn();
    const denied = Object.assign(new Error('permission_denied at /matches/t1/m1: Client does not have permission to access the desired data.'), { code: 'PERMISSION_DENIED' });
    const maxretry = Object.assign(new Error('maxretry'), { code: 'MAXRETRY' });
    expect(await writeOrQueue(async () => { throw denied; }, enqueue)).toBe(false);
    expect(await writeOrQueue(async () => { throw maxretry; }, enqueue)).toBe(false);
    expect(await writeOrQueue(async () => { throw new Error('something unexpected'); }, enqueue)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('only connection-like errors are retryable', () => {
    expect(isRetryableWriteError(new Error('disconnect'))).toBe(true);
    expect(isRetryableWriteError({ code: 'NETWORK_ERROR' })).toBe(true);
    expect(isRetryableWriteError({ code: 'PERMISSION_DENIED', message: 'permission_denied' })).toBe(false);
    expect(isRetryableWriteError(new Error('Validation failed'))).toBe(false);
    expect(isRetryableWriteError(undefined)).toBe(false);
  });

  it('combines results: failure > queued > written', () => {
    expect(combineWriteResults(['written', 'written'])).toBe('written');
    expect(combineWriteResults(['written', 'queued'])).toBe('queued');
    expect(combineWriteResults(['queued', false])).toBe('failed');
    expect(combineWriteResults([])).toBe('written');
  });
});

describe('notifyWriteOutcome / notifyTournamentWrite', () => {
  it('queued outcome shows a sync warning, not the success message', () => {
    const { events, unsub } = captureToasts();
    notifyWriteOutcome('queued', t, 'saved!');
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'warning', message: 'common.write.queued' });
  });

  it('written outcome shows the success message; failed shows an error', () => {
    const { events, unsub } = captureToasts();
    notifyWriteOutcome('written', t, 'saved!');
    notifyWriteOutcome('written', t);
    notifyWriteOutcome('failed', t, 'saved!');
    unsub();
    expect(events.map(e => [e.type, e.message])).toEqual([
      ['success', 'saved!'],
      ['error', 'common.write.failed'],
    ]);
  });

  it('tournament conflict (false) shows an error and returns false', () => {
    const { events, unsub } = captureToasts();
    expect(notifyTournamentWrite(false, t)).toBe(false);
    expect(notifyTournamentWrite(true, t)).toBe(true);
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', message: 'common.write.tournamentConflict' });
  });
});

describe('monotonicUpdatedAt (M0f: device clock skew must not make the DB rule reject match writes)', () => {
  it('uses now when it is newer, otherwise stored + 1', () => {
    expect(monotonicUpdatedAt(2_000, 1_000)).toBe(2_000);
    expect(monotonicUpdatedAt(1_000, 5_000)).toBe(5_001);
    expect(monotonicUpdatedAt(5_000, 5_000)).toBe(5_001);
    expect(monotonicUpdatedAt(3, undefined)).toBe(3);
  });
});
