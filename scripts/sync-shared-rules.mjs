// src/shared/rules/*.ts(테스트 제외)를 functions/src/shared/rules/로 복사한다.
// functions는 상위 폴더를 import할 수 없으므로(배포 시 functions/만 올라감) 사본을 둔다.
// 사본이 원본과 다르면 functions/src/shared/rules.sync.test.ts가 실패한다.
// 사용: node scripts/sync-shared-rules.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEADER = '// 자동 생성 사본: 원본은 src/shared/rules/. 직접 고치지 말고 node scripts/sync-shared-rules.mjs를 실행하세요.\n';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src/shared/rules');
const dst = join(root, 'functions/src/shared/rules');
mkdirSync(dst, { recursive: true });
const files = readdirSync(src).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
for (const f of readdirSync(dst)) {
  if (f.endsWith('.ts') && !files.includes(f) && !f.endsWith('.test.ts')) rmSync(join(dst, f));
}
for (const f of files) {
  writeFileSync(join(dst, f), HEADER + readFileSync(join(src, f), 'utf8'));
}
console.log(`synced ${files.length} files to functions/src/shared/rules`);
if (!existsSync(dst)) process.exit(1);
