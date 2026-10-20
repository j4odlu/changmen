import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 只放行历史公开盘口后台补查；仍逐字恢复原成交/财务实现。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { restoreVenueBrowserExecution } from './venue-browser-execution.mjs';
const changes = JSON.parse(readAdapterHistory(new URL("./pm-stored-market-refresh-increments.json", import.meta.url), "utf8"));
export function restorePmStoredMarketRefreshSource(file, input) {
  let source = input.replace(/\r\n/g, "\n");
  if (file !== changes.file || !source.includes('import { storedMarketRefresh }')) return source;
  const helper = restoreVenueBrowserExecution(changes.helper, readAdapterHistory(new URL(`../../${changes.helper}`, import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(helper).digest("hex"), changes.helperSha, "exact bounded historical market refresh");
  for (const change of changes.changes) {
    assert.equal(source.split(change.after).length - 1, 1, "exact nonblocking historical market lookup");
    source = source.replace(change.after, change.before);
  }
  return source;
}
