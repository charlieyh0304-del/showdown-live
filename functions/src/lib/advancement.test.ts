import { describe, it, expect } from 'vitest';
import {
  determineResult,
  resolveScoringRules,
  needsAdvancementCheck,
  processMatchWrite,
  sweepAdvancement,
  walkoverSetsForTournament,
  findDownstreamLinks,
  type AdvancementStore,
  type ConflictRecord,
  type MatchData,
} from './advancement';

// ===== 메모리 저장소: 트리거 재호출(재귀)까지 흉내 낸다 =====

interface FakeDb {
  tournament: MatchData | null;
  matches: Record<string, MatchData>;
  conflicts: Record<string, ConflictRecord>;
  /** 트리거 호출 횟수 (재귀 안전 확인용) */
  invocations: number;
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v)) as T;
}

function makeStore(db: FakeDb, cascade: boolean): AdvancementStore {
  const store: AdvancementStore = {
    async getTournament() { return clone(db.tournament); },
    async getMatches() { return clone(db.matches); },
    async transactMatch(matchId, update) {
      // 실제 RTDB처럼 첫 호출은 캐시 없음(null)으로 시작
      if (update(null) !== null) throw new Error('null 첫 호출에 null을 돌려줘야 함');
      const cur = db.matches[matchId] ? clone(db.matches[matchId]) : null;
      const next = update(cur);
      if (next === undefined) return;
      const before = db.matches[matchId] ? clone(db.matches[matchId]) : null;
      if (next === null) delete db.matches[matchId];
      else db.matches[matchId] = clone(next);
      if (cascade) await fire(db, matchId, before, next, cascade);
    },
    async getConflict(did, side) { return clone(db.conflicts[`${did}/player${side}`] ?? null); },
    async setConflict(did, side, record) {
      if (record) db.conflicts[`${did}/player${side}`] = clone(record);
      else delete db.conflicts[`${did}/player${side}`];
    },
  };
  return store;
}

/** 경기 노드 쓰기 + 트리거 호출 */
async function fire(db: FakeDb, matchId: string, before: MatchData | null, after: MatchData | null, cascade = true) {
  db.invocations++;
  return processMatchWrite(makeStore(db, cascade), matchId, clone(before), clone(after), 1000);
}

async function write(db: FakeDb, matchId: string, patch: MatchData | null, cascade = true) {
  const before = db.matches[matchId] ? clone(db.matches[matchId]) : null;
  if (patch === null) delete db.matches[matchId];
  else db.matches[matchId] = { ...(before || {}), ...clone(patch) };
  return fire(db, matchId, before, db.matches[matchId] ?? null, cascade);
}

function pending(extra: MatchData = {}): MatchData {
  return {
    tournamentId: 't', type: 'individual', status: 'pending',
    player1Id: '', player2Id: '', player1Name: '', player2Name: '',
    sets: [{ player1Score: 0, player2Score: 0 }], winnerId: null, ...extra,
  };
}

function real(p1: string, p2: string, extra: MatchData = {}): MatchData {
  return pending({ player1Id: p1, player2Id: p2, player1Name: p1.toUpperCase(), player2Name: p2.toUpperCase(), ...extra });
}

const WIN_P1 = { status: 'completed', sets: [{ player1Score: 11, player2Score: 5 }, { player1Score: 11, player2Score: 7 }] };
function winBy(id: string): MatchData { return { status: 'completed', winnerId: id }; }

/** 4강(sf1, sf2) → 결승(f) + 3/4위전(third) */
function semifinalDb(): FakeDb {
  return {
    tournament: { name: 'T', status: 'in_progress' },
    matches: {
      sf1: real('a', 'b', { round: 1 }),
      sf2: real('c', 'd', { round: 1 }),
      f: pending({ round: 2, sourceMatch1: 'sf1', sourceMatch2: 'sf2', sourceType: 'winner', player1Name: '4강 승자1', player2Name: '4강 승자2' }),
      third: pending({ round: 2, sourceMatch1: 'sf1', sourceMatch2: 'sf2', sourceType: 'loser', player1Name: '4강 패자1', player2Name: '4강 패자2' }),
    },
    conflicts: {},
    invocations: 0,
  };
}

