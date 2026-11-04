import { describe, expect, test } from "vitest";
import {
  getPolymarketMarketBlockReason,
  isPolymarketSubmitTimeoutError,
  isPolymarketTradingDisabledError,
} from "@changmen/venue-browser/polymarket/markets/pmMarketGuard";
import type { PolymarketRawMarket } from "@changmen/venue-browser/polymarket/markets/parse";

describe("getPolymarketMarketBlockReason", () => {
  const clobV1: PolymarketRawMarket = {
    version: "v1", active: true, closed: false, accepting_orders: true,
    tokens: [{ token_id: "101", winner: false }, { token_id: "102", winner: false }],
  };

  test("reads CLOB v1 token rows without treating Gamma's missing fields as a conflict", () => {
    expect(getPolymarketMarketBlockReason(clobV1, "101", "clob")).toBeNull();
    expect(getPolymarketMarketBlockReason(clobV1, "102", "clob")).toBeNull();
    expect(getPolymarketMarketBlockReason(clobV1, "999", "clob")).toContain("不一致");
    expect(getPolymarketMarketBlockReason(clobV1, "101")).toContain("不一致");
  });

  test.each([
    { clobTokenIds: [] },
    { clob_token_ids: '["201","202"]' },
    { tokens: [{ token_id: "101" }, { token_id: "101" }] },
    { tokens: [{ token_id: "101" }, {}] },
    { tokens: [{ token_id: 101 }, { token_id: 102 }] },
    { version: "v2", positionIds: ["201", "202"] },
  ])("CLOB token rows cannot override conflicting or invalid identity %j", extra => {
    expect(getPolymarketMarketBlockReason({ ...clobV1, ...extra } as PolymarketRawMarket, "101", "clob")).toContain("不一致");
  });

  test("accepts CLOB V2 token rows only with an explicit CLOB source and retains V2 identity checks", () => {
    const market = { ...clobV1, version: "v2", clobTokenIds: '["901","902"]' };
    expect(getPolymarketMarketBlockReason(market, "101", "clob")).toBeNull();
    expect(getPolymarketMarketBlockReason(market, "901", "clob")).toContain("不一致");
    expect(getPolymarketMarketBlockReason(market, "101")).toContain("不一致");
    for (const positionIds of [[], '["101","102"]', [101, 102], ["101", "101"]]) {
      expect(getPolymarketMarketBlockReason({ ...market, positionIds }, "101", "clob")).toContain("不一致");
    }
    expect(getPolymarketMarketBlockReason({ ...market, position_ids: ["201", "202"] }, "101", "clob")).toContain("不一致");
  });

  test("preserves CLOB winner and trading state guards with versioned token rows", () => {
    const resolved = { ...clobV1, tokens: [{ token_id: "101", winner: false }, { token_id: "102", winner: true }] };
    expect(getPolymarketMarketBlockReason(resolved, "101", "clob")).toContain("已决出胜负");
    expect(getPolymarketMarketBlockReason(resolved, "102", "clob")).toBeNull();
    expect(getPolymarketMarketBlockReason({ ...clobV1, closed: true }, "101", "clob")).toContain("已关闭");
    expect(getPolymarketMarketBlockReason({ ...clobV1, accepting_orders: false }, "101", "clob")).toContain("已停止交易");
    expect(getPolymarketMarketBlockReason({ ...clobV1, version: "v3" }, "101", "clob")).toContain("版本不支持");
  });

  test("checks V2 prices against position IDs and blocks CTF or unsupported identities", () => {
    const market = { version: "v2", positionIds: ["201", "202"], clobTokenIds: '["101","102"]', outcomePrices: '["0.01","0.99"]' };
    expect(getPolymarketMarketBlockReason(market, "201")).toContain("几乎不可能");
    expect(getPolymarketMarketBlockReason(market, "101")).toContain("不一致");
    expect(getPolymarketMarketBlockReason({ ...market, version: "v3" }, "201")).toContain("版本不支持");
    expect(getPolymarketMarketBlockReason({ ...market, version: undefined }, "201")).toContain("不一致");
  });
  test("endpoint prices only apply the underdog guard and do not declare an official result", () => {
    const market: PolymarketRawMarket = {
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.0005", "0.9995"]),
      closed: false,
    };
    const reason = getPolymarketMarketBlockReason(market, "101");
    expect(reason).toContain("几乎不可能");
    expect(reason).not.toContain("市场已决出胜负");
  });

  test("soft-blocks heavy underdog without resolved market", () => {
    const softMarket: PolymarketRawMarket = {
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.05", "0.92"]),
      closed: false,
    };
    expect(getPolymarketMarketBlockReason(softMarket, "101")).toContain("几乎不可能");
  });

  test("blocks when market is closed or archived", () => {
    expect(getPolymarketMarketBlockReason({
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      closed: true,
    }, "101")).toContain("已关闭");
    expect(getPolymarketMarketBlockReason({
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      archived: true,
    }, "101")).toContain("已关闭");
  });

  test("blocks when active is false", () => {
    expect(getPolymarketMarketBlockReason({
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      active: false,
    }, "101")).toContain("未开放");
  });

  test("blocks when acceptingOrders is false", () => {
    const market: PolymarketRawMarket = {
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      acceptingOrders: false,
    };
    expect(getPolymarketMarketBlockReason(market, "101")).toContain("已停止交易");
  });

  test("blocks when enable_order_book is false", () => {
    expect(getPolymarketMarketBlockReason({
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
      enable_order_book: false,
    }, "101")).toContain("已停止交易");
  });

  test("does not block when acceptingOrders is omitted", () => {
    const market: PolymarketRawMarket = {
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.5", "0.5"]),
    };
    expect(getPolymarketMarketBlockReason(market, "101")).toBeNull();
  });

  test("allows buying favorite when price resolved", () => {
    const market: PolymarketRawMarket = {
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.0005", "0.9995"]),
      closed: false,
    };
    expect(getPolymarketMarketBlockReason(market, "102")).toBeNull();
  });

  test("blocks loser via official tokens[].winner without price ≥0.99", () => {
    const official: PolymarketRawMarket = {
      version: "v1", clobTokenIds: JSON.stringify(["101", "102"]),
      outcomePrices: JSON.stringify(["0.45", "0.55"]),
      closed: false,
      tokens: [
        { token_id: "101", outcome: "Home", price: 0.45, winner: false },
        { token_id: "102", outcome: "Away", price: 0.55, winner: true },
      ],
    };
    expect(getPolymarketMarketBlockReason(official, "101")).toContain("市场已决出胜负");
    expect(getPolymarketMarketBlockReason(official, "102")).toBeNull();
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
