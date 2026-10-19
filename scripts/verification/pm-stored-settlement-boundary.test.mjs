import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { restorePmStoredSettlementSource } from "./pm-stored-settlement-boundary.mjs";
import { restorePmOrderBetLabelSource } from "./pm-order-bet-label-boundary.mjs";
const file = "packages/venue-adapter/polymarket/orders/history/orders.ts";
const readBeforeExecution = withAdapterHistoryReader(f => readAdapterHistory(f, "utf8"));
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
describe("stored PM settlement exact change boundary", () => {
  it("restores this correction before the original label and financial baseline checks", () => {
    expect(restorePmStoredSettlementSource(file, read(file))).not.toContain("needsStoredMarketSettlement");
    expect(restorePmOrderBetLabelSource(file, read(file), read)).not.toContain("lookupPolymarketOrderBetLabel");
  });
  it("rejects modified eligibility or settlement fields", () => {
    for (const [before, after] of [["> 0.0001", "> -1"], ['? "win" : "lose"', '? "lose" : "win"']]) {
      const source = read(file);
      const offset = source.indexOf("function needsStoredMarketSettlement(");
      expect(() => restorePmStoredSettlementSource(file, source.slice(0, offset) + source.slice(offset).replace(before, after))).toThrow();
    }
  });
});
