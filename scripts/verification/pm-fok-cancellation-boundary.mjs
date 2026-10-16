// [changmen 扩展] 用户授权的 FOK CANCELLATION 快速收尾；仅还原精确增量，固定基线不变。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
const normalize = source => source.replaceAll("\r\n", "\n");
const digest = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = normalize(fs.readFileSync(new URL("./pm-fok-cancellation-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "28716354fd6009ed82cc23a36da6fa0532034b9e8c31d443e462a90466016a8c", "reviewed FOK cancellation increments stay fixed");
const registered = JSON.parse(text);
export function restorePmFokCancellationSource(file, source, required = false) {
  const row = registered.changes[file];
  if (!row) return source;
  let restored = normalize(source);
  if (!required && !row.increments.some(([, after]) => restored.includes(after))) return restored;
  for (const [before, after] of row.increments) {
    assert.equal(restored.split(after).length, 2, file + ": exact FOK cancellation increment");
    restored = restored.replace(after, before);
  }
  return restored;
}
export function verifyPmFokCancellationContract(read) {
  for (const [file, row] of Object.entries(registered.changes)) {
    const restored = restorePmFokCancellationSource(file, read(file), true);
    // bet.ts 的完整源码继续由既有预检/提交固定基线验证，不能固定到其它未提交改动。
    if (row.beforeSha) assert.equal(digest(restored), row.beforeSha, file + ": original confirmation outside the authorized change");
  }
  for (const [file, expected] of Object.entries(registered.helpers))
    assert.equal(digest(read(file)), expected, file + ": complete FOK-only cancellation policy");
}
