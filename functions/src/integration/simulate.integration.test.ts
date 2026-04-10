/**
 * simulate_matches 통합 테스트
 *
 * 실행 전 에뮬레이터 시작 필요:
 *   firebase emulators:start --only database
 *
 * 실행:
 *   FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 npx vitest run src/integration/
 */
import { describe, it, expect, beforeEach } from "vitest";
import { clearDatabase, seedTournament, readPath } from "./setup";
import { simulateMatches } from "../handlers/simulate";

// 통합 테스트는 에뮬레이터 실행 중일 때만 동작
const isEmulator = !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;

const describeIf = isEmulator ? describe : describe.skip;

/** executeTool 더미: simulate 내부에서 generate_finals 등을 호출할 수 있으나 예선만 테스트 */
const noopExecuteTool = async () => JSON.stringify({ skipped: true });

describeIf("simulateMatches (에뮬레이터 통합)", () => {
  const tid = "test-tournament-1";

  beforeEach(async () => {
    await clearDatabase();
  });

  it("개인전 예선 경기 2개를 시뮬레이션하고 completed로 업데이트", async () => {
    await seedTournament(tid, {
      name: "테스트 대회",
      type: "individual",
      status: "in_progress",
      gameConfig: { winScore: 11, setsToWin: 2 },
    }, {
      m1: {
        tournamentId: tid,
        status: "pending",
        player1Id: "p1", player1Name: "홍길동",
        player2Id: "p2", player2Name: "김철수",
        stageId: "qualifying", groupId: "A",
      },
      m2: {
        tournamentId: tid,
        status: "pending",
        player1Id: "p3", player1Name: "박영희",
        player2Id: "p4", player2Name: "이순신",
        stageId: "qualifying", groupId: "A",
      },
    });

    const result = JSON.parse(
      await simulateMatches({ tournamentId: tid, lightweight: true }, noopExecuteTool),
    );

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(2);

    // DB에서 경기 상태 확인
    const m1 = await readPath<Record<string, unknown>>(`matches/${tid}/m1`);
    const m2 = await readPath<Record<string, unknown>>(`matches/${tid}/m2`);

    expect(m1?.status).toBe("completed");
    expect(m2?.status).toBe("completed");
    expect(m1?.winnerId).toBeTruthy();
    expect(m2?.winnerId).toBeTruthy();

    // sets 배열에 실제 점수가 기록되었는지
    const sets1 = m1?.sets as Array<{ player1Score: number; player2Score: number }> | undefined;
    expect(sets1).toBeDefined();
    expect(sets1!.length).toBeGreaterThanOrEqual(2); // best of 3 → 최소 2세트
    expect(sets1![0].player1Score + sets1![0].player2Score).toBeGreaterThan(0);
  });

  it("팀전 경기를 시뮬레이션", async () => {
    await seedTournament(tid, {
      name: "팀전 대회",
      type: "team",
      status: "in_progress",
      teamMatchSettings: { winScore: 31, setsToWin: 1 },
    }, {
      tm1: {
        tournamentId: tid,
        status: "pending",
        type: "team",
        team1Id: "t1", team1Name: "대한민국",
        team2Id: "t2", team2Name: "일본",
        player1Id: "t1", player1Name: "대한민국",
        player2Id: "t2", player2Name: "일본",
        stageId: "qualifying", groupId: "A",
      },
    });

    const result = JSON.parse(
      await simulateMatches({ tournamentId: tid, lightweight: true }, noopExecuteTool),
    );

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(1);

    const tm1 = await readPath<Record<string, unknown>>(`matches/${tid}/tm1`);
    expect(tm1?.status).toBe("completed");
    expect(tm1?.winnerId).toBeTruthy();
  });

  it("이미 completed인 경기는 시뮬레이션 대상에서 제외", async () => {
    await seedTournament(tid, {
      name: "완료 대회",
      type: "individual",
      status: "in_progress",
      gameConfig: { winScore: 11, setsToWin: 2 },
    }, {
      done1: {
        tournamentId: tid,
        status: "completed",
        player1Id: "p1", player1Name: "홍길동",
        player2Id: "p2", player2Name: "김철수",
        winnerId: "p1",
      },
    });

    const result = JSON.parse(
      await simulateMatches({ tournamentId: tid }, noopExecuteTool),
    );

    // 시뮬레이션할 pending 경기가 없음
    expect(result.simulated).toBe(0);
  });

  it("선수가 없는 빈 슬롯 경기는 건너뜀", async () => {
    await seedTournament(tid, {
      name: "빈슬롯",
      type: "individual",
      status: "in_progress",
      gameConfig: { winScore: 11, setsToWin: 2 },
    }, {
      empty1: {
        tournamentId: tid,
        status: "pending",
        player1Id: "", player1Name: "",
        player2Id: "", player2Name: "",
      },
    });

    const result = JSON.parse(
      await simulateMatches({ tournamentId: tid }, noopExecuteTool),
    );

    expect(result.simulated).toBe(0);
  });
});
