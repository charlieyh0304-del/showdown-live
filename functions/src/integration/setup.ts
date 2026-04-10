/**
 * 에뮬레이터 기반 통합 테스트 셋업 헬퍼
 *
 * 환경변수 FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 이 설정되면
 * firebase-admin이 에뮬레이터에 연결됩니다.
 *
 * 사용법:
 *   1) firebase emulators:start --only database (별도 터미널)
 *   2) FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 npx vitest run src/integration/
 */
import * as admin from "firebase-admin";

// firebase-admin은 이미 index.ts에서 initializeApp을 호출하지만,
// 테스트에서는 독립 실행이므로 중복 방지 처리
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "showdown-test" });
}

export const testDb = admin.database();

/** 테스트 전 RTDB 전체 초기화 */
export async function clearDatabase(): Promise<void> {
  await testDb.ref("/").set(null);
}

/** 대회 + 경기 시드 데이터를 RTDB에 삽입 */
export async function seedTournament(
  tournamentId: string,
  tournament: Record<string, unknown>,
  matches: Record<string, Record<string, unknown>>,
): Promise<void> {
  await testDb.ref(`tournaments/${tournamentId}`).set(tournament);
  await testDb.ref(`matches/${tournamentId}`).set(matches);
}

/** 특정 경로의 RTDB 스냅샷을 객체로 읽기 */
export async function readPath<T = unknown>(path: string): Promise<T | null> {
  const snap = await testDb.ref(path).once("value");
  return snap.exists() ? (snap.val() as T) : null;
}
