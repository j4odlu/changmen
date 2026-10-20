import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 优化 FOK 的精确增量；还原后继续核验原有固定基线，不改旧基线。
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { restorePmAccountSigningSource } from "./pm-account-signing-boundary.mjs";
import { createHash } from "node:crypto";
const normalize = value => value.replaceAll("\r\n", "\n");
const digest = value => createHash("sha256").update(normalize(value)).digest("hex");
const text = normalize(readAdapterHistory(new URL("./pm-optimized-fok-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "d1ac46e2b0cbff0890be5d4c0d5aa46ff17c448c23f867b40a9f83b49f32a996", "optimized FOK reviewed increments stay fixed");
const registered = JSON.parse(text);
export function restorePmOptimizedFokSource(file, source, required = false) {
  source = restorePmAccountSigningSource(file, source);
  const row = registered.changes[file];
  if (!row) return source;
  let result = normalize(source);
  if (!required && !row.increments.some(([, after]) => result.includes(after))) return result;
  for (const [before, after] of row.increments) {
    assert.equal(result.split(after).length, 2, file + ": exact captured FOK mode isolation / optimized increment");
    result = result.replace(after, before);
  }
  return result;
}
export function verifyPmOptimizedFokContract(read) {
  for (const [file, row] of Object.entries(registered.changes)) {
    const restored = restorePmOptimizedFokSource(file, read(file), true);
    assert.equal(digest(restored), row.beforeSha, file + ": original implementation unchanged outside optimized increments");
  }
  for (const [file, hash] of Object.entries(registered.helpers))
    assert.equal(digest(restorePmAccountSigningSource(file, read(file))), hash, file + ": complete optimized FOK helper");
}
