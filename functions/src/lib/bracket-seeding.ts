/**
 * 본선 브라켓 시드 배치 순수 로직
 *
 * generate-finals.ts에서 추출.
 *
 * 시드 규칙:
 *   1. 1위들 정순 → 2위들 역순 → 와일드카드 순서로 배치
 *      (조별 1위가 다른 조 2위와 교차하도록)
 *   2. fold-pairing: idx 0-vs-(N-1), 1-vs-(N-2), ...
 *   3. 같은 조 매치 발견 시 인접 슬롯과 스왑 시도
 *   4. 부족한 슬롯은 BYE (null)
 */

export interface SeedEntry {
  id: string;
  name: string;
  /** 조 식별자 (같은 조 매칭 회피용) */
  gid: string;
  /** 조 내 순위 (1=조1위, 2=조2위, 3+=와일드카드) */
  rank: number;
}

/**
 * 조 1위·2위·와일드카드 순서로 시드 배치.
 * 2위들은 역순으로 배치하여 1위와 다른 조 2위가 만나도록.
 *
 * 예: A1 B1 C1 + A2 B2 C2 + WC1 WC2
 *  → 정렬: [A1, B1, C1] + [C2, B2, A2] + [WC1, WC2]
 *  → fold pairs: A1-WC2, B1-WC1, C1-A2, C2-B2 (3vs1조, 4vs1조 — 다음 단계에서 회피)
 */
export function seedBracket(advanced: ReadonlyArray<SeedEntry>): SeedEntry[] {
  const top = advanced.filter(p => p.rank === 1);
  const sec = advanced.filter(p => p.rank === 2);
  const wcPlayers = advanced.filter(p => p.rank > 2);
  const secReversed = [...sec].reverse();
  return [...top, ...secReversed, ...wcPlayers];
}

/**
 * fold-pairing index pairs 생성.
 * bracketSize=8 → [[0,7],[1,6],[2,5],[3,4]]
 */
export function getBracketPairs(bracketSize: number): Array<[number, number]> {
  const half = Math.floor(bracketSize / 2);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < half; i++) {
    pairs.push([i, bracketSize - 1 - i]);
  }
  return pairs;
}

/**
 * 같은 조 1라운드 충돌 회피.
 * 페어가 같은 gid면 다음 페어의 p2와 슬롯 스왑 시도 (가능한 경우).
 *
 * 입력 배열을 직접 변경 (in place). 반환값은 같은 배열 (체이닝용).
 *
 * 한계:
 * - 단일 패스 greedy → 모든 충돌을 해결하지 못할 수 있음
 * - 그래도 대부분의 정상 토너먼트에서 충분
 */
export function applyAvoidSameGroup(
  seeded: SeedEntry[],
  bracketSize: number,
): SeedEntry[] {
  const pairs = getBracketPairs(bracketSize);
  for (let i = 0; i < pairs.length; i++) {
    const [idx1, idx2] = pairs[i];
    const p1 = idx1 < seeded.length ? seeded[idx1] : null;
    const p2 = idx2 < seeded.length ? seeded[idx2] : null;
    if (!p1 || !p2 || p1.gid !== p2.gid) continue;

    // 같은 조 충돌 → 다음 페어의 p2와 스왑 시도
    for (let j = i + 1; j < pairs.length; j++) {
      const [swapIdx1, swapIdx2] = pairs[j];
      const swapP2 = swapIdx2 < seeded.length ? seeded[swapIdx2] : null;
      if (!swapP2 || swapP2.gid === p1.gid) continue;

      // 스왑 후 j번째 페어가 새로 충돌하지 않는지 검사
      const swapTarget1 = swapIdx1 < seeded.length ? seeded[swapIdx1] : null;
      if (swapTarget1 && swapTarget1.gid === p2.gid) continue;

      // 스왑 실행
      [seeded[idx2], seeded[swapIdx2]] = [seeded[swapIdx2], seeded[idx2]];
      break;
    }
  }
  return seeded;
}

/**
 * 진출자 수에서 가장 가까운 2의 거듭제곱(브라켓 크기) 산출.
 * 최소 2.
 */
export function computeBracketSize(advancedCount: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(2, advancedCount))));
}

/** 1라운드 매치업 (BYE 포함) */
export interface BracketPair {
  /** fold-pairing 인덱스 */
  position: number;
  /** 첫 번째 슬롯 (BYE면 null) */
  p1: SeedEntry | null;
  /** 두 번째 슬롯 (BYE면 null) */
  p2: SeedEntry | null;
  /** 양쪽 모두 있으면 false, 하나라도 BYE면 true */
  isBye: boolean;
}

/**
 * 시드된 배열을 fold-pairing으로 BracketPair[] 변환.
 * 슬롯이 부족하면 null로 채워 BYE 생성.
 */
export function buildFirstRoundPairs(
  seeded: ReadonlyArray<SeedEntry>,
  bracketSize: number,
): BracketPair[] {
  const half = Math.floor(bracketSize / 2);
  const result: BracketPair[] = [];
  for (let i = 0; i < half; i++) {
    const p1 = i < seeded.length ? seeded[i] : null;
    const p2 = (bracketSize - 1 - i) < seeded.length ? seeded[bracketSize - 1 - i] : null;
    result.push({
      position: i,
      p1,
      p2,
      isBye: !p1 || !p2,
    });
  }
  return result;
}

/** 라운드 한국어 이름 */
export const ROUND_NAMES: Record<number, string> = {
  32: "32강",
  16: "16강",
  8: "8강",
  4: "4강",
  2: "결승",
};

export function getRoundName(n: number): string {
  return ROUND_NAMES[n] || `${n}강`;
}
