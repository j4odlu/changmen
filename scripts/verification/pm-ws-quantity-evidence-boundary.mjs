import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 只登记 WS 数量诊断增量；成交/拒单/补单与固定 FOK 基线保持原样。
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { createHash } from "node:crypto";
import { restoreVenueBrowserExecution } from './venue-browser-execution.mjs';
const normalize = source => source.replaceAll("\r\n", "\n");
const digest = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = normalize(readAdapterHistory(new URL("./pm-ws-quantity-evidence-increments.json", import.meta.url), "utf8"));
assert.equal(digest(text), "e8634befe97af82bd083565b9182fe3c24342ca7b701d70c2c57f1ebf9da8b74", "WS evidence increments stay fixed");
const row = JSON.parse(text);
export function restorePmWsQuantityEvidenceSource(file, source, read = file => readAdapterHistory(file, "utf8"), required = false) {
  if (file !== row.file) return source;
  let restored = normalize(source);
  if (!required && !restored.includes('import { polymarketWsQuantityEvidence }')) return restored;
  assert.equal(digest(restored), row.afterSha, "exact diagnostic-only WS change");
  assert.equal(digest(restoreVenueBrowserExecution(row.helper, read(row.helper))), row.helperSha, "exact bounded WS field evidence helper");
  for (const addition of row.additions) {
    assert.equal(restored.split(addition).length, 2, "unique WS evidence increment");
    restored = restored.replace(addition, "");
  }
  assert.equal(digest(restored), row.beforeSha, "original trace outside evidence additions stays fixed");
  return restored;
}
