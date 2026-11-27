/// <reference types="node" />
/**
 * 판정 규칙 우회 방지 가드 (M0g).
 *
 * 경기 결과를 정하는 값(세트·경기 승자, 듀스 캡, 목표 점수, 세트 수, 부전승 세트, 순위·동률·진출·시드·최종 순위,
 * 서브 수, 사이드 체인지 점수, 시간 제한)은 모두 대회 규칙 단일 설정원(src/shared/rules: resolveCompetitionRules /
 * resolveMatchScoring / setWinnerByRules / matchWinnerByRules / serve.ts / scheduling.ts)에서 와야 한다.
 * 이 테스트는 앱 소스(클라이언트 src/, 서버 functions/src/)에서 규칙을 우회하는 패턴을 찾아 실패시킨다.
 *
 * 검사하지 않는 곳
 * - src/shared/rules/**, functions/src/shared/rules/** : 규칙 모듈 자체 (기본값은 여기에만 있다)
 * - *.test.ts : 테스트
 * - src/shared/i18n/** : 문구
 * 그 밖의 예외는 아래 ALLOW에 이유와 함께 적는다. 새 우회가 생기면 이 테스트가 실패한다.
 * 예외를 늘려야 한다면 그 값이 resolver로 흘러가는지 먼저 확인하고 이유를 적을 것.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const SCAN_DIRS = ['src', join('functions', 'src')];
const SKIP_DIRS = ['src/shared/rules', 'functions/src/shared/rules', 'src/shared/i18n', 'node_modules'];

/** 연습 모드: 대회와 무관한 로컬 연습 경기(PracticeMatch.gameConfig, IBSA 기본값)라 대회 규칙이 없다 */
const PRACTICE = [
  'src/referee/pages/practice/',
  'src/referee/components/practice/',
  'src/referee/hooks/usePracticeMatch.ts',
  'src/referee/hooks/usePracticeHistory.ts',
  'src/spectator/pages/PracticeWatchView.tsx',
];

interface Rule {
  id: string;
  why: string;
  pattern: RegExp;
  /** 허용 경로 접두사 (이유는 주석으로) */
  allow: string[];
}