describe('determineResult', () => {
  const rules = { setsToWin: 2, winScore: 11, minLead: 2 };

  it('winnerId가 있으면 그것을 쓴다', () => {
    const r = determineResult({ ...real('a', 'b'), ...winBy('b') }, rules);
    expect(r).toMatchObject({ decided: true, winner: { id: 'b' }, loser: { id: 'a' } });
  });

  it('winnerId가 없으면 세트로 판정한다', () => {
    const r = determineResult({ ...real('a', 'b'), ...WIN_P1 }, rules);
    expect(r).toMatchObject({ decided: true, winner: { id: 'a' }, loser: { id: 'b' } });
  });

  it('미완료·동점 점수에서는 판정하지 않는다', () => {
    expect(determineResult({ ...real('a', 'b'), status: 'completed', sets: [{ player1Score: 11, player2Score: 5 }] }, rules).decided).toBe(false);
    expect(determineResult({ ...real('a', 'b'), status: 'completed', sets: [
      { player1Score: 11, player2Score: 5 }, { player1Score: 5, player2Score: 11 },
    ] }, rules).decided).toBe(false);
    expect(determineResult({ ...real('a', 'b'), status: 'completed', sets: [{ player1Score: 11, player2Score: 10 }, { player1Score: 11, player2Score: 10 }] }, rules).decided).toBe(false);
  });

  it('미완료 경기는 판정하지 않는다', () => {
    expect(determineResult({ ...real('a', 'b'), status: 'in_progress', winnerId: 'a' }, rules).decided).toBe(false);
  });

  it('winnerId가 어느 쪽과도 맞지 않으면 판정하지 않는다', () => {
    expect(determineResult({ ...real('a', 'b'), ...winBy('zzz') }, rules).decided).toBe(false);
  });

  it('BYE 경기: 실제 선수가 승자, 패자는 없음', () => {
    const server = { ...pending(), status: 'completed', isBye: true, player1Id: 'a', player1Name: 'A', player2Id: 'BYE', player2Name: '부전승', winnerId: 'a' };
    expect(determineResult(server, rules)).toEqual({ decided: true, winner: { id: 'a', name: 'A' }, loser: null });
    const client = { ...pending(), status: 'completed', bye: true, player1Id: 'a', player1Name: 'A', player2Id: '' };
    expect(determineResult(client, rules)).toEqual({ decided: true, winner: { id: 'a', name: 'A' }, loser: null });
  });

  it('팀전 31점 단판: winnerId 없이 세트로 판정', () => {
    const tour = { type: 'team' };
    const m: MatchData = {
      tournamentId: 't', type: 'team', status: 'completed',
      team1Id: 'x', team2Id: 'y', team1Name: 'X', team2Name: 'Y',
      sets: [{ player1Score: 29, player2Score: 31 }],
    };
    const r = determineResult(m, resolveScoringRules(m, tour));
    expect(r).toMatchObject({ decided: true, winner: { id: 'y', name: 'Y' }, loser: { id: 'x' } });
    // 31-30은 2점 차가 아니므로 미정
    const m2 = { ...m, sets: [{ player1Score: 31, player2Score: 30 }] };
    expect(determineResult(m2, resolveScoringRules(m2, tour)).decided).toBe(false);
    // 개인전 규칙(11점)으로 잘못 판정하지 않는다: 11-5는 팀전에서 미완료
    const m3 = { ...m, sets: [{ player1Score: 11, player2Score: 5 }] };
    expect(determineResult(m3, resolveScoringRules(m3, tour)).decided).toBe(false);
  });

  it('유효 규칙 우선순위: match > stage > tournament', () => {
    const tour = { scoringRules: { winScore: 21, setsToWin: 1, minLead: 2 }, stages: [{ id: 's1', scoringRules: { winScore: 31, setsToWin: 1, minLead: 2 } }] };
    expect(resolveScoringRules({ type: 'individual' }, tour).winScore).toBe(21);
    expect(resolveScoringRules({ type: 'individual', stageId: 's1' }, tour).winScore).toBe(31);
    expect(resolveScoringRules({ type: 'individual', stageId: 's1', appliedScoringRules: { winScore: 11, setsToWin: 3, minLead: 2 } }, tour).setsToWin).toBe(3);
    expect(resolveScoringRules({ type: 'individual' }, {})).toMatchObject({ setsToWin: 2, winScore: 11, minLead: 2 });
  });
});

