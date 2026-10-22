import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restoreArbMakeUpEnqueueSource } from "./arb-makeup-enqueue-boundary.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const record = fs.readFileSync(new URL("./arb-makeup-pending-extraction.json", import.meta.url), "utf8");
assert.equal(sha(record), "52069cfc03b241395758d32f10391bbe58b8e2e9cbf926838d9931fc76f153ad", "exact makeup pending extraction record");
export const arbMakeUpPendingExtraction = JSON.parse(record);
const root = new URL("../../", import.meta.url);

/** [changmen 扩展] 原样移出待确认队列交接，再交给既有策略提取保护核对完整原模块。 */
export function restoreArbMakeUpPendingSource(file, source, read = target => fs.readFileSync(new URL(target, root), "utf8")) {
  source = restoreArbMakeUpEnqueueSource(file, source, read);
  const entry = arbMakeUpPendingExtraction;
  if (file !== entry.file || !source.includes('import { resumeArbMakeUpPending }'))
    return source;
  assert.equal(sha(read(entry.pendingFile)), entry.pendingSha, "complete extracted makeup pending implementation");
  source = normalize(source);
  for (const [current, previous] of entry.changes) {
    assert.equal(source.split(current).length, 2, "one exact pending extraction fragment");
    source = source.replace(current, previous);
  }
  assert.equal(sha(source), entry.beforeSha, "complete pre-extraction pending orchestration");
  return source;
}
