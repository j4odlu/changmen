import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { restoreMakeupPrecheckSource } from "./makeup-precheck-boundary.mjs";

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const record = fs.readFileSync(new URL("./makeup-candidates-extraction.json", import.meta.url), "utf8");
assert.equal(sha(record), "fe231ddcb18f5ae9557592db4b5f8b6f0458564b453746f4e2b30e1d9aea2230", "exact makeup candidate extraction record");
export const makeupCandidatesExtraction = JSON.parse(record);
const root = new URL("../../", import.meta.url);

/** [changmen 扩展] 核对纯筛选实现与精确调用替换，再恢复原执行器供既有全文检查。 */
export function restoreMakeupCandidatesSource(file, source, read = target => fs.readFileSync(new URL(target, root), "utf8")) {
  source = restoreMakeupPrecheckSource(file, source, read);
  const entry = makeupCandidatesExtraction;
  if (file !== entry.file || !source.includes('import { selectMakeUpCandidates }'))
    return source;
  assert.equal(sha(read(entry.candidateFile)), entry.candidateSha, "complete extracted makeup candidate selection");
  source = normalize(source);
  for (const [current, previous] of entry.changes) {
    assert.equal(source.split(current).length, 2, "one exact candidate extraction fragment");
    source = source.replace(current, previous);
  }
  assert.equal(sha(source), entry.beforeSha, "complete extracted lose-order execution before candidate extraction");
  return source;
}
