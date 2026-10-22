import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restoreMakeupCandidatesSource } from "./makeup-candidates-boundary.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const record = fs.readFileSync(new URL("./lose-order-execution-extraction.json", import.meta.url), "utf8");
assert.equal(sha(record), "822752f2e34463cb903941978014aa6818011fbd72372d8452e70d4965706655", "exact lose-order dependency extraction record");
export const loseOrderExecutionExtraction = JSON.parse(record);
const root = new URL("../../", import.meta.url);

/** [changmen 扩展] 两个新模块均全文核验后，还原原队列消费模块供既有固定基线检查。 */
export function restoreLoseOrderExecutionSource(file, source, read = target => fs.readFileSync(new URL(target, root), "utf8")) {
  source = restoreMakeupCandidatesSource(file, source, read);
  const entry = loseOrderExecutionExtraction;
  if (file !== entry.file || !source.includes('import { runLoseOrderExecution }'))
    return source;
  assert.equal(sha(source), entry.facadeSha, "complete lose-order dependency assembly");
  assert.equal(sha(restoreMakeupCandidatesSource(entry.executionFile, read(entry.executionFile), read)), entry.executionSha, "complete extracted lose-order execution");
  assert.equal(sha(entry.before), entry.beforeSha, "complete original lose-order execution snapshot");
  return entry.before;
}
