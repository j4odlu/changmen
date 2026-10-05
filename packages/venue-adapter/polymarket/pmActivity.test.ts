import { describe, expect, it, vi } from "vitest";
import {
  matchPolymarketActivityBuyCost,
  parsePolymarketActivityBuyCost,
} from "./pmActivity";

describe("parsePolymarketActivityBuyCost", () => {
  it("parses sports buy: usdcSize = notional + fee", () => {
    // 6 shares @ 0.62 sports fee 0.07068 → usdc 3.79068
    const cost = parsePolymarketActivityBuyCost({
      type: "TRADE",
      side: "BUY",
      price: 0.62,
      size: 6,
      usdcSize: 3.79068,
      conditionId: "0xabc",
      timestamp: 1_700_000_000,
    });
    expect(cost).toMatchObject({
      matchPrice: 0.62,
      shares: 6,
      usdcSize: 3.7907,
      feeUsdc: 0.0707,
    });
    expect(cost!.allInAvgPrice).toBeCloseTo(3.79068 / 6, 5);
  });

  it("treats free-market usdcSize=price*size as zero fee", () => {
    const cost = parsePolymarketActivityBuyCost({
      type: "TRADE",
      side: "BUY",
      price: 0.5,
      size: 100,
      usdcSize: 50,
    });
    expect(cost?.feeUsdc).toBe(0);
    expect(cost?.allInAvgPrice).toBe(0.5);
  });

  it("rejects sell / bad rows", () => {
    expect(parsePolymarketActivityBuyCost({
      type: "TRADE",
      side: "SELL",
      price: 0.5,
      size: 10,
      usdcSize: 5,
    })).toBeNull();
    expect(parsePolymarketActivityBuyCost({
      type: "TRADE",
      side: "BUY",
      price: 0.5,
      size: 10,
      usdcSize: 4,
    })).toBeNull();
  });
});

describe("matchPolymarketActivityBuyCost", () => {
  it("picks nearest size+condition match", () => {
    const rows = [
      {
        type: "TRADE",
        side: "BUY",
        price: 0.4,
        size: 25,
        usdcSize: 10.3,
        conditionId: "0xcond",
        timestamp: 1_700_000_100,
      },
      {
        type: "TRADE",
        side: "BUY",
        price: 0.5,
        size: 99,
        usdcSize: 50,
        conditionId: "0xcond",
        timestamp: 1_700_000_100,
      },
    ];
    const hit = matchPolymarketActivityBuyCost(rows, {
      conditionId: "0xcond",
      shares: 25,
      createAtMs: 1_700_000_100_000,
    });
    expect(hit?.shares).toBe(25);
    expect(hit?.feeUsdc).toBeCloseTo(0.3, 4);
    expect(hit?.allInAvgPrice).toBeCloseTo(10.3 / 25, 6);
  });

  it("refuses to match when neither conditionId nor tokenId provided", () => {
    const hit = matchPolymarketActivityBuyCost([{
      type: "TRADE",
      side: "BUY",
      price: 0.4,
      size: 25,
      usdcSize: 10.3,
      conditionId: "0xcond",
      timestamp: 1_700_000_100,
    }], {
      shares: 25,
      createAtMs: 1_700_000_100_000,
    });
    expect(hit).toBeNull();
  });

  it("prefers transactionHash 1:1 over size/time scoring", () => {
    const tx =
      "0xdd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917";
    const rows = [
      {
        type: "TRADE",
        side: "BUY",
        price: 0.4,
        size: 25,
        usdcSize: 10.3,
        conditionId: "0xcond",
        timestamp: 1_700_000_100,
        transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        type: "TRADE",
        side: "BUY",
        price: 0.62,
        size: 6,
        usdcSize: 3.79068,
        conditionId: "0xcond",
        timestamp: 1_700_000_999,
        transactionHash: tx,
      },
    ];
    // 份额更接近第一行，但有 tx 时应精确命中第二行
    const hit = matchPolymarketActivityBuyCost(rows, {
      conditionId: "0xcond",
      shares: 25,
      createAtMs: 1_700_000_100_000,
      transactionHashes: [tx],
    });
    expect(hit?.shares).toBe(6);
    expect(hit?.usdcSize).toBeCloseTo(3.7907, 4);
    expect(hit?.transactionHash).toBe(tx);
  });

  it("does not fuzzy-fallback when tx hashes provided but missing from activity", () => {
    const missing =
      "0xdd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917";
    const hit = matchPolymarketActivityBuyCost([{
      type: "TRADE",
      side: "BUY",
      price: 0.4,
      size: 25,
      usdcSize: 10.3,
      conditionId: "0xcond",
      timestamp: 1_700_000_100,
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }], {
      conditionId: "0xcond",
      shares: 25,
      createAtMs: 1_700_000_100_000,
      transactionHashes: [missing],
    });
    expect(hit).toBeNull();
  });

  it("scopes shared tx hash by tokenId to avoid cross-market collision", () => {
    const tx =
      "0xdd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917";
    const rows = [
      {
        type: "TRADE",
        side: "BUY",
        price: 0.4,
        size: 25,
        usdcSize: 10.3,
        conditionId: "0xcond-a",
        asset: "token-a",
        timestamp: 1_700_000_100,
        transactionHash: tx,
      },
      {
        type: "TRADE",
        side: "BUY",
        price: 0.62,
        size: 6,
        usdcSize: 3.79068,
        conditionId: "0xcond-b",
        asset: "token-b",
        timestamp: 1_700_000_100,
        transactionHash: tx,
      },
    ];
    const hit = matchPolymarketActivityBuyCost(rows, {
      conditionId: "0xcond-b",
      tokenId: "token-b",
      transactionHashes: [tx],
    });
    expect(hit?.shares).toBe(6);
    expect(hit?.usdcSize).toBeCloseTo(3.7907, 4);
  });
});

describe("resolvePolymarketBuyCostFromActivity (http)", () => {
  it("returns null when fetch empty", async () => {
    vi.resetModules();
    vi.doMock("./transport", () => ({
      polymarketPluginGet: vi.fn(async () => ({ data: [], pagination: { has_more: false, next_cursor: null } })),
    }));
    const { resolvePolymarketBuyCostFromActivity } = await import("./pmActivity");
    const cost = await resolvePolymarketBuyCostFromActivity(
      "0x47c9014f76660cd2efe17c1f5ea342fd12cd2038",
      { conditionId: "0xmissing", shares: 1 },
    );
    expect(cost).toBeNull();
  });
});
