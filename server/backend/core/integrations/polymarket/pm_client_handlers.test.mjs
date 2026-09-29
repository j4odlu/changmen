import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("./clob_proxy.js", () => ({
  PM_SUBMIT_ORDER_POST_TIMEOUT_MS: 20_000,
  executePolymarketHttpRequest: vi.fn(async ({ url, method }) => ({
    status: 200,
    text: method === "GET" && String(url).includes("/book")
      ? JSON.stringify({ tick_size: "0.01", asks: [] })
      : method === "GET" && String(url).includes("/data/orders")
        ? JSON.stringify([{ id: "sell-1", asset_id: "123", side: "SELL", status: "ORDER_STATUS_LIVE" }])
        : method === "POST" && String(url).includes("/heartbeats")
          ? JSON.stringify({ heartbeat_id: "hb-next" })
          : JSON.stringify({ success: true, orderID: "oid-1" }),
  })),
  pickPolymarketPolyHeaders: vi.fn((raw) => {
    if (!raw || typeof raw !== "object")
      return undefined;
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (String(k).toUpperCase().startsWith("POLY_"))
        out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }),
}));

vi.mock("./clob_l2.js", () => ({
  fetchPolymarketTradesSince: vi.fn(async () => [{ taker_order_id: "t1", side: "BUY" }]),
  fetchPolymarketTradesById: vi.fn(async () => [{ id: "trade-1", transaction_hash: "0xabc" }]),
}));

vi.mock("./balance.js", () => ({
  fetchPolymarketCollateralBalance: vi.fn(async () => ({ balance: 12.5, currency: "USDT" })),
}));

vi.mock("../../db/store.js", () => ({
  refreshAccountsFromRdsIfEmpty: vi.fn(async () => {}),
}));

const accounts = [{
  accountId: 47,
  provider: "polymarket",
  credit: 10,
  token: JSON.stringify({
    walletAddress: "0xabc",
    apiCreds: { apiKey: "k", secret: "c2VjcmV0", passphrase: "p" },
  }),
}];

vi.mock("../../esport-api/store.js", () => ({
  default: {
    getAccountsForUser: () => accounts,
    setAccountsForUser: vi.fn((_uid, list) => {
      accounts.splice(0, accounts.length, ...list);
    }),
  },
}));

vi.mock("../../account/player_ownership.js", () => ({
  assertPlayerOwnedByUser: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../account/account_store.js", () => ({
  updatePlayerBalance: vi.fn(async (_id, bal) => ({ total: bal })),
  getAccountsFromKv: vi.fn(() => accounts),
}));

vi.mock("../../account/balance_provider.js", () => ({
  enrichAccountFromPlatformDefaults: (a) => a,
}));

vi.mock("@changmen/shared/account_multiply", () => ({
  normalizeAccountMultiplyField: (v) => v,
}));

const {
  handlePmGetBook,
  handlePmSubmitOrder,
  handlePmGetTrades,
  handlePmHeartbeat,
  handlePmGetOpenOrders,
  handlePmCancelOrder,
  handlePmHttpRequest,
  handleRefreshPmBalance,
} = await import("./pm_client_handlers.js");

