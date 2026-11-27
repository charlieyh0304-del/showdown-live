import { it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 소유자 결정(2026-11-28): 앱이 소리로 읽어 주는 음성 안내 기능은 없앤다.
// 화면낭독기(aria-live)가 안내를 맡고, 음성 출력은 챗봇 패널(향후 음성 대화 모드)에서만 허용한다.
const ALLOWED = new Set(['src/shared/components/AiChatPanel.tsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p.split('\\').join('/'));
  }
  return out;
}

it('음성 합성(speechSynthesis)은 챗봇 패널 밖에서 쓰지 않는다', () => {
  const offenders = walk('src').filter(f => !ALLOWED.has(f) && /speechSynthesis|SpeechSynthesisUtterance/.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
