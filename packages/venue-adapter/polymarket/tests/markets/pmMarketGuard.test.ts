import { describe, expect, test } from "vitest";
import {
  getPolymarketMarketBlockReason,
  isPolymarketSubmitTimeoutError,
  isPolymarketTradingDisabledError,
} from "@changmen/venue-browser/polymarket/markets/pmMarketGuard";
import type { PolymarketRawMarket } from "@changmen/venue-browser/polymarket/markets/parse";

describe("getPolymarketMarketBlockReason", () => {
  test("endpoint prices only apply the underdog guard and do not declare an official result", () => {
    const market: PolymarketRawMarket = {
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.0005", "0.9995"]),
      closed: false,
    };
    const reason = getPolymarketMarketBlockReason(market, "token-home");
    expect(reason).toContain("几乎不可能");
    expect(reason).not.toContain("市场已决出胜负");
  });

  test("soft-blocks heavy underdog without resolved market", () => {
    const softMarket: PolymarketRawMarket = {
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.05", "0.92"]),
      closed: false,
    };
    expect(getPolymarketMarketBlockReason(softMarket, "token-home")).toContain("几乎不可能");
  });

  test("blocks when market is closed or archived", () => {
    expect(getPolymarketMarketBlockReason({
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      closed: true,
    }, "token-home")).toContain("已关闭");
    expect(getPolymarketMarketBlockReason({
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      archived: true,
    }, "token-home")).toContain("已关闭");
  });

  test("blocks when active is false", () => {
    expect(getPolymarketMarketBlockReason({
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      active: false,
    }, "token-home")).toContain("未开放");
  });

  test("blocks when acceptingOrders is false", () => {
    const market: PolymarketRawMarket = {
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      acceptingOrders: false,
    };
    expect(getPolymarketMarketBlockReason(market, "token-home")).toContain("已停止交易");
  });

  test("blocks when enable_order_book is false", () => {
    expect(getPolymarketMarketBlockReason({
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      enable_order_book: false,
    }, "token-home")).toContain("已停止交易");
  });

  test("does not block when acceptingOrders is omitted", () => {
    const market: PolymarketRawMarket = {
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
    };
    expect(getPolymarketMarketBlockReason(market, "token-home")).toBeNull();
  });

  test("allows buying favorite when price resolved", () => {
    const market: PolymarketRawMarket = {
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.0005", "0.9995"]),
      closed: false,
    };
    expect(getPolymarketMarketBlockReason(market, "token-away")).toBeNull();
  });

  test("blocks loser via official tokens[].winner without price ≥0.99", () => {
    const official: PolymarketRawMarket = {
      clob_token_ids: JSON.stringify(["token-home", "token-away"]),
      outcomePrices: JSON.stringify(["0.45", "0.55"]),
      closed: false,
      tokens: [
        { token_id: "token-home", outcome: "Home", price: 0.45, winner: false },
        { token_id: "token-away", outcome: "Away", price: 0.55, winner: true },
      ],
    };
    expect(getPolymarketMarketBlockReason(official, "token-home")).toContain("市场已决出胜负");
    expect(getPolymarketMarketBlockReason(official, "token-away")).toBeNull();
  });
});

describe("isPolymarketTradingDisabledError", () => {
  test("matches CLOB JSON and Error snippets", () => {
    expect(isPolymarketTradingDisabledError('{"error":"trading is disabled"}')).toBe(true);
    expect(isPolymarketTradingDisabledError(new Error('{"error":"trading is disabled"}'))).toBe(true);
    expect(isPolymarketTradingDisabledError({ error: "trading is disabled" })).toBe(true);
    expect(isPolymarketTradingDisabledError("FOK 未成交")).toBe(false);
  });
});

describe("isPolymarketSubmitTimeoutError", () => {
  test("matches axios / esport timeout wrappers", () => {
    expect(isPolymarketSubmitTimeoutError(new Error("timeout of 15000ms exceeded"))).toBe(true);
    expect(isPolymarketSubmitTimeoutError(new Error("PM API 不可用（Pm_SubmitOrder）：timeout of 15000ms exceeded"))).toBe(true);
    expect(isPolymarketSubmitTimeoutError(new Error("FOK 未成交"))).toBe(false);
  });
});
