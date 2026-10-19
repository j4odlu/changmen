import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { restorePmStoredMarketRefreshSource } from "./pm-stored-market-refresh-boundary.mjs";
const file = "packages/venue-adapter/polymarket/orders/history/orders.ts";
it("restores the complete pre-fix order implementation without changing execution or financial rules", () => {
  const expected = execFileSync("git", ["show", `ae6b3c21:${file}`], { encoding: "utf8" }).replace(/\r\n/g, "\n");
  expect(restorePmStoredMarketRefreshSource(file, restoreVenueBrowserExecution(file, readAdapterHistory(file, "utf8")))).toBe(expected);
});
it("rejects a change that makes cached history override current facts", () => {
  const source = restoreVenueBrowserExecution(file, readAdapterHistory(file, "utf8")).replace("[...historicalMarkets, ...currentMarkets]", "[...currentMarkets, ...historicalMarkets]");
  expect(() => restorePmStoredMarketRefreshSource(file, source)).toThrow();
});
