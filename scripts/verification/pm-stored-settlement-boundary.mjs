import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 142 份订单漏赛果修复的精确增量；仍还原并校验原执行/财务基线。
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { restorePmStoredMarketRefreshSource } from "./pm-stored-market-refresh-boundary.mjs";
const changes = JSON.parse(readAdapterHistory(new URL("./pm-stored-settlement-increments.json", import.meta.url), "utf8"));
export function restorePmStoredSettlementSource(file, input) {
  let source = restorePmStoredMarketRefreshSource(file, input);
  if (file !== changes.file || !source.includes("function needsStoredMarketSettlement(")) return source;
  for (const change of changes.changes) {
    assert.equal(source.split(change.after).length - 1, 1, "exact stored PM settlement correction");
    source = source.replace(change.after, change.before);
  }
  return source;
}
