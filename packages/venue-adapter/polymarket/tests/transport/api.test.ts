import { describe, expect, test } from "vitest";
import {
  POLYMARKET_CLOB_API,
  POLYMARKET_GAMMA_API,
  POLYMARKET_MARKET_WS,
  polymarketMarketSubscribeMessage,
  polymarketUserSubscribeMessage,
  polymarketUserSubscribeMoreMessage,
} from "../../api";

describe("Polymarket API (quote endpoints / WS messages)", () => {
  test("does not export list discovery helpers (VPS collector owns discovery)", async () => {
    const mod = await import("../../api");
    expect("fetchPolymarketEsportsMarkets" in mod).toBe(false);
    expect("fetchPolymarketMarkets" in mod).toBe(false);
    expect("fetchBatchBuyPrices" in mod).toBe(false);
    expect("fetchPolymarketBook" in mod).toBe(false);
    expect("polymarketCollectStartTimeAllowed" in mod).toBe(false);
  });

  test("exposes official base URLs", () => {
    expect(POLYMARKET_GAMMA_API).toContain("gamma-api.polymarket.com");
    expect(POLYMARKET_CLOB_API).toContain("clob.polymarket.com");
    expect(POLYMARKET_MARKET_WS).toContain("ws-subscriptions-clob.polymarket.com");
  });

  test("builds market subscribe payload", () => {
    const msg = JSON.parse(polymarketMarketSubscribeMessage(["a", "b"], false));
    expect(msg).toMatchObject({
      assets_ids: ["a", "b"],
      type: "market",
      initial_dump: false,
    });
  });

  test("builds user channel subscribe payloads", () => {
    expect(polymarketUserSubscribeMessage(
      { apiKey: "k", secret: "s", passphrase: "p" },
      ["0x1"],
    )).toMatchObject({
      auth: { apiKey: "k", secret: "s", passphrase: "p" },
      markets: ["0x1"],
      type: "user",
    });
    expect(polymarketUserSubscribeMoreMessage(["0x2"])).toEqual({
      markets: ["0x2"],
      operation: "subscribe",
    });
  });
});
