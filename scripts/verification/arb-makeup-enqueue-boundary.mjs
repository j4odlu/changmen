import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restoreLoseOrderExecutionSource } from "./lose-order-execution-boundary.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const record = fs.readFileSync(new URL("./arb-makeup-enqueue-extraction.json", import.meta.url), "utf8");
assert.equal(sha(record), "30ac6618ddc10dc5b7722b73c3bf7e5ce3761c68974bb99f6f94626691bf27ae", "exact makeup enqueue extraction record");
export const arbMakeUpEnqueueExtraction = JSON.parse(record);
const root = new URL("../../", import.meta.url);

/** [changmen 扩展] 精确还原正常补单入队及成功腿参考值的提取，继续保护完整原模块。 */
export function restoreArbMakeUpEnqueueSource(file, source, read = target => fs.readFileSync(new URL(target, root), "utf8")) {
  source = restoreLoseOrderExecutionSource(file, source, read);
  const entry = arbMakeUpEnqueueExtraction;
  if (file !== entry.file || !source.includes('import { enqueueArbMakeUpSide }'))
    return source;
  assert.equal(sha(read(entry.enqueueFile)), entry.enqueueSha, "complete extracted makeup enqueue implementation");
  source = normalize(source);
  for (const [current, previous] of entry.changes) {
    assert.equal(source.split(current).length, 2, "one exact enqueue extraction fragment");
    source = source.replace(current, previous);
  }
  assert.equal(sha(source), entry.beforeSha, "unregistered protected source difference: complete pre-extraction enqueue orchestration");
  return source;
}
