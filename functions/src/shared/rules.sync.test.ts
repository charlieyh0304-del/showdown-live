import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// 이 폴더(functions/src/shared/rules)는 src/shared/rules의 사본이어야 한다 (node scripts/sync-shared-rules.mjs)
const HEADER = "// 자동 생성 사본: 원본은 src/shared/rules/. 직접 고치지 말고 node scripts/sync-shared-rules.mjs를 실행하세요.\n";
const src = join(__dirname, "../../../src/shared/rules");
const dst = join(__dirname, "rules");

describe("shared rules copy", () => {
  const files = existsSync(src) ? readdirSync(src).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")) : [];
  it("source folder exists", () => expect(files.length).toBeGreaterThan(0));
  it.each(files)("%s matches the original", f => {
    expect(readFileSync(join(dst, f), "utf8")).toBe(HEADER + readFileSync(join(src, f), "utf8"));
  });
});
