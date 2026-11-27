/**
 * 본선 대진 시드 배치 (M0c, 감사 B9·B13).
 *
 * - 표준 시드 위치: 대진 크기 2^k에서 1·2번 시드는 결승에서만, 1~4번 시드는 4강 이후에만 만난다.
 *   (1, 2) → (1, 4, 2, 3) → (1, 8, 4, 5, 2, 7, 3, 6) ... 각 단계에서 s 옆에 (2^k + 1 - s)를 둔다.
 * - BYE는 시드 번호가 참가자 수보다 큰 자리다. 따라서 항상 상위 시드가 BYE를 받고, BYE끼리 만나지 않는다.
 * - 조별 교차(cross-over): 조 1위들 → 조 2위들 → ... 계층 순으로 시드를 주고, 같은 계층 안에서 자리를
 *   바꿔 같은 조 선수가 가능한 한 늦게 만나게 한다(1라운드 같은 조 대결이 가장 큰 벌점).
 *   2개 조면 A1-B2, B1-A2 이고 A1·A2는 결승에서만 만날 수 있다.
 * - 같은 선수가 두 번 들어가거나 자기 자신과 만나는 일은 없다(입력 중복 ID는 처음 것만 쓴다).
 *
 * 순수 모듈. functions/src/shared/rules/seeding.ts는 이 파일의 사본이다.
 */

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** 대진 크기 size(2의 거듭제곱)에서 슬롯 i에 들어갈 시드 번호(1부터) */
export function standardSeedPositions(size: number): number[] {
  const target = nextPowerOfTwo(Math.max(2, size));
  let order = [1, 2];
  while (order.length < target) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) next.push(s, n + 1 - s);
    order = next;
  }
  return order;
}

/**
 * 시드 순서 목록(1번 시드가 첫 원소)을 대진 슬롯에 배치한다.
 * 결과 길이 = 대진 크기, [2k], [2k+1]이 1라운드 k번째 경기. 빈 자리는 null(BYE).
 */
export function placeSeeds<T>(seeds: readonly T[], size?: number): Array<T | null> {
  const bracketSize = nextPowerOfTwo(Math.max(2, size ?? seeds.length));
  return standardSeedPositions(bracketSize).map(s => (s <= seeds.length ? seeds[s - 1] : null));
}

/** 두 슬롯이 처음 만날 수 있는 라운드 (1 = 1라운드) */
export function earliestMeetingRound(posA: number, posB: number): number {
  const x = posA ^ posB;
  let r = 0;
  let v = x;
  while (v > 0) { v >>= 1; r++; }
  return r;
}

export interface SeedCandidate {
  id: string;
  groupId: string;
  /** 시드 계층(1 = 조 1위, 2 = 조 2위, ...). 계층이 낮을수록 높은 시드 */
  tier: number;
}

function dedupe<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (!it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/** 같은 조 선수가 일찍 만날수록 큰 벌점 (1라운드가 가장 크다) */
function sameGroupCost<T extends SeedCandidate>(order: T[], positionOfSeed: number[], rounds: number): number {
  let cost = 0;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      if (!order[i].groupId || order[i].groupId !== order[j].groupId) continue;
      const r = earliestMeetingRound(positionOfSeed[i], positionOfSeed[j]);
      cost += Math.pow(10, Math.max(0, rounds - r));
    }
  }
  return cost;
}

/**
 * 조별 교차 시드 순서. 반환 배열의 i번째가 (i+1)번 시드다.
 * 계층 순(1위들 → 2위들 → ...), 계층 안에서는 조 ID 순으로 시작한 뒤,
 * avoidSameGroup이면 2계층 이후 선수끼리 자리를 바꿔 같은 조 대결을 최대한 늦춘다(결정적, 재현 가능).
 */
export function crossGroupSeedOrder<T extends SeedCandidate>(candidates: readonly T[], opts: { avoidSameGroup: boolean }): T[] {
  const unique = dedupe(candidates);
  const order = [...unique].sort((a, b) => a.tier - b.tier || (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0));
  if (!opts.avoidSameGroup || order.length < 3) return order;

  const size = nextPowerOfTwo(order.length);
  const rounds = Math.log2(size);
  const positions = standardSeedPositions(size);
  const positionOfSeed: number[] = [];
  positions.forEach((seed, pos) => { if (seed <= order.length) positionOfSeed[seed - 1] = pos; });

  let best = sameGroupCost(order, positionOfSeed, rounds);
  let improved = true;
  let guard = 0;
  while (improved && best > 0 && guard++ < 200) {
    improved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        if (order[i].tier !== order[j].tier || order[i].tier === 1) continue;
        [order[i], order[j]] = [order[j], order[i]];
        const c = sameGroupCost(order, positionOfSeed, rounds);
        if (c < best) { best = c; improved = true; }
        else [order[i], order[j]] = [order[j], order[i]];
      }
    }
  }
  return order;
}

/** 대진 슬롯 검증: 같은 ID가 두 번 나오면 그 ID를 돌려준다 */
export function findDuplicateSlot(slots: ReadonlyArray<{ id: string } | null | undefined>): string | null {
  const seen = new Set<string>();
  for (const s of slots) {
    if (!s || !s.id) continue;
    if (seen.has(s.id)) return s.id;
    seen.add(s.id);
  }
  return null;
}