const RULES: Rule[] = [
  {
    id: 'legacy-winner-adapter',
    why: '연습 모드 전용 어댑터. 대회 경기는 setWinnerByRules / matchWinnerByRules / setWinsByRules(matchSetWins)를 쓴다(듀스 캡 포함).',
    pattern: /\b(checkSetWinner|checkMatchWinner|countSetWins)\s*\(/,
    allow: [
      'src/shared/utils/scoring.ts', // 어댑터 정의 (rules 함수로 위임)
      ...PRACTICE,
    ],
  },
  {
    id: 'removed-bypass-api',
    why: '규칙을 우회하던 옛 함수. resolveMatchScoring + shared/rules/serve.ts를 쓴다.',
    pattern: /\b(getEffectiveScoringRules|getEffectiveGameConfig|getMaxServes|shouldSideChange|advanceServe|revertServe|calculateIndividualRanking|calculateTeamRanking)\s*\(/,
    allow: [],
  },
  {
    id: 'legacy-game-constants',
    why: '고정 점수/세트 상수. 기본값은 shared/rules/competitionRules.ts DEFAULT_*_SCORING에만 둔다.',
    pattern: /\b(POINTS_TO_WIN|SETS_TO_WIN)\s*:\s*\d|\b(DEFAULT_GAME_CONFIG|TEAM_GAME_CONFIG)\b/,
    allow: [
      ...PRACTICE, // 연습 경기 설정 (대회 규칙 없음)
    ],
  },
  {
    id: 'kind-score-ternary',
    why: '종목별 목표 점수·사이드 체인지 점수를 직접 고른다. resolveMatchScoring(...).winScore / sideChangePointOf를 쓴다.',
    pattern: /\?\s*31\s*:\s*11\b|\?\s*11\s*:\s*31\b|\?\s*16\s*:\s*6\b|\?\s*6\s*:\s*16\b/,
    allow: [],
  },
  {
    id: 'kind-serves-ternary',
    why: '종목별 서브 수를 직접 고른다. servesPerTurnOf(규칙, 종목)를 쓴다.',
    pattern: /[Tt]eam\w*[^\n]{0,40}\?\s*3\s*:\s*2\b/,
    allow: [],
  },
  {
    id: 'hand-rolled-set-result',
    why: '세트 승자/2점 차를 직접 계산한다. setWinnerByRules(규칙: 목표 점수·점수 차·듀스 캡)를 쓴다.',
    pattern: /Math\.abs\([^)]*\)\s*>=\s*2|player[12]Score\s*>\s*[\w.]*player[12]Score\s*\)\s*\{?\s*\w*(Wins|wins|setsWon|SetWins)\w*\s*\+\+|\b(s1|sc1)\s*>\s*(s2|sc2)\b/,
    allow: [],
  },
  {
    id: 'hard-coded-players-on-court',
    why: '단체전 코트 위 선수 수(3)를 직접 쓴다. playersOnCourtOf(규칙)를 쓴다.',
    pattern: /Math\.min\(\s*3\s*,/,
    allow: [
      ...PRACTICE,
    ],
  },
  {
    id: 'start-to-start-rest',
    why: '선수 휴식은 앞 경기 종료→다음 경기 시작(shared/rules/scheduling.ts, schedule.minRestMinutes). 시작~시작 모델 금지.',
    pattern: /TODO\(B6|\bplayerRest\b|playerRestMinutes:\s*matchDur/,
    allow: [],
  },
  {
    id: 'legacy-outcome-field-read',
    why: '레거시 대회 필드를 직접 읽어 판정한다. resolveCompetitionRules / resolveMatchScoring이 레거시 필드를 읽어 준다.',
    pattern: /rankingMatchConfig\??\.(fifthToEighth|fifthToEighthFormat|classificationGroups|classificationGroupSize|rankingUpTo|rankingSetsToWin|rankingWinScore|thirdPlace)\b|finalsConfig\??\.(scoringRules|roundScoringOverride|advancePerGroup|wildcardCount)\b|(gameConfig|teamMatchSettings|scoringRules)\??\.(winScore|setsToWin|timeLimitSeconds|minLead|deuceCap)\b/,
    allow: [],
  },
];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (SKIP_DIRS.some(d => rel === d || rel.startsWith(`${d}/`))) continue;
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(rel);
  }
}

/** 주석을 지운다 (설명 문장 속 옛 이름은 문제가 아니다). 줄 수는 유지한다. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const files: string[] = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

describe('outcome guard: every outcome-deciding value comes from the rules resolver', () => {
  it('scans the app sources', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('src/referee/hooks/useIndividualScoring.ts');
    expect(files).toContain('functions/src/handlers/simulate.ts');
  });

  it.each(RULES.map(r => [r.id, r] as const))('%s', (_id, rule) => {
    const hits: string[] = [];
    for (const rel of files) {
      if (rule.allow.some(a => rel === a || rel.startsWith(a))) continue;
      const lines = stripComments(readFileSync(join(ROOT, rel), 'utf8')).split('\n');
      lines.forEach((line, i) => { if (rule.pattern.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`); });
    }
    expect(hits, `${rule.why}\n${hits.join('\n')}`).toEqual([]);
  });

  it('detects a planted bypass (self-check)', () => {
    const planted = [
      "const win = checkSetWinner(a, b);",
      "const point = isTeam ? 16 : 6;",
      "const target = isTeam ? 31 : 11;",
      "const serves = matchType === 'team' ? 3 : 2;",
      "if ((s1 >= 11 || s2 >= 11) && Math.abs(s1 - s2) >= 2) break;",
      "const n = tour.rankingMatchConfig?.classificationGroupSize;",
    ];
    for (const line of planted) expect(RULES.some(r => r.pattern.test(line)), line).toBe(true);
  });
});
