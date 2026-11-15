import { describe, expect, it, vi } from "vitest";
import {
  matchPolymarketActivityBuyCost,
  matchPolymarketActivityCashByTxHashes,
  parsePolymarketActivityBuyCost,
} from "@changmen/venue-browser/polymarket/orders/history/pmActivity";

describe("BUY and SELL share exact activity cash reconciliation", () => {
  const tx = `0x${"a".repeat(64)}`, wallet = `0x${"1".repeat(40)}`;
  const filters = { proxyWallet: wallet, conditionId: "condition", tokenId: "token" };
  const row = { type: "TRADE", side: "SELL", proxyWallet: wallet, conditionId: "condition", asset: "token",
    transactionHash: tx, size: 10, price: .6, usdcSize: 5.88 };
  it.each(["BUY", "SELL"] as const)("uses %s actual cash and exposes the fee without applying it again", side => {
    const data = { ...row, side, usdcSize: side === "BUY" ? 6.12 : 5.88 };
    const result = matchPolymarketActivityCashByTxHashes([data, data], [tx], filters, side);
    expect(result).toMatchObject({ shares: 10, matchPrice: .6, usdcSize: data.usdcSize, feeUsdc: .12 });
  });
  it("keeps full cash precision across transactions, using the buy matcher sum and deduplication", () => {
    const tx2 = `0x${"b".repeat(64)}`;
    const rows = [{ ...row, size: 4, usdcSize: 2.350459 }, { ...row, transactionHash: tx2, size: 6, usdcSize: 3.529549 }];
    expect(matchPolymarketActivityCashByTxHashes(rows, [tx, tx2], filters, "SELL"))
      .toMatchObject({ shares: 10, usdcSize: 5.880008, feeUsdc: .119992 });
  });
  it.each([undefined, null, NaN, -1, 6.1])("rejects missing or invalid SELL cash %s", usdcSize => {
    expect(matchPolymarketActivityCashByTxHashes([{ ...row, usdcSize: usdcSize as number }], [tx], filters, "SELL")).toBeNull();
  });
  it("distinguishes verified zero proceeds from unknown cash", () => {
    expect(matchPolymarketActivityCashByTxHashes([{ ...row, usdcSize: 0 }], [tx], filters, "SELL"))
      .toMatchObject({ shares: 10, usdcSize: 0, feeUsdc: 6 });
  });
});

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
      usdcSize: 3.79068,
      feeUsdc: 0.07068,
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
    vi.doMock("@changmen/venue-browser/polymarket/transport/transport", () => ({
      polymarketPluginGet: vi.fn(async () => ({ data: [], pagination: { has_more: false, next_cursor: null } })),
    }));
    const { resolvePolymarketBuyCostFromActivity } = await import("@changmen/venue-browser/polymarket/orders/history/pmActivity");
    const cost = await resolvePolymarketBuyCostFromActivity(
      "0x47c9014f76660cd2efe17c1f5ea342fd12cd2038",
      { conditionId: "0xmissing", shares: 1 },
    );
    expect(cost).toBeNull();
  });
});
