import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPolymarketUserActivityTrades, matchPolymarketActivityBuyCost, parsePolymarketActivityBuyCost, resolvePolymarketBuyCostFromActivity } from "./pmActivity";
import { fetchPolymarketActivityV2, normalizePolymarketActivityV2Row } from "./pmActivityV2";
import { enrichPolymarketBuyOrdersWithFees } from "./pmFee";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./transport", () => ({ polymarketPluginGet: get }));

const user = "0x983eedfbd75803602e4a6e6ea9aab6dc6b9c6748";
const tx = `0x${"a".repeat(64)}`;
const tx2 = `0x${"b".repeat(64)}`;
function trade(overrides: Record<string, unknown> = {}) {
  return {
    proxy_wallet: user,
    timestamp: 1700000000,
    condition_id: "condition",
    token_id: "token",
    type: "TRADE",
    side: "BUY",
    size: 25,
    price: 0.4,
    usdc_size: 10.3,
    transaction_hash: tx,
    ...overrides,
  };
}
function page(rows: unknown[], cursor: string | null = null) {
  return { data: rows, pagination: { next_cursor: cursor, has_more: cursor !== null } };
}

afterEach(() => {
  get.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("data API v2 activity", () => {
  it("does not exclude a resting order filled more than 15 minutes after creation", async () => {
    get.mockImplementation(async (url: string) => {
      const end = new URL(url).searchParams.get("end");
      const filledAt = 1700003600;
      return page(end && Number(end) < filledAt ? [] : [trade({ timestamp: filledAt })]);
    });
    const cost = await resolvePolymarketBuyCostFromActivity(user, {
      conditionId: "condition",
      tokenId: "token",
      createAtMs: 1700000000000,
      transactionHashes: [tx],
    });
    expect(cost?.usdcSize).toBe(10.3);
  });

  it("rejects missing scope/time fields in fuzzy matching", () => {
    for (const override of [{ token_id: undefined }, { condition_id: undefined }, { timestamp: undefined }]) {
      const rows = [normalizePolymarketActivityV2Row(trade(override))];
      expect(matchPolymarketActivityBuyCost(rows, {
        conditionId: "condition",
        tokenId: "token",
        shares: 25,
        createAtMs: 1700000000000,
      })).toBeNull();
    }
  });

  it("does not drop an invalid supplied transaction hash or fall back to fuzzy matching", () => {
    const rows = [normalizePolymarketActivityV2Row(trade())];
    for (const hashes of [[tx, "invalid"], ["invalid"]]) {
      expect(matchPolymarketActivityBuyCost(rows, {
        conditionId: "condition",
        tokenId: "token",
        shares: 25,
        transactionHashes: hashes,
      })).toBeNull();
    }
  });

  it("rounds aggregated multi-fill cash once rather than each fill", () => {
    const rows = [trade({ size: 1, usdc_size: 0.400049 }), trade({ size: 1, usdc_size: 0.400049, transaction_hash: tx2 })]
      .map(normalizePolymarketActivityV2Row);
    const cost = matchPolymarketActivityBuyCost(rows, { conditionId: "condition", tokenId: "token", transactionHashes: [tx, tx2] });
    expect(cost?.usdcSize).toBe(0.8001);
    expect(cost?.feeUsdc).toBe(0.0001);
  });

  it("does not double-round a single fill's fee upwards", () => {
    const cost = parsePolymarketActivityBuyCost(normalizePolymarketActivityV2Row(trade({ size: 1, usdc_size: 0.400049 })));
    expect(cost?.feeUsdc).toBe(0);
    expect(cost?.usdcSize).toBe(0.4);
  });

  it("preserves public v1/v2 cash economics, including fee-bearing trades", () => {
    const row = normalizePolymarketActivityV2Row(trade());
    expect(row).toMatchObject({ conditionId: "condition", asset: "token", transactionHash: tx, usdcSize: 10.3 });
    expect(matchPolymarketActivityBuyCost([row], { conditionId: "condition", tokenId: "token", transactionHashes: [tx] }))
      .toMatchObject({ shares: 25, usdcSize: 10.3, feeUsdc: 0.3 });
  });

  it("does not turn missing/null/nonfinite amounts into zero or match combo rows", () => {
    for (const override of [{ usdc_size: null }, { usdc_size: undefined }, { usdc_size: Infinity }, { size: Infinity }, { type: undefined }, { is_combo: true }]) {
      const row = normalizePolymarketActivityV2Row(trade(override));
      expect(matchPolymarketActivityBuyCost([row], { conditionId: "condition", transactionHashes: [tx] })).toBeNull();
    }
  });

  it("follows cursors with all filters and matches a multi-transaction fill across pages", async () => {
    get.mockResolvedValueOnce(page([trade()], "opaque"))
      .mockResolvedValueOnce(page([trade({ transaction_hash: tx2 })]));
    const rows = await fetchPolymarketActivityV2(user, { limit: 1, startSec: 1699999000, endSec: 1700000900 });
    const second = new URL(get.mock.calls[1]![0]);
    expect(second.pathname).toBe("/v2/activity");
    expect(Object.fromEntries(second.searchParams)).toMatchObject({
      user,
      type: "TRADE",
      side: "BUY",
      cursor: "opaque",
      start: "1699999000",
      end: "1700000900",
      sort_direction: "DESC",
    });
    expect(second.searchParams.has("offset")).toBe(false);
    expect(matchPolymarketActivityBuyCost(rows, { conditionId: "condition", tokenId: "token", transactionHashes: [tx, tx2] }))
      .toMatchObject({ shares: 50, usdcSize: 20.6, feeUsdc: 0.6 });
  });

  it("rejects a hash found only in another market or with unavailable economics", () => {
    for (const override of [{ condition_id: "other" }, { condition_id: null }, { token_id: "other" }, { usdc_size: null }]) {
      const rows = [trade(), trade({ transaction_hash: tx2, ...override })].map(normalizePolymarketActivityV2Row);
      expect(matchPolymarketActivityBuyCost(rows, { conditionId: "condition", tokenId: "token", transactionHashes: [tx, tx2] })).toBeNull();
    }
  });

  it("deduplicates repeated fills during matching without doubling cost", () => {
    const rows = [trade(), trade()].map(normalizePolymarketActivityV2Row);
    expect(matchPolymarketActivityBuyCost(rows, { conditionId: "condition", transactionHashes: [tx] }))
      .toMatchObject({ shares: 25, usdcSize: 10.3 });
  });

  it.each([
    { data: [], pagination: { has_more: true, next_cursor: null } },
    { data: [], pagination: {} },
    { data: null, pagination: { has_more: false, next_cursor: null } },
    [],
    { error: "bad request", code: "invalid_request", retryable: false },
  ])("rejects malformed/error envelopes instead of treating them as empty success: %j", async (body) => {
    get.mockResolvedValue(body);
    await expect(fetchPolymarketActivityV2(user)).rejects.toBeDefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("accepts a documented empty result", async () => {
    get.mockResolvedValue(page([]));
    await expect(fetchPolymarketActivityV2(user)).resolves.toEqual([]);
  });

  it("discards every page on a repeated cursor, page cap, row cap or subsequent failure", async () => {
    for (const options of [{ maxPages: 1 }, { maxRows: 1 }, {}]) {
      get.mockReset().mockResolvedValue(page([trade()], "same"));
      await expect(fetchPolymarketActivityV2(user, options)).rejects.toThrow(/limit|advance/);
    }
    get.mockReset().mockResolvedValueOnce(page([trade()], "next")).mockRejectedValueOnce(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(fetchPolymarketUserActivityTrades(user)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("整批"), expect.any(String), "offline");
  });

  it("honors Retry-After on 429, retaining the cursor and filters", async () => {
    vi.useFakeTimers();
    get.mockResolvedValueOnce(page([trade()], "next"))
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "1" }, data: { code: "rate_limited", retryable: true } } })
      .mockResolvedValueOnce(page([trade({ transaction_hash: tx2 })]));
    const result = fetchPolymarketActivityV2(user);
    await vi.advanceTimersByTimeAsync(999);
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toHaveLength(2);
    expect(get.mock.calls[1]![0]).toBe(get.mock.calls[2]![0]);
  });

  it("bounds retries and never sleeps past the request budget", async () => {
    vi.useFakeTimers();
    get.mockResolvedValue({ code: "dependency_unavailable", error: "busy", retryable: true });
    const result = expect(fetchPolymarketActivityV2(user)).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(get).toHaveBeenCalledTimes(3);
    get.mockReset().mockRejectedValue({ response: { status: 503, headers: { "retry-after": "60" } } });
    await expect(fetchPolymarketActivityV2(user, { timeoutMs: 100 })).rejects.toBeDefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("times out a stalled transport without returning previously fetched rows", async () => {
    vi.useFakeTimers();
    get.mockResolvedValueOnce(page([trade()], "next")).mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(fetchPolymarketActivityV2(user, { timeoutMs: 100 })).rejects.toThrow(/deadline/);
    await vi.advanceTimersByTimeAsync(100);
    await result;
  });

  it("uses the oldest batch buy time and applies official cost exactly once", async () => {
    get.mockResolvedValue(page([trade()]));
    const order = {
      orderId: "o",
      pmSide: "buy",
      pmConditionId: "condition",
      pmTokenId: "token",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10,
      betMoney: 10,
      createAt: 1700000000000,
    };
    const options = { proxyWallet: user, txHashesByOrderId: new Map([["o", [tx]]]) };
    const enriched = await enrichPolymarketBuyOrdersWithFees([order], options);
    const url = new URL(get.mock.calls[0]![0]);
    expect(url.searchParams.get("start")).toBe("1699999100");
    expect(Number(url.searchParams.get("end"))).toBeGreaterThan(1700003600);
    expect(enriched[0]).toMatchObject({ pmFeeUsdc: 0.3, pmStakeUsdc: 10.3, betMoney: 10.3 });
    expect(await enrichPolymarketBuyOrdersWithFees(enriched, options)).toEqual(enriched);
  });

  it("does not apply an entire shared transaction's cash to each smaller order", async () => {
    get.mockResolvedValue(page([trade({ size: 50, usdc_size: 20.6 })]));
    const orders = ["a", "b"].map(orderId => ({
      orderId,
      pmSide: "buy",
      pmConditionId: "condition",
      pmTokenId: "token",
      pmShares: 25,
      pmFillPrice: 0.4,
      pmStakeUsdc: 10.3,
      betMoney: 10.3,
      pmFeeUsdc: 0.3,
      createAt: 1700000000000,
    }));
    const enriched = await enrichPolymarketBuyOrdersWithFees(orders, {
      proxyWallet: user,
      txHashesByOrderId: new Map([["a", [tx]], ["b", [tx]]]),
    });
    expect(enriched).toEqual(orders);
  });

  it("does not request invalid wallet addresses", async () => {
    expect(await fetchPolymarketUserActivityTrades("invalid")).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
