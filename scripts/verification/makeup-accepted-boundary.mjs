import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const record = fs.readFileSync(new URL("./makeup-accepted-extraction.json", import.meta.url), "utf8");
assert.equal(sha(record), "2a1cb5114ada904814a33199f368609124eb5e833d679b9ec149408aabe28d53", "exact makeup accepted-receipt extraction record");
export const makeupAcceptedExtraction = JSON.parse(record);
const root = new URL("../../", import.meta.url);

/** [changmen 扩展] 全文核验受理回执与确认分流提取，再精确恢复原执行器供固定基线检查。 */
export function restoreMakeupAcceptedSource(file, source, read = target => fs.readFileSync(new URL(target, root), "utf8")) {
  const entry = makeupAcceptedExtraction;
  if (file !== entry.file || !source.includes('import { completeAcceptedMakeUpLeg }'))
    return source;
  assert.equal(sha(read(entry.helperFile)), entry.helperSha, "complete extracted makeup accepted-receipt handling");
  source = normalize(source);
  for (const [current, previous] of entry.changes) {
    assert.equal(source.split(current).length, 2, "one exact accepted-receipt extraction fragment");
    source = source.replace(current, previous);
  }
  assert.equal(sha(source), entry.beforeSha, "complete extracted lose-order execution before accepted-receipt extraction");
  return source;
}
