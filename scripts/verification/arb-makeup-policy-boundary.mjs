import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restoreArbMakeUpPendingSource } from "./arb-makeup-pending-boundary.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const record = fs.readFileSync(new URL("./arb-makeup-policy-extraction.json", import.meta.url), "utf8");
assert.equal(sha(record), "9e977d3d1738bd6364feea636728620d16268230063a08f2fc68060c860b43e5", "exact makeup policy extraction record");
export const arbMakeUpPolicyExtraction = JSON.parse(record);
const root = new URL("../../", import.meta.url);

/** [changmen 扩展] 仅还原精确的策略提取；金额、入队和续查副作用仍核对完整原模块。 */
export function restoreArbMakeUpPolicySource(file, source, read = target => fs.readFileSync(new URL(target, root), "utf8")) {
  source = restoreArbMakeUpPendingSource(file, source, read);
  const entry = arbMakeUpPolicyExtraction;
  if (file !== entry.file || !source.includes(entry.changes[0][0]))
    return source;
  assert.equal(sha(read(entry.policyFile)), entry.policySha, "complete extracted makeup policy implementation");
  source = normalize(source);
  for (const [current, previous] of entry.changes) {
    assert.equal(source.split(current).length, 2, "one exact makeup extraction fragment");
    source = source.replace(current, previous);
  }
  assert.equal(sha(source), entry.beforeSha, "complete pre-extraction makeup orchestration");
  return source;
}
