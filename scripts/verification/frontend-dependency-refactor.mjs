// [changmen 扩展] 精确认证依赖注入与纯模块提取，不替换原有 FOK、迁移或冻结基线。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restorePendingVenueFixSource } from "./pending-venue-fixes.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./frontend-dependency-refactor.json", import.meta.url), "utf8");
assert.equal(sha(text), "fa3559805aa32d7654d59b59c0d2542baa2532a13f297093f72f62a1c3c3de1f", "Frontend dependency repair inventory changed");
export const FRONTEND_DEPENDENCY_REFACTOR = JSON.parse(text);
assert.equal(FRONTEND_DEPENDENCY_REFACTOR.purpose, "frontend-dependency-injection-only");
const rows = new Map(FRONTEND_DEPENDENCY_REFACTOR.files.map(row => [row.file, row]));
export const frontendDependencyFiles = new Set(rows.keys());

export function restoreFrontendDependencySource(file, source) {
  source = restorePendingVenueFixSource(file, source);
  const row = rows.get(file);
  if (!row || sha(source) !== row.afterSha) return source;
  source = normalize(source);
  for (const edit of [...row.edits].reverse()) {
    assert.equal(source.slice(edit.offset, edit.offset + edit.after.length), edit.after, `${file}: exact dependency repair`);
    source = source.slice(0, edit.offset) + edit.before + source.slice(edit.offset + edit.after.length);
  }
  assert.equal(sha(source), row.beforeSha, `${file}: original complete source must restore`);
  return source;
}

export function verifyFrontendDependencyRefactor(read) {
  for (const row of rows.values()) {
    const source = restorePendingVenueFixSource(row.file, read(row.file));
    assert.equal(sha(source), row.afterSha, `${row.file}: unreviewed dependency repair`);
    assert.equal(sha(restoreFrontendDependencySource(row.file, source)), row.beforeSha);
  }
  for (const row of FRONTEND_DEPENDENCY_REFACTOR.assets)
    assert.equal(sha(read(row.file)), row.sha, `${row.file}: extracted implementation changed`);
  return { files: rows.size, assets: FRONTEND_DEPENDENCY_REFACTOR.assets.length };
}
