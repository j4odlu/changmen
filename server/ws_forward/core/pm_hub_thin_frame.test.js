import { splitPmControlFrames } from "./pm_hub_thin_frame.js";
import { afterEach, describe, expect, test } from "vitest";
import {
  bestAskFromBookAsks,
  buildThinBestBidAskFrame,
  extractThinBestAskUpdates,
  isPmHubThinFramesEnabled,
  thinPmMarketFrames,
} from "./pm_hub_thin_frame.js";

describe("pm_hub_thin_frame", () => {
  afterEach(() => {
    delete process.env.PM_HUB_THIN_FRAMES;
  });

  test("best_bid_ask — mirrors client collect.test", () => {
    expect(extractThinBestAskUpdates(JSON.stringify({
      event_type: "best_bid_ask",
      asset_id: "asset-home",
      best_ask: "0.51",
    }))).toEqual([{ assetId: "asset-home", bestAsk: "0.51" }]);
  });

  test("price_change — nested best_ask; skip missing best_ask", () => {
    expect(extractThinBestAskUpdates(JSON.stringify([{
      event_type: "price_change",
      market: "0xabc",
      price_changes: [
        { asset_id: "asset-home", price: "0.52", size: "100", side: "BUY", best_ask: "0.53" },
        { asset_id: "asset-away", price: "0.47", size: "80", side: "BUY", best_ask: "0.49" },
        { asset_id: "no-ask" },
      ],
    }]))).toEqual([
      { assetId: "asset-home", bestAsk: "0.53" },
      { assetId: "asset-away", bestAsk: "0.49" },
    ]);
  });

  test("book — lowest non-zero size ask", () => {
    expect(extractThinBestAskUpdates(JSON.stringify({
      event_type: "book",
      asset_id: "asset-home",
      market: "0xabc",
      bids: [{ price: "0.48", size: "200" }],
      asks: [
        { price: "0.62", size: "0" },
        { price: "0.58", size: "10" },
        { price: "0.60", size: "5" },
      ],
    }))).toEqual([{ assetId: "asset-home", bestAsk: 0.58 }]);
  });

  test("book — all size 0 yields no update", () => {
    expect(extractThinBestAskUpdates(JSON.stringify({
      event_type: "book",
      asset_id: "a1",
      asks: [{ price: "0.5", size: "0" }],
    }))).toEqual([]);
  });

  test("bestAskFromBookAsks skips size 0", () => {
    expect(bestAskFromBookAsks([
      { price: "0.62", size: "0" },
      { price: "0.58", size: "10" },
      { price: "0.6", size: "3" },
    ])).toBe(0.58);
  });

  test("PONG and invalid JSON yield empty", () => {
    expect(extractThinBestAskUpdates("PONG")).toEqual([]);
    expect(extractThinBestAskUpdates("{not-json")).toEqual([]);
  });

  test("last_trade_price yields empty (not used by browser quotes)", () => {
    expect(extractThinBestAskUpdates(JSON.stringify({
      event_type: "last_trade_price",
      asset_id: "a1",
      price: "0.5",
    }))).toEqual([]);
  });

  test("thinPmMarketFrames splits multi-asset price_change into one frame per asset", () => {
    const frames = thinPmMarketFrames(JSON.stringify({
      event_type: "price_change",
      price_changes: [
        { asset_id: "a1", best_ask: "0.4" },
        { asset_id: "a2", best_ask: "0.6" },
      ],
    }));
    expect(frames).toHaveLength(2);
    expect(frames[0].assetId).toBe("a1");
    expect(frames[1].assetId).toBe("a2");
    expect(JSON.parse(frames[0].raw)).toEqual({
      event_type: "best_bid_ask",
      asset_id: "a1",
      best_ask: "0.4",
    });
    expect(JSON.parse(frames[1].raw)).toEqual({
      event_type: "best_bid_ask",
      asset_id: "a2",
      best_ask: "0.6",
    });
  });

  test("thin frames keep official timestamp", () => {
    const frames = thinPmMarketFrames(JSON.stringify({
      event_type: "best_bid_ask",
      asset_id: "a1",
      best_ask: "0.41",
      timestamp: "1782753357257",
    }));
    expect(JSON.parse(frames[0].raw)).toEqual({
      event_type: "best_bid_ask",
      asset_id: "a1",
      best_ask: "0.41",
      timestamp: "1782753357257",
    });
  });

  test("buildThinBestBidAskFrame shape", () => {
    expect(JSON.parse(buildThinBestBidAskFrame("x", "0.3"))).toEqual({
      event_type: "best_bid_ask",
      asset_id: "x",
      best_ask: "0.3",
    });
  });

  test("isPmHubThinFramesEnabled default on; off via env", () => {
    delete process.env.PM_HUB_THIN_FRAMES;
    expect(isPmHubThinFramesEnabled()).toBe(true);
    process.env.PM_HUB_THIN_FRAMES = "0";
    expect(isPmHubThinFramesEnabled()).toBe(false);
    process.env.PM_HUB_THIN_FRAMES = "false";
    expect(isPmHubThinFramesEnabled()).toBe(false);
    process.env.PM_HUB_THIN_FRAMES = "1";
    expect(isPmHubThinFramesEnabled()).toBe(true);
  });
});


test("tick control is separated before quote thinning/coalescing even in mixed arrays", () => {
  const tick = { event_type: "tick_size_change", asset_id: "a", new_tick_size: "0.005", timestamp: "1000" };
  const book = { event_type: "book", asset_id: "a", asks: [{ price: "0.5", size: "10" }] };
  const split = splitPmControlFrames(JSON.stringify([tick, book]));
  expect(split.controls).toEqual([{ assetId: "a", raw: JSON.stringify(tick) }]);
  expect(JSON.parse(split.quotes)).toEqual([book]);
});