describe("pm_client_handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("Pm_GetBook 公开盘口", async () => {
    const res = await handlePmGetBook({ tokenId: "123" }, "user-1");
    expect(res.ok).toBe(true);
    expect(res.info).toMatchObject({ tick_size: "0.01" });
  });

  test("Pm_SubmitOrder 需要 order", async () => {
    const res = await handlePmSubmitOrder({ playerId: 47 }, "user-1");
    expect(res.ok).toBe(false);
  });

  test("Pm_SubmitOrder 成功", async () => {
    const res = await handlePmSubmitOrder({
      playerId: 47,
      order: { foo: 1 },
    }, "user-1");
    expect(res.ok).toBe(true);
    expect(res.info).toMatchObject({ success: true, orderID: "oid-1" });
    const { executePolymarketHttpRequest } = await import("./clob_proxy.js");
    expect(executePolymarketHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        timeoutMs: 20_000,
      }),
    );
  });

  test("Pm_GetTrades 返回数组", async () => {
    const res = await handlePmGetTrades({ playerId: 47, after: 1700000000 }, "user-1");
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.info)).toBe(true);
  });

  test("Pm_GetTrades 支持 id=tradeID", async () => {
    const res = await handlePmGetTrades({ playerId: 47, id: "trade-1" }, "user-1");
    expect(res.ok).toBe(true);
    expect(res.info).toEqual([{ id: "trade-1", transaction_hash: "0xabc" }]);
  });

  test("Pm_Heartbeat 返回 heartbeat_id", async () => {
    const res = await handlePmHeartbeat({ playerId: 47, heartbeatId: "" }, "user-1");
    expect(res.ok).toBe(true);
    expect(res.info).toMatchObject({ heartbeat_id: "hb-next" });
  });

  test("Pm_GetOpenOrders 返回列表", async () => {
    const res = await handlePmGetOpenOrders({ playerId: 47, assetId: "123" }, "user-1");
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.info)).toBe(true);
  });

  test("Pm_GetOpenOrders 支持原订单 id 精确查询", async () => {
    const { executePolymarketHttpRequest } = await import("./clob_proxy.js");
    const res = await handlePmGetOpenOrders({ playerId: 47, id: "original-id" }, "user-1");
    expect(res.ok).toBe(true);
    expect(executePolymarketHttpRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET", url: expect.stringContaining("/data/orders?id=original-id"),
    }));
  });

  test("Pm_CancelOrder 需要 orderId", async () => {
    const res = await handlePmCancelOrder({ playerId: 47 }, "user-1");
    expect(res.ok).toBe(false);
    expect(String(res.msg)).toMatch(/orderId/);
  });

  test("Pm_CancelOrder 成功", async () => {
    const { executePolymarketHttpRequest } = await import("./clob_proxy.js");
    vi.mocked(executePolymarketHttpRequest).mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ canceled: ["oid-1"], not_canceled: {} }),
    });
    const res = await handlePmCancelOrder({ playerId: 47, orderId: "oid-1" }, "user-1");
    expect(res.ok).toBe(true);
    expect(res.info).toEqual({ canceled: ["oid-1"], not_canceled: {} });
    expect(executePolymarketHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        body: { orderID: "oid-1" },
      }),
    );
  });

  test("Pm_HttpRequest 需要 url", async () => {
    const res = await handlePmHttpRequest({ method: "GET" }, "user-1");
    expect(res.ok).toBe(false);
    expect(String(res.msg)).toMatch(/url/);
  });

  test("Pm_HttpRequest 成功透传上游", async () => {
    const { executePolymarketHttpRequest } = await import("./clob_proxy.js");
    vi.mocked(executePolymarketHttpRequest).mockResolvedValueOnce({
      status: 200,
      text: "{\"ok\":1}",
    });
    const res = await handlePmHttpRequest({
      method: "GET",
      url: "https://clob.polymarket.com/book?token_id=1",
    }, "user-1");
    expect(res.ok).toBe(true);
    expect(res.info).toEqual({ status: 200, text: "{\"ok\":1}" });
  });

  test("Pm_RefreshBalance 写入余额", async () => {
    const { updatePlayerBalance } = await import("../../account/account_store.js");
    const res = await handleRefreshPmBalance({ playerId: 47 }, "user-1");
    expect(res.ok).toBe(true);
    expect(res.info).toMatchObject({ balance: 12.5, currency: "USDT" });
    expect(updatePlayerBalance).toHaveBeenCalledWith(47, 12.5, "user-1");
  });

  test("Pm_RefreshBalance 拒绝非 PM 账号", async () => {
    accounts[0] = { ...accounts[0], provider: "OB" };
    const res = await handleRefreshPmBalance({ playerId: 47 }, "user-1");
    expect(res.ok).toBe(false);
    expect(String(res.msg)).toMatch(/Polymarket/);
    accounts[0] = { ...accounts[0], provider: "polymarket" };
  });
});