describe('needsAdvancementCheck', () => {
  it('진행 중 점수 갱신은 DB를 읽지 않고 걸러낸다', () => {
    expect(needsAdvancementCheck({ status: 'in_progress', sets: [] }, { status: 'in_progress', sets: [{ player1Score: 1 }] })).toBe(false);
    expect(needsAdvancementCheck({ status: 'pending' }, { status: 'pending', player1Id: 'a' })).toBe(false);
  });
  it('완료 전환, 재개, 승자 정정은 처리한다', () => {
    expect(needsAdvancementCheck({ status: 'in_progress' }, { status: 'completed' })).toBe(true);
    expect(needsAdvancementCheck(null, { status: 'completed' })).toBe(true);
    expect(needsAdvancementCheck({ status: 'completed' }, { status: 'in_progress' })).toBe(true);
    expect(needsAdvancementCheck({ status: 'completed', winnerId: 'a' }, { status: 'completed', winnerId: 'b' })).toBe(true);
    expect(needsAdvancementCheck({ status: 'completed', winnerId: 'a' }, { status: 'completed', winnerId: 'a', updatedAt: 5 })).toBe(false);
  });
});

describe('processMatchWrite (트리거)', () => {
  it('승자가 다음 경기의 해당 슬롯을 채우고 출처를 기록한다', async () => {
    const db = semifinalDb();
    await write(db, 'sf1', winBy('a'));
    expect(db.matches.f).toMatchObject({
      player1Id: 'a', player1Name: 'A', team1Id: 'a', team1Name: 'A',
      player1Source: { matchId: 'sf1', outcome: 'winner', id: 'a', name: 'A', prevName: '4강 승자1' },
      player2Id: '', status: 'pending',
    });
    await write(db, 'sf2', winBy('d'));
    expect(db.matches.f).toMatchObject({ player1Id: 'a', player2Id: 'd', player2Name: 'D' });
  });

  it('패자가 3/4위전을 채운다', async () => {
    const db = semifinalDb();
    await write(db, 'sf1', winBy('a'));
    await write(db, 'sf2', winBy('d'));
    expect(db.matches.third).toMatchObject({ player1Id: 'b', player1Name: 'B', player2Id: 'c', player2Name: 'C', status: 'pending' });
  });

  it('구 클라이언트 필드 sourceMatch1Id도 읽는다', async () => {
    const db = semifinalDb();
    db.matches.f = pending({ sourceMatch1Id: 'sf1', sourceMatch2Id: 'sf2' });
    await write(db, 'sf1', winBy('b'));
    expect(db.matches.f.player1Id).toBe('b');
  });

  it('팀전 31점 단판 경기의 승자(세트 판정)가 진출하고 팀 정보가 복사된다', async () => {
    const team1 = { id: 'x', name: 'X', memberIds: ['x1', 'x2', 'x3'] };
    const db: FakeDb = {
      tournament: { type: 'team' },
      matches: {
        m1: { tournamentId: 't', type: 'team', status: 'in_progress', team1Id: 'x', team2Id: 'y', team1Name: 'X', team2Name: 'Y', team1 },
        m2: { tournamentId: 't', type: 'team', status: 'in_progress', team1Id: 'z', team2Id: 'w', team1Name: 'Z', team2Name: 'W' },
        f: { tournamentId: 't', type: 'team', status: 'pending', team1Id: '', team2Id: '', sourceMatch1: 'm1', sourceMatch2: 'm2' },
      },
      conflicts: {}, invocations: 0,
    };
    await write(db, 'm1', { status: 'completed', sets: [{ player1Score: 31, player2Score: 27 }] });
    expect(db.matches.f).toMatchObject({ team1Id: 'x', team1Name: 'X', team1 });
  });

  it('BYE 경기는 실제 선수를 진출시키고 3/4위전에는 BYE를 넣지 않는다 (4강 BYE → 3/4위전 부전승)', async () => {
    const db = semifinalDb();
    // 3명 대회: sf1은 a의 부전승(BYE) 경기로 생성됨
    delete db.matches.sf1;
    await write(db, 'sf1', { tournamentId: 't', status: 'completed', isBye: true, player1Id: 'a', player1Name: 'A', player2Id: 'BYE', player2Name: '부전승', winnerId: 'a', sets: [] });
    expect(db.matches.f).toMatchObject({ player1Id: 'a' });
    expect(db.matches.third.player1Id).toBe('');
    expect(db.matches.third.player1Name).toBe('4강 패자1'); // BYE/부전승 이름이 들어가지 않음
    expect(db.matches.third.status).toBe('pending'); // 상대가 아직 모름 → 부전승 처리하지 않음

    await write(db, 'sf2', winBy('c'));
    expect(db.matches.f).toMatchObject({ player1Id: 'a', player2Id: 'c' });
    // 3/4위전: d만 남음 → 자동 부전승 11:0 (3세트제 → 11:0 두 세트), isBye + 사유 'bye'
    expect(db.matches.third).toMatchObject({
      player2Id: 'd', player1Id: '', status: 'completed', winnerId: 'd',
      walkover: true, walkoverReason: 'bye', autoWalkover: true, isBye: true,
    });
    expect(db.matches.third.bye).toBeUndefined(); // 쓰기는 isBye만
    expect((db.matches.third.sets as Array<{ player1Score: number; player2Score: number }>).map(s => [s.player1Score, s.player2Score]))
      .toEqual([[0, 11], [0, 11]]);
  });

  it('자동 부전승 점수는 대회 규칙을 따른다 (5세트제 11:0 ×3, 팀 31:0, 설정 점수, BYE 미집계 설정)', async () => {
    const run = async (tournament: MatchData, type = 'individual') => {
      const db = semifinalDb();
      db.tournament = tournament;
      for (const m of Object.values(db.matches)) m.type = type;
      delete db.matches.sf1;
      await write(db, 'sf1', { tournamentId: 't', type, status: 'completed', isBye: true, player1Id: 'a', player1Name: 'A', player2Id: 'BYE', winnerId: 'a', sets: [] });
      await write(db, 'sf2', { ...winBy('c'), type, sets: type === 'team' ? [{ player1Score: 31, player2Score: 20 }] : winBy('c').sets });
      return (db.matches.third.sets as Array<{ player1Score: number; player2Score: number }>).map(s => [s.player1Score, s.player2Score]);
    };
    expect(await run({ gameConfig: { winScore: 11, setsToWin: 3 } })).toEqual([[0, 11], [0, 11], [0, 11]]);
    expect(await run({ type: 'team' }, 'team')).toEqual([[0, 31]]);
    expect(await run({ rules: { walkover: { setScore: 7 } } })).toEqual([[0, 7], [0, 7]]);
    expect(await run({ rules: { walkover: { byeCountsAsWalkover: false } } })).toEqual([]);
  });

  it('BYE 연쇄: 양쪽이 영구히 빈 경기는 자동 처리되고 다음 라운드로 이어진다', async () => {
    // 8강 슬롯 중 q3, q4가 모두 빈 BYE(진출자 부족) → 4강 s2가 승자 없는 BYE → 결승에서 s1 승자 부전승
    const bye = (): MatchData => ({ tournamentId: 't', status: 'completed', isBye: true, player1Id: 'BYE', player2Id: 'BYE', winnerId: null, sets: [] });
    const db: FakeDb = {
      tournament: {},
      matches: {
        q1: real('a', 'b'), q2: real('c', 'd'),
        s1: pending({ sourceMatch1: 'q1', sourceMatch2: 'q2' }),
        s2: pending({ sourceMatch1: 'q3', sourceMatch2: 'q4' }),
        f: pending({ sourceMatch1: 's1', sourceMatch2: 's2' }),
      },
      conflicts: {}, invocations: 0,
    };
    await write(db, 'q3', bye());
    expect(db.matches.s2.status).toBe('pending'); // q4가 아직 없음
    await write(db, 'q4', bye());
    expect(db.matches.s2).toMatchObject({ status: 'completed', autoWalkover: true, isBye: true });
    expect(db.matches.s2.winnerId ?? null).toBeNull();
    expect(db.matches.f.status).toBe('pending'); // s1 승자 미정

    await write(db, 'q1', winBy('a'));
    await write(db, 'q2', winBy('d'));
    expect(db.matches.s1).toMatchObject({ player1Id: 'a', player2Id: 'd', status: 'pending' });
    await write(db, 's1', winBy('d'));
    // 결승: s2 쪽이 영구히 비었으므로 d 부전승 우승
    expect(db.matches.f).toMatchObject({ player1Id: 'd', status: 'completed', winnerId: 'd', autoWalkover: true });
  });

  it('정정: 하위 경기가 pending이면 이전에 채운 값을 바꾸고, 재개되면 비운다', async () => {
    const db = semifinalDb();
    await write(db, 'sf1', winBy('a'));
    expect(db.matches.f.player1Id).toBe('a');
    expect(db.matches.third.player1Id).toBe('b');

    // 점수 정정으로 승자가 b로 바뀜
    await write(db, 'sf1', { winnerId: 'b' });
    expect(db.matches.f).toMatchObject({ player1Id: 'b', player1Name: 'B', player1Source: { id: 'b', prevName: '4강 승자1' } });
    expect(db.matches.third).toMatchObject({ player1Id: 'a', player1Name: 'A' });

    // 경기 재개(completed → in_progress): 채운 값을 비우고 원래 표시 이름 복원
    await write(db, 'sf1', { status: 'in_progress', winnerId: null });
    expect(db.matches.f).toMatchObject({ player1Id: '', team1Id: '', player1Name: '4강 승자1' });
    expect(db.matches.f.player1Source).toBeUndefined();
    expect(db.matches.third).toMatchObject({ player1Id: '', player1Name: '4강 패자1' });
    expect(Object.keys(db.conflicts)).toHaveLength(0);
  });

  it('정정: 하위 경기가 이미 시작됐으면 덮어쓰지 않고 충돌을 기록한다', async () => {
    const db = semifinalDb();
    await write(db, 'sf1', winBy('a'));
    await write(db, 'sf2', winBy('c'));
    await write(db, 'f', { status: 'in_progress' });

    await write(db, 'sf1', { winnerId: 'b' });
    expect(db.matches.f).toMatchObject({ player1Id: 'a', status: 'in_progress' }); // 그대로
    expect(db.conflicts['f/player1']).toMatchObject({
      downstreamMatchId: 'f', side: 1, sourceMatchId: 'sf1', reason: 'downstream_started',
      downstreamStatus: 'in_progress', currentId: 'a', expectedId: 'b', createdAt: 1000, updatedAt: 1000,
    });
    // 3/4위전은 아직 pending이므로 정상 갱신
    expect(db.matches.third.player1Id).toBe('a');

    // 정정을 되돌리면 충돌 기록이 정리된다
    await write(db, 'sf1', { winnerId: 'a' });
    expect(db.conflicts['f/player1']).toBeUndefined();
  });

  it('관리자가 직접 넣은 슬롯은 덮어쓰지 않는다', async () => {
    const db = semifinalDb();
    // 결과 전에 관리자가 결승 1번 슬롯에 z를 직접 배치
    db.matches.f = { ...db.matches.f, player1Id: 'z', player1Name: 'Z' };
    await write(db, 'sf1', winBy('a'));
    expect(db.matches.f).toMatchObject({ player1Id: 'z', player1Name: 'Z' });
    expect(db.conflicts['f/player1']).toMatchObject({ reason: 'manual_override', currentId: 'z', expectedId: 'a' });

    // 트리거가 채운 뒤 관리자가 바꾼 경우도 보존
    const db2 = semifinalDb();
    await write(db2, 'sf1', winBy('a'));
    db2.matches.f = { ...db2.matches.f, player1Id: 'z', player1Name: 'Z', team1Id: 'z', team1Name: 'Z' };
    await write(db2, 'sf1', { winnerId: 'b' });
    expect(db2.matches.f.player1Id).toBe('z');
    // 재개해도 관리자 값은 지우지 않음
    await write(db2, 'sf1', { status: 'in_progress', winnerId: null });
    expect(db2.matches.f.player1Id).toBe('z');
  });

  it('팀전: 관리자가 team 필드만 바꾼 슬롯은 남은 player{N}Id와 상관없이 보존되고, 바뀐 팀이 진출한다', async () => {
    const teamMatch = (extra: MatchData): MatchData => ({
      tournamentId: 't', type: 'team', status: 'pending',
      team1Id: '', team2Id: '', team1Name: '', team2Name: '', sets: [], winnerId: null, ...extra,
    });
    const db: FakeDb = {
      tournament: { type: 'team' },
      matches: {
        s1: teamMatch({ team1Id: 'A', team2Id: 'B', team1Name: 'TA', team2Name: 'TB' }),
        s2: teamMatch({ team1Id: 'D', team2Id: 'E', team1Name: 'TD', team2Name: 'TE' }),
        f: teamMatch({ sourceMatch1: 's1', sourceMatch2: 's2', team1Name: '4강 승자1', team2Name: '4강 승자2' }),
        g: teamMatch({ sourceMatch1: 'f' }),
      },
      conflicts: {}, invocations: 0,
    };
    await write(db, 's1', winBy('A'));
    expect(db.matches.f).toMatchObject({ player1Id: 'A', team1Id: 'A', player1Source: { id: 'A' } });

    // 관리자 팀 편집(BracketTab): team 필드만 C로 바꿈, player1Id는 A로 남음
    db.matches.f = { ...db.matches.f, team1Id: 'C', team1Name: 'TC' };
    await write(db, 's1', { winnerId: 'B' });
    expect(db.matches.f).toMatchObject({ team1Id: 'C', team1Name: 'TC' });
    expect(db.conflicts['f/player1']).toMatchObject({ reason: 'manual_override', currentId: 'C', expectedId: 'B' });

    // C가 결승을 이기면(심판은 winnerId = team1Id) 옛 A가 아니라 C가 진출한다
    await write(db, 's2', winBy('D'));
    await write(db, 'f', { status: 'completed', winnerId: 'C' });
    expect(db.matches.g).toMatchObject({ team1Id: 'C', team1Name: 'TC' });
  });

  it('자동 부전승 되돌리기: 상위 결과가 정정되면 새 선수로 바뀌고, 재개되면 pending으로 돌아간다 (다음 라운드까지)', async () => {
    const byeSf1: MatchData = { tournamentId: 't', status: 'completed', isBye: true, player1Id: 'a', player1Name: 'A', player2Id: 'BYE', player2Name: '부전승', winnerId: 'a', sets: [] };
    const db = semifinalDb();
    // 3/4위전 승자가 가는 다음 경기(한 라운드 더)
    db.matches.next = pending({ sourceMatch1: 'third', player1Name: '3위' });
    delete db.matches.sf1;
    await write(db, 'sf1', byeSf1);
    await write(db, 'sf2', winBy('c'));
    expect(db.matches.third).toMatchObject({ player2Id: 'd', status: 'completed', winnerId: 'd', autoWalkover: true });
    expect(db.matches.next).toMatchObject({ player1Id: 'd' });

    // sf2 승자 정정: 3/4위전 부전승 승자가 c로 바뀌고 다음 경기도 따라 바뀐다
    await write(db, 'sf2', { winnerId: 'd' });
    expect(db.matches.third).toMatchObject({ player2Id: 'c', status: 'completed', winnerId: 'c', autoWalkover: true });
    expect(db.matches.next).toMatchObject({ player1Id: 'c', player1Name: 'C' });

    // sf2 재개: 3/4위전은 pending으로 돌아가고 자동 부전승 표시가 지워지며, 다음 경기 슬롯도 비워진다
    await write(db, 'sf2', { status: 'in_progress', winnerId: null });
    expect(db.matches.third).toMatchObject({ status: 'pending', player2Id: '', player2Name: '4강 패자2' });
    expect(db.matches.third.winnerId ?? null).toBeNull();
    expect(db.matches.third.autoWalkover).toBeUndefined();
    expect(db.matches.third.isBye).toBeUndefined();
    // 부전승 점수(11:0)도 지워지고 빈 세트로 돌아간다
    expect((db.matches.third.sets as Array<{ player1Score: number }>).map(x => x.player1Score)).toEqual([0]);
    expect(db.matches.next).toMatchObject({ player1Id: '', player1Name: '3위' });
    expect(Object.keys(db.conflicts)).toHaveLength(0);
  });

  it('자동 부전승 결승: 출처 경기가 정정되면 우승자가 바뀌고, 재개되면 pending으로 돌아간다', async () => {
    const bye = (): MatchData => ({ tournamentId: 't', status: 'completed', isBye: true, player1Id: 'BYE', player2Id: 'BYE', winnerId: null, sets: [] });
    const db: FakeDb = {
      tournament: {},
      matches: {
        q1: real('a', 'b'), q2: real('c', 'd'),
        s1: pending({ sourceMatch1: 'q1', sourceMatch2: 'q2' }),
        s2: pending({ sourceMatch1: 'q3', sourceMatch2: 'q4' }),
        f: pending({ sourceMatch1: 's1', sourceMatch2: 's2', player1Name: '4강 승자1' }),
      },
      conflicts: {}, invocations: 0,
    };
    await write(db, 'q3', bye());
    await write(db, 'q4', bye());
    await write(db, 'q1', winBy('a'));
    await write(db, 'q2', winBy('d'));
    await write(db, 's1', winBy('d'));
    expect(db.matches.f).toMatchObject({ player1Id: 'd', status: 'completed', winnerId: 'd', autoWalkover: true });

    await write(db, 's1', { winnerId: 'a' });
    expect(db.matches.f).toMatchObject({ player1Id: 'a', status: 'completed', winnerId: 'a', autoWalkover: true });

    await write(db, 's1', { status: 'in_progress', winnerId: null });
    expect(db.matches.f).toMatchObject({ status: 'pending', player1Id: '', player1Name: '4강 승자1' });
    expect(db.matches.f.winnerId ?? null).toBeNull();
    expect(db.matches.f.autoWalkover).toBeUndefined();
    expect(Object.keys(db.conflicts)).toHaveLength(0);
  });

  it('멱등: 같은 이벤트를 두 번 처리해도 결과가 같고, 하위 쓰기의 재호출은 아무것도 하지 않는다', async () => {
    const db = semifinalDb();
    const before = clone(db.matches.sf1);
    const after = { ...before, ...winBy('a') };
    db.matches.sf1 = after;
    const r1 = await fire(db, 'sf1', before, after);
    const snapshot = clone(db.matches);
    const invocationsAfterFirst = db.invocations;
    const r2 = await fire(db, 'sf1', before, after);
    expect(db.matches).toEqual(snapshot);
    expect(r1.updated.sort()).toEqual(['f', 'third']);
    expect(r2.updated).toEqual([]);
    // 첫 처리에서 f/third에 대한 재호출은 각각 1번이고, 모두 irrelevant로 끝남
    expect(invocationsAfterFirst).toBe(3);
  });

  it('autoAdvance === false인 대회는 건너뛴다', async () => {
    const db = semifinalDb();
    db.tournament = { autoAdvance: false };
    const r = await write(db, 'sf1', winBy('a'));
    expect(r.skipped).toBe('opt_out');
    expect(db.matches.f.player1Id).toBe('');
  });

  it('승자가 같으면 완료 경기의 다른 필드 변경은 무시한다', async () => {
    const db = semifinalDb();
    await write(db, 'sf1', winBy('a'));
    const r = await write(db, 'sf1', { sets: [{ player1Score: 11, player2Score: 3 }, { player1Score: 11, player2Score: 4 }] });
    expect(r.skipped).toBe('unchanged');
  });
});

