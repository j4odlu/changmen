import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restoreMakeupAcceptedSource } from "./makeup-accepted-boundary.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const record = fs.readFileSync(new URL("./makeup-precheck-extraction.json", import.meta.url), "utf8");
assert.equal(sha(record), "16ba00f0c2926a2bcbde545eac3a88acbff3e9a557482d8ee7d47acebdf08858", "exact makeup precheck extraction record");
export const makeupPrecheckExtraction = JSON.parse(record);
const root = new URL("../../", import.meta.url);

/** [changmen 扩展] 全文核验原门控的提取实现与调用位置，再恢复供既有固定基线检查。 */
export function restoreMakeupPrecheckSource(file, source, read = target => fs.readFileSync(new URL(target, root), "utf8")) {
  source = restoreMakeupAcceptedSource(file, source, read);
  const entry = makeupPrecheckExtraction;
  if (file !== entry.file || !source.includes('import { passesMakeUpPrecheck }'))
    return source;
  assert.equal(sha(read(entry.helperFile)), entry.helperSha, "complete extracted makeup precheck gate");
  source = normalize(source);
  for (const [current, previous] of entry.changes) {
    assert.equal(source.split(current).length, 2, "one exact precheck extraction fragment");
    source = source.replace(current, previous);
  }
  assert.equal(sha(source), entry.beforeSha, "complete extracted lose-order execution before precheck extraction");
  return source;
}
