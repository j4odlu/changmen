import { beforeEach, describe, expect, it } from "vitest";
import {
  bumpPolymarketOrderSyncAfterBet,
  markPolymarketOrdersSynced,
  PM_FULL_RESYNC_INTERVAL_MS,
  PM_INCREMENTAL_MIN_LOOKBACK_MS,
  PM_OPEN_POSITION_LOOKBACK_MS,
  PM_ORDER_FULL_LOOKBACK_MS,
  resetPolymarketOrderSyncForTest,
  resolvePolymarketTradeLookbackMs,
} from "@changmen/venue-browser/polymarket/orders/history/pmOrderSync";

describe("pmOrderSync", () => {
  beforeEach(() => {
    resetPolymarketOrderSyncForTest();
  });

  it("uses full lookback on first sync", () => {
    expect(resolvePolymarketTradeLookbackMs(47, false, 1_000_000)).toBe(PM_ORDER_FULL_LOOKBACK_MS);
  });

  it("uses incremental lookback after recent sync", () => {
    const now = 10_000_000;
    markPolymarketOrdersSynced(47, PM_ORDER_FULL_LOOKBACK_MS, now - 30 * 60 * 1000);
    const lb = resolvePolymarketTradeLookbackMs(47, false, now);
    expect(lb).toBeGreaterThanOrEqual(PM_INCREMENTAL_MIN_LOOKBACK_MS);
    expect(lb).toBeLessThan(PM_ORDER_FULL_LOOKBACK_MS);
  });

  it("uses 24h lookback when stored has open positions", () => {
    const now = 10_000_000;
    markPolymarketOrdersSynced(47, PM_ORDER_FULL_LOOKBACK_MS, now - 60 * 60 * 1000);
    expect(resolvePolymarketTradeLookbackMs(47, true, now)).toBe(PM_OPEN_POSITION_LOOKBACK_MS);
  });

  it("forces full lookback after resync interval", () => {
    const now = 100_000_000;
    markPolymarketOrdersSynced(47, PM_INCREMENTAL_MIN_LOOKBACK_MS, now - PM_FULL_RESYNC_INTERVAL_MS - 1);
    expect(resolvePolymarketTradeLookbackMs(47, false, now)).toBe(PM_ORDER_FULL_LOOKBACK_MS);
  });

  it("bump after bet widens next incremental window", () => {
    const now = 20_000_000;
    markPolymarketOrdersSynced(47, PM_INCREMENTAL_MIN_LOOKBACK_MS, now - 5 * 60 * 1000);
    bumpPolymarketOrderSyncAfterBet(47, now);
    const lb = resolvePolymarketTradeLookbackMs(47, false, now + 1000);
    expect(lb).toBeGreaterThanOrEqual(PM_INCREMENTAL_MIN_LOOKBACK_MS);
    expect(lb).toBeLessThan(PM_ORDER_FULL_LOOKBACK_MS);
  });
});