describe('sweepAdvancement (시뮬레이션)', () => {
  it('BYE 4강의 패자 자리에 BYE를 넣지 않는다', () => {
    const all: Record<string, MatchData> = {
      sf1: { status: 'completed', isBye: true, player1Id: 'a', player1Name: 'A', player2Id: 'BYE', player2Name: '부전승', winnerId: 'a' },
      sf2: { ...real('c', 'd'), ...winBy('c') },
      f: pending({ sourceMatch1: 'sf1', sourceMatch2: 'sf2' }),
      third: pending({ sourceMatch1: 'sf1', sourceMatch2: 'sf2', sourceType: 'loser' }),
    };
    const patches = sweepAdvancement(all, () => ({ setsToWin: 2, winScore: 11, minLead: 2 }), walkoverSetsForTournament(null));
    expect(patches.f).toMatchObject({ player1Id: 'a', player2Id: 'c' });
    expect(patches.third.player1Id).toBeUndefined();
    expect(patches.third).toMatchObject({ player2Id: 'd', status: 'completed', winnerId: 'd', autoWalkover: true });
    expect(JSON.stringify(patches)).not.toContain('"BYE"');
  });

  it('자기 자신을 참조하는 링크는 무시한다', () => {
    expect(findDownstreamLinks({ x: pending({ sourceMatch1: 'x' }) }, 'x')).toEqual([]);
  });
});

describe('determineResult honours the deuce cap (single winner function)', () => {
  it('15:14 under a 15 cap is a set win', () => {
    const m = { status: 'completed', player1Id: 'a', player2Id: 'b', player1Name: 'A', player2Name: 'B', sets: [{ player1Score: 15, player2Score: 14 }, { player1Score: 11, player2Score: 3 }] };
    expect(determineResult(m, { setsToWin: 2, winScore: 11, minLead: 2, deuceCap: 15 })).toMatchObject({ decided: true, winner: { id: 'a' } });
    expect(determineResult(m, { setsToWin: 2, winScore: 11, minLead: 2 }).decided).toBe(false);
  });
  it('resolveScoringRules keeps the tournament deuce cap', () => {
    expect(resolveScoringRules({ type: 'individual' }, { rules: { scoring: { individual: { deuceCap: 15 } } } }).deuceCap).toBe(15);
  });
});
