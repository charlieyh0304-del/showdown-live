/**
 * 랜덤 팀 추첨 (randomTeamLeague, M0c).
 *
 * - 저장된 seed로 재현 가능하다(같은 선수 목록 + 같은 seed = 같은 결과). 결과와 seed를 대회 노드에 남긴다.
 * - 선수를 조용히 빠뜨리지 않는다. 팀에 못 들어간 선수는 unassigned로 돌려준다
 *   (예전 구현은 팀 수보다 여자 선수가 많으면 남은 여자 선수가 사라졌다).
 * - 시드 선수는 팀마다 한 명씩 먼저 들어간다.
 * - 성별 비율(genderRatio)을 주면 팀마다 그 수만큼, 없으면 여자 선수를 팀에 고르게 나눈다.
 *
 * 순수 모듈. functions/src/shared/rules/teamDraw.ts는 이 파일의 사본이다.
 */
import { seededShuffle } from './rng';

export interface DrawPlayer {
  id: string;
  gender?: string;
}

export interface TeamDrawInput {
  players: readonly DrawPlayer[];
  teamSize: number;
  seed: string;
  /** 팀마다 한 명씩 먼저 넣을 시드 선수 ID (순서대로 1팀, 2팀 ...) */
  seedIds?: readonly string[];
  genderRatio?: { male: number; female: number } | null;
}

export interface TeamDrawResult {
  /** 팀별 선수 ID */
  teams: string[][];
  unassigned: string[];
}

export function isFemale(g: unknown): boolean {
  return g === 'female' || g === '여';
}

export function isMale(g: unknown): boolean {
  return g === 'male' || g === '남';
}

export function drawTeams(input: TeamDrawInput): TeamDrawResult {
  const teamSize = Math.max(1, Math.floor(input.teamSize));
  const unique: DrawPlayer[] = [];
  const seen = new Set<string>();
  for (const p of input.players) {
    if (!p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    unique.push(p);
  }
  const teamCount = Math.floor(unique.length / teamSize);
  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  if (teamCount === 0) return { teams: [], unassigned: unique.map(p => p.id) };

  const used = new Set<string>();
  (input.seedIds || []).slice(0, teamCount).forEach((id, i) => {
    if (seen.has(id) && !used.has(id)) { teams[i].push(id); used.add(id); }
  });
  const rest = seededShuffle(unique.filter(p => !used.has(p.id)), input.seed);
  const females = rest.filter(p => isFemale(p.gender));
  const males = rest.filter(p => isMale(p.gender));
  const others = rest.filter(p => !isFemale(p.gender) && !isMale(p.gender));
  const genderOf = new Map(unique.map(p => [p.id, p.gender]));
  const count = (team: string[], pred: (g: unknown) => boolean) => team.filter(id => pred(genderOf.get(id))).length;

  const place = (pool: DrawPlayer[], capOf: (team: string[]) => number) => {
    const left: DrawPlayer[] = [];
    for (const p of pool) {
      // 가장 인원이 적은 팀부터 (같으면 앞 팀)
      let best = -1;
      for (let i = 0; i < teams.length; i++) {
        if (teams[i].length >= teamSize || capOf(teams[i]) <= 0) continue;
        if (best < 0 || teams[i].length < teams[best].length) best = i;
      }
      if (best < 0) left.push(p);
      else teams[best].push(p.id);
    }
    return left;
  };

  const ratio = input.genderRatio && (input.genderRatio.male > 0 || input.genderRatio.female > 0) ? input.genderRatio : null;
  let leftover: DrawPlayer[];
  if (ratio) {
    const lf = place(females, t => ratio.female - count(t, isFemale));
    const lm = place(males, t => ratio.male - count(t, isMale));
    leftover = place([...others, ...lf, ...lm], () => 1);
  } else {
    // 여자 선수를 고르게: 팀마다 여자 수가 평균을 넘지 않게 먼저 배치
    const perTeam = Math.ceil(females.length / teamCount);
    const lf = place(females, t => perTeam - count(t, isFemale));
    leftover = place([...males, ...others, ...lf], () => 1);
  }
  return { teams, unassigned: leftover.map(p => p.id) };
}
