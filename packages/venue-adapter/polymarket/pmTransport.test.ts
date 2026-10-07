import { clearPmPublicRoutesForTests } from "./pmPublicRoute";
import { a8PluginGet, a8PluginPost } from "@changmen/client-core/chrome-plugin/bridge";

import { directGet, directPostJson } from "@changmen/client-core/shared/http";

import { changmenPmEsportCall, changmenPmHttpRequest } from "@changmen/client-core/shared/platformHttp";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPolymarketActivityV2 } from "./pmActivityV2";

import { resetPmMarketWsSourceModeForTests } from "./pmMarketWsMode";
import {
  PM_GET_BOOK_DIRECT_TIMEOUT_MS,
  PM_PRIVATE_READ_DIRECT_TIMEOUT_MS,
  PM_SUBMIT_ORDER_TIMEOUT_MS,
  pmEsportCall,
  pmTransportHttpGet,
  setPmGetBookDirectTimeoutMsForTests,
} from "./pmTransport";
import { resolvePmHttpMode, setPmHttpModeForTests } from "./pmTransportMode";
import { getPmOrderSubmitMode, setPmOrderSubmitMode, PM_ORDER_SUBMIT_MODE_KEY } from "./pmOrderSubmitMode";
import { browserSubmitTimestamp } from "./pmBrowserSubmitClock";
vi.mock("./pmBrowserSubmitClock", () => ({ browserSubmitTimestamp: vi.fn(() => 123) }));

vi.mock("@changmen/client-core/shared/http", () => ({

  directGet: vi.fn(),

  directPostJson: vi.fn(),

  directDeleteJson: vi.fn(),

}));

vi.mock("@changmen/client-core/shared/platformHttp", () => ({

  changmenPmHttpRequest: vi.fn(),

  changmenPmEsportCall: vi.fn(),

  parseJsonLoose: (text: string) => JSON.parse(text),

}));

vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({

  a8PluginGet: vi.fn(),

  a8PluginPost: vi.fn(),

  a8PluginDelete: vi.fn(),

}));

vi.mock("./l2Auth", () => ({

  buildL2HeadersFromAccount: vi.fn(async () => ({

    POLY_ADDRESS: "0xabc",

    POLY_SIGNATURE: "sig",

    POLY_TIMESTAMP: "123",

    POLY_API_KEY: "key",

    POLY_PASSPHRASE: "pass",

  })),

}));

const pmAccount = {

  accountId: 42,

  provider: "polymarket",

  token: JSON.stringify({ walletAddress: "0xabc", apiKey: "k", secret: "s", passphrase: "p" }),

  gateway: "https://clob.polymarket.com",

};

describe("pmTransport mode", () => {
  it.each(["data-api", "gamma-api", "clob"])("official mode reads %s directly without a VPS hop", async (host) => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockResolvedValue({ ok: true });
    expect(await pmTransportHttpGet(`https://${host}.polymarket.com/v2/activity`)).toEqual({ ok: true });
    expect(directGet).toHaveBeenCalledOnce();
    expect(changmenPmHttpRequest).not.toHaveBeenCalled();
  });

  it("official activity falls back on network failure without changing the selected mode", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockRejectedValue(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({ status: 200, text: "{\"ok\":true}" });
    expect(await pmTransportHttpGet("https://data-api.polymarket.com/v2/activity")).toEqual({ ok: true });
    expect(changmenPmHttpRequest).toHaveBeenCalledOnce();
    expect(resolvePmHttpMode()).toBe("vps");
  });

  it("official activity falls back when the direct request stalls", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockImplementation(() => new Promise(() => {}));
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({ status: 200, text: "{\"ok\":true}" });
    expect(await pmTransportHttpGet("https://data-api.polymarket.com/v2/activity")).toEqual({ ok: true });
    expect(changmenPmHttpRequest).toHaveBeenCalledOnce();
  });

  it("official activity keeps 429 metadata for retry instead of bypassing via VPS", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    const response = { status: 429, headers: { "retry-after": "2" }, data: { code: "rate_limited" } };
    vi.mocked(directGet).mockRejectedValue(Object.assign(new Error("HTTP 429"), { response }));
    await expect(pmTransportHttpGet("https://data-api.polymarket.com/v2/activity")).rejects.toMatchObject({ response });
    expect(changmenPmHttpRequest).not.toHaveBeenCalled();
  });

  it("relay mode keeps public activity and book on VPS", async () => {
    setPmHttpModeForTests("vps");
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({ status: 200, text: "{\"ok\":true}" });
    vi.mocked(changmenPmEsportCall).mockResolvedValue({ tick_size: "0.01" });
    await pmTransportHttpGet("https://data-api.polymarket.com/v2/activity");
    await pmEsportCall("Pm_GetBook", { tokenId: "123" });
    expect(directGet).not.toHaveBeenCalled();
    expect(changmenPmHttpRequest).toHaveBeenCalledOnce();
    expect(changmenPmEsportCall).toHaveBeenCalledOnce();
  });
  it.each(["direct", "extension", "vps"] as const)("activity v2 envelope survives %s mode", async (mode) => {
    setPmHttpModeForTests(mode);
    const user = `0x${"1".repeat(40)}`;
    const body = { data: [{ proxy_wallet: user, type: "TRADE", side: "BUY", token_id: "token", usdc_size: 10.3 }], pagination: { has_more: false, next_cursor: null } };
    vi.mocked(directGet).mockResolvedValue(body);
    vi.mocked(a8PluginGet).mockResolvedValue({ status: 200, headers: {}, data: body });
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({ status: 200, text: JSON.stringify(body) });
    expect(await fetchPolymarketActivityV2(user)).toMatchObject([{ asset: "token", usdcSize: 10.3 }]);
  });

  it("extension preserves resolved Axios error response metadata", async () => {
    setPmHttpModeForTests("extension");
    const response = { status: 429, headers: { "retry-after": "3" }, data: { code: "rate_limited" } };
    vi.mocked(a8PluginGet).mockResolvedValue({ message: "too many requests", response });
    await expect(pmTransportHttpGet("https://data-api.polymarket.com/v2/activity")).rejects.toMatchObject({ response });
  });

  beforeEach(() => {
    vi.mocked(browserSubmitTimestamp).mockReset().mockReturnValue(123);
    globalThis.localStorage.removeItem(PM_ORDER_SUBMIT_MODE_KEY);
    clearPmPublicRoutesForTests();
    setPmHttpModeForTests(null);

    setPmGetBookDirectTimeoutMsForTests(PM_GET_BOOK_DIRECT_TIMEOUT_MS);
    resetPmMarketWsSourceModeForTests("changmen");

    vi.mocked(changmenPmHttpRequest).mockReset();

    vi.mocked(changmenPmEsportCall).mockReset();

    vi.mocked(directGet).mockReset();

    vi.mocked(directPostJson).mockReset();

    vi.mocked(a8PluginGet).mockReset();

    vi.mocked(a8PluginPost).mockReset();
  });

  it("默认 vps 走 changmenPmHttpRequest", async () => {
    expect(resolvePmHttpMode()).toBe("vps");

    vi.mocked(changmenPmHttpRequest).mockResolvedValue({

      status: 200,

      text: JSON.stringify([{ id: "1" }]),

    });

    const rows = await pmTransportHttpGet<Array<{ id: string }>>("https://gamma-api.polymarket.com/events");

    expect(rows).toEqual([{ id: "1" }]);

    expect(changmenPmHttpRequest).toHaveBeenCalledOnce();
  });

  it("direct 模式走 directGet", async () => {
    setPmHttpModeForTests("direct");

    vi.mocked(directGet).mockResolvedValue([{ id: "2" }]);

    const rows = await pmTransportHttpGet<Array<{ id: string }>>("https://gamma-api.polymarket.com/events");

    expect(rows).toEqual([{ id: "2" }]);

    expect(directGet).toHaveBeenCalledOnce();

    expect(changmenPmHttpRequest).not.toHaveBeenCalled();
  });

  it("extension 模式走 a8PluginGet 并 unwrap axios.data", async () => {
    setPmHttpModeForTests("extension");

    vi.mocked(a8PluginGet).mockResolvedValue({ status: 200, data: [{ id: "3" }] });

    const rows = await pmTransportHttpGet<Array<{ id: string }>>("https://gamma-api.polymarket.com/events");

    expect(rows).toEqual([{ id: "3" }]);

    expect(a8PluginGet).toHaveBeenCalledOnce();
  });

  it("vps 语义 API 走 changmenPmEsportCall 且剥离 _account", async () => {
    setPmHttpModeForTests("vps");

    vi.mocked(changmenPmEsportCall).mockResolvedValue({ heartbeat_id: "h1" });

    const out = await pmEsportCall("Pm_Heartbeat", { heartbeatId: "h0", _account: pmAccount });

    expect(out).toEqual({ heartbeat_id: "h1" });

    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_Heartbeat", { heartbeatId: "h0" });
  });

  it("vps Pm_SubmitOrder 只等 POST ACK 30s", async () => {
    setPmHttpModeForTests("vps");

    vi.mocked(changmenPmEsportCall).mockResolvedValue({ success: true, orderID: "oid" });

    await pmEsportCall("Pm_SubmitOrder", { playerId: 42, order: { foo: 1 }, _account: pmAccount });

    expect(changmenPmEsportCall).toHaveBeenCalledWith(
      "Pm_SubmitOrder",
      { playerId: 42, order: { foo: 1 } },
      { timeoutMs: PM_SUBMIT_ORDER_TIMEOUT_MS },
    );
  });

  it("official PM-M 下 vps L2 GET 优先直连", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockResolvedValue({ balance: "1000000" });

    const out = await pmTransportHttpGet<{ balance: string }>(
      "https://clob.polymarket.com/balance-allowance?asset_type=COLLATERAL",
      { account: pmAccount, l2Path: "/balance-allowance?asset_type=COLLATERAL" },
    );

    expect(out).toEqual({ balance: "1000000" });
    expect(directGet).toHaveBeenCalledWith(
      "https://clob.polymarket.com/balance-allowance?asset_type=COLLATERAL",
      expect.objectContaining({ POLY_API_KEY: "key" }),
    );
    expect(changmenPmHttpRequest).not.toHaveBeenCalled();
  });

  it("official PM-M 下 vps L2 GET 直连失败回落 VPS", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockRejectedValue(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ balance: "2000000" }),
    });

    const out = await pmTransportHttpGet<{ balance: string }>(
      "https://clob.polymarket.com/balance-allowance?asset_type=COLLATERAL",
      { account: pmAccount, l2Path: "/balance-allowance?asset_type=COLLATERAL" },
    );

    expect(out).toEqual({ balance: "2000000" });
    expect(changmenPmHttpRequest).toHaveBeenCalledOnce();
  });

  it("official PM-M 下 L2 GET 鉴权失败不切换通道", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockRejectedValue(new Error("HTTP 401"));
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ balance: "3000000" }),
    });

    await expect(pmTransportHttpGet<{ balance: string }>(
      "https://clob.polymarket.com/balance-allowance?asset_type=COLLATERAL",
      { account: pmAccount, l2Path: "/balance-allowance?asset_type=COLLATERAL" },
    )).rejects.toThrow("HTTP 401");
    expect(changmenPmHttpRequest).not.toHaveBeenCalled();
  });

  it("official PM-M 下 vps 私有只读接口优先直连", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockResolvedValue({ id: "order-1" });

    const out = await pmEsportCall("Pm_GetOrder", {
      playerId: 42,
      orderId: "order-1",
      _account: pmAccount,
    });

    expect(out).toEqual({ id: "order-1" });
    expect(directGet).toHaveBeenCalledWith(
      "https://clob.polymarket.com/data/order/order-1",
      expect.objectContaining({ POLY_API_KEY: "key" }),
    );
    expect(changmenPmEsportCall).not.toHaveBeenCalled();
  });

  it("official PM-M 下私有只读直连网络失败回落 VPS", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockRejectedValue(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
    vi.mocked(changmenPmEsportCall).mockResolvedValue([{ id: "t1" }]);

    const out = await pmEsportCall("Pm_GetTrades", {
      playerId: 42,
      id: "trade-1",
      _account: pmAccount,
    });

    expect(out).toEqual([{ id: "t1" }]);
    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_GetTrades", {
      playerId: 42,
      id: "trade-1",
    });
  });

  it("official PM-M 下私有只读鉴权失败不切换通道", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockRejectedValue(new Error("HTTP 401"));
    vi.mocked(changmenPmEsportCall).mockResolvedValue({ id: "vps-order" });

    await expect(pmEsportCall("Pm_GetOrder", {
      playerId: 42,
      orderId: "order-401",
      _account: pmAccount,
    })).rejects.toThrow("HTTP 401");
    expect(changmenPmEsportCall).not.toHaveBeenCalled();
  });

  it("official PM-M 下私有只读直连超时回落 VPS", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(directGet).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, PM_PRIVATE_READ_DIRECT_TIMEOUT_MS + 50));
      return { id: "slow" };
    });
    vi.mocked(changmenPmEsportCall).mockResolvedValue({ id: "vps-order" });

    const out = await pmEsportCall("Pm_GetOrder", {
      playerId: 42,
      orderId: "order-2",
      _account: pmAccount,
    });

    expect(out).toEqual({ id: "vps-order" });
    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_GetOrder", {
      playerId: 42,
      orderId: "order-2",
    });
  });

  it("official PM-M 下 SubmitOrder 仍走 VPS", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");
    vi.mocked(changmenPmEsportCall).mockResolvedValue({ success: true, orderID: "vps-oid" });

    const out = await pmEsportCall("Pm_SubmitOrder", {
      playerId: 42,
      order: { foo: 1 },
      _account: pmAccount,
    });

    expect(out).toEqual({ success: true, orderID: "vps-oid" });
    expect(directPostJson).not.toHaveBeenCalled();
    expect(changmenPmEsportCall).toHaveBeenCalledWith(
      "Pm_SubmitOrder",
      { playerId: 42, order: { foo: 1 } },
      { timeoutMs: PM_SUBMIT_ORDER_TIMEOUT_MS },
    );
  });

  it("official 模式下公开 Pm_GetBook 优先直连 CLOB", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");

    vi.mocked(directGet).mockResolvedValue({ tick_size: "0.01" });

    const book = await pmEsportCall("Pm_GetBook", { tokenId: "123", _account: pmAccount });

    expect(book).toEqual({ tick_size: "0.01" });

    expect(directGet).toHaveBeenCalledWith(

      expect.stringContaining("/book?token_id=123"),

      {},

    );

    expect(changmenPmEsportCall).not.toHaveBeenCalled();
  });

  it("pm_GetBook 直连 Network Error 时回落 VPS", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");

    const netErr = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });

    vi.mocked(directGet).mockRejectedValue(netErr);

    vi.mocked(changmenPmEsportCall).mockResolvedValue({ tick_size: "0.02" });

    const book = await pmEsportCall("Pm_GetBook", { tokenId: "123" });

    expect(book).toEqual({ tick_size: "0.02" });

    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_GetBook", { tokenId: "123" });
  });

  it("pm_GetBook 直连超时回落 VPS", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("official");

    setPmGetBookDirectTimeoutMsForTests(20);

    vi.mocked(directGet).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 80));

      return { tick_size: "slow" };
    });

    vi.mocked(changmenPmEsportCall).mockResolvedValue({ tick_size: "0.03" });

    const book = await pmEsportCall("Pm_GetBook", { tokenId: "123" });

    expect(book).toEqual({ tick_size: "0.03" });

    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_GetBook", { tokenId: "123" });
  });

  it("pm_GetBook 超时为 0 时 vps 不试直连", async () => {
    setPmHttpModeForTests("vps");

    setPmGetBookDirectTimeoutMsForTests(0);

    vi.mocked(changmenPmEsportCall).mockResolvedValue({ tick_size: "vps" });

    const book = await pmEsportCall("Pm_GetBook", { tokenId: "123" });

    expect(book).toEqual({ tick_size: "vps" });

    expect(directGet).not.toHaveBeenCalled();

    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_GetBook", { tokenId: "123" });
  });

  it("direct 语义 API Pm_GetBook", async () => {
    setPmHttpModeForTests("direct");

    vi.mocked(directGet).mockResolvedValue({ tick_size: "0.01" });

    const book = await pmEsportCall("Pm_GetBook", { tokenId: "123" });

    expect(book).toEqual({ tick_size: "0.01" });

    expect(directGet).toHaveBeenCalledWith(

      expect.stringContaining("/book?token_id=123"),

      {},

    );
  });

  it("extension 语义 API Pm_GetBook", async () => {
    setPmHttpModeForTests("extension");

    vi.mocked(a8PluginGet).mockResolvedValue({ status: 200, data: { tick_size: "0.01" } });

    const book = await pmEsportCall("Pm_GetBook", { tokenId: "123" });

    expect(book).toEqual({ tick_size: "0.01" });

    expect(a8PluginGet).toHaveBeenCalledWith(

      expect.stringContaining("/book?token_id=123"),

      undefined,

    );
  });

  it("local order selection posts the signed builder body from the browser, independently of query/WS mode", async () => {
    setPmHttpModeForTests("vps");
    resetPmMarketWsSourceModeForTests("changmen");
    setPmOrderSubmitMode("local");
    const order = { orderType: "FOK", order: { builder: `0x${"1".repeat(64)}`, signature: "signed-order" } };
    vi.mocked(directPostJson).mockResolvedValue({ success: true, orderID: "local-order" });
    expect(await pmEsportCall("Pm_SubmitOrder", { playerId: 42, order, _account: pmAccount }))
      .toEqual({ success: true, orderID: "local-order" });
    expect(directPostJson).toHaveBeenCalledWith("https://clob.polymarket.com/order",
      expect.objectContaining({ POLY_API_KEY: "key" }), order, { timeout: PM_SUBMIT_ORDER_TIMEOUT_MS });
    expect(changmenPmEsportCall).not.toHaveBeenCalled();
    expect(a8PluginPost).not.toHaveBeenCalled();
    vi.mocked(changmenPmEsportCall).mockResolvedValue({ asks: [] });
    await pmEsportCall("Pm_GetBook", { tokenId: "123" });
    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_GetBook", { tokenId: "123" });
  });

  it("explicit VPS order selection wins over a legacy direct HTTP mode", async () => {
    setPmHttpModeForTests("direct");
    setPmOrderSubmitMode("vps");
    const order = { order: { builder: `0x${"2".repeat(64)}` } };
    vi.mocked(changmenPmEsportCall).mockResolvedValue({ success: true, orderID: "vps-order" });
    await pmEsportCall("Pm_SubmitOrder", { playerId: 42, order, _account: pmAccount });
    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_SubmitOrder", { playerId: 42, order },
      { timeoutMs: PM_SUBMIT_ORDER_TIMEOUT_MS });
    expect(directPostJson).not.toHaveBeenCalled();
    expect(a8PluginPost).not.toHaveBeenCalled();
  });

  it("a stalled local order times out without replaying through VPS or changing the order preference", async () => {
    vi.useFakeTimers();
    try {
      setPmHttpModeForTests("vps");
      setPmOrderSubmitMode("local");
      vi.mocked(directPostJson).mockImplementation(() => new Promise(() => {}));
      const submitted = pmEsportCall("Pm_SubmitOrder", { playerId: 42, order: { orderType: "FOK" }, _account: pmAccount });
      const rejected = expect(submitted).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(PM_SUBMIT_ORDER_TIMEOUT_MS + 1);
      await rejected;
      expect(directPostJson).toHaveBeenCalledOnce();
      expect(changmenPmEsportCall).not.toHaveBeenCalled();
      expect(a8PluginPost).not.toHaveBeenCalled();
      expect(getPmOrderSubmitMode()).toBe("local");
    }
    finally { vi.useRealTimers(); }
  });

  it("a rejected local order is never retried through another transport", async () => {
    setPmHttpModeForTests("vps");
    setPmOrderSubmitMode("local");
    vi.mocked(directPostJson).mockRejectedValue(new Error("FOK order is not fully fillable"));
    await expect(pmEsportCall("Pm_SubmitOrder", { playerId: 42, order: {}, _account: pmAccount })).rejects.toThrow("FOK");
    expect(directPostJson).toHaveBeenCalledOnce();
    expect(changmenPmEsportCall).not.toHaveBeenCalled();
    expect(a8PluginPost).not.toHaveBeenCalled();
  });

  it("a missing local clock sample rejects before POST and never falls back", async () => {
    setPmOrderSubmitMode("local");
    vi.mocked(browserSubmitTimestamp).mockImplementation(() => { throw new Error("PM 本地提交校时未就绪"); });
    await expect(pmEsportCall("Pm_SubmitOrder", { playerId: 42, order: {}, _account: pmAccount }))
      .rejects.toThrow("校时未就绪");
    expect(directPostJson).not.toHaveBeenCalled();
    expect(changmenPmEsportCall).not.toHaveBeenCalled();
  });

  it("local order HTTP business errors do not demote query routing or replay", async () => {
    setPmHttpModeForTests("extension");
    setPmOrderSubmitMode("local");
    vi.mocked(directPostJson).mockRejectedValue(Object.assign(new Error("Network Error from upstream"), {
      response: { status: 400, data: { error: "Network Error from upstream" } },
    }));
    await expect(pmEsportCall("Pm_SubmitOrder", { playerId: 42, order: {}, _account: pmAccount })).rejects.toThrow();
    expect(resolvePmHttpMode()).toBe("extension");
    expect(changmenPmEsportCall).not.toHaveBeenCalled();
    expect(a8PluginPost).not.toHaveBeenCalled();
  });

  it("local order preference leaves cancellation on the existing VPS route", async () => {
    setPmHttpModeForTests("vps");
    setPmOrderSubmitMode("local");
    vi.mocked(changmenPmEsportCall).mockResolvedValue({ canceled: ["oid"] });
    await pmEsportCall("Pm_CancelOrder", { playerId: 42, orderId: "oid", _account: pmAccount });
    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_CancelOrder", { playerId: 42, orderId: "oid" });
    expect(directPostJson).not.toHaveBeenCalled();
    expect(a8PluginPost).not.toHaveBeenCalled();
  });

  it.each(["direct", "extension"] as const)("default order route remains VPS when legacy HTTP is %s", async mode => {
    setPmHttpModeForTests(mode);
    vi.mocked(changmenPmEsportCall).mockResolvedValue({ success: true, orderID: "oid-1" });

    const result = await pmEsportCall("Pm_SubmitOrder", {

      playerId: 42,

      order: { foo: 1 },

      _account: pmAccount,

    });

    expect(result).toEqual({ success: true, orderID: "oid-1" });

    expect(getPmOrderSubmitMode()).toBe("vps");
    expect(changmenPmEsportCall).toHaveBeenCalledWith("Pm_SubmitOrder", { playerId: 42, order: { foo: 1 } },
      { timeoutMs: PM_SUBMIT_ORDER_TIMEOUT_MS });
    expect(a8PluginPost).not.toHaveBeenCalled();
    expect(directPostJson).not.toHaveBeenCalled();
  });

  it("extension 语义 API Pm_GetTrades 分页", async () => {
    setPmHttpModeForTests("extension");

    vi.mocked(a8PluginGet)

      .mockResolvedValueOnce({ data: [{ id: "t1" }], next_cursor: "LTE=" });

    const trades = await pmEsportCall<unknown[]>("Pm_GetTrades", {

      playerId: 42,

      after: 1_700_000_000,

      _account: pmAccount,

    });

    expect(trades).toEqual([{ id: "t1" }]);

    expect(a8PluginGet).toHaveBeenCalledWith(

      expect.stringContaining("/data/trades?after="),

      expect.objectContaining({ headers: expect.objectContaining({ POLY_API_KEY: "key" }) }),

    );
  });

  it("extension 语义 API Pm_Heartbeat", async () => {
    setPmHttpModeForTests("extension");

    vi.mocked(a8PluginPost).mockResolvedValue({ heartbeat_id: "hb-next" });

    const res = await pmEsportCall<{ heartbeat_id?: string }>("Pm_Heartbeat", {

      playerId: 42,

      heartbeatId: "hb-prev",

      _account: pmAccount,

    });

    expect(res).toEqual({ heartbeat_id: "hb-next" });

    expect(a8PluginPost).toHaveBeenCalledWith(

      "https://clob.polymarket.com/v1/heartbeats",

      { heartbeat_id: "hb-prev" },

      expect.any(Object),

    );
  });

  it("local 缺少 _account 时抛错", async () => {
    setPmOrderSubmitMode("local");

    await expect(pmEsportCall("Pm_SubmitOrder", { playerId: 1, order: {} }))

      .rejects
      .toThrow(/需要账号 token/);
  });

  it("local SubmitOrder Network Error 将查询 HTTP 降回 vps，但不重发订单", async () => {
    setPmHttpModeForTests("direct");
    setPmOrderSubmitMode("local");
    vi.mocked(directPostJson).mockRejectedValue(new Error("Network Error"));

    await expect(pmEsportCall("Pm_SubmitOrder", {
      playerId: 42,
      order: { foo: 1 },
      _account: pmAccount,
    })).rejects.toThrow(/Network Error/);

    expect(resolvePmHttpMode()).toBe("vps");
    expect(getPmOrderSubmitMode()).toBe("local");
    expect(changmenPmEsportCall).not.toHaveBeenCalled();
  });

  it("extension GetBook Network Error 也将 HTTP 降回 vps", async () => {
    setPmHttpModeForTests("extension");
    vi.mocked(a8PluginGet).mockResolvedValue({ message: "Network Error" });

    await expect(pmEsportCall("Pm_GetBook", { tokenId: "123" }))
      .rejects
      .toThrow(/Network Error/);

    expect(resolvePmHttpMode()).toBe("vps");
  });

  it("local order ignores a disconnected legacy extension", async () => {
    setPmHttpModeForTests("extension");
    setPmOrderSubmitMode("local");
    vi.mocked(a8PluginPost).mockRejectedValue(
      new Error("Could not establish connection. Receiving end does not exist."),
    );
    vi.mocked(directPostJson).mockResolvedValue({ success: true, orderID: "local-oid" });

    const result = await pmEsportCall("Pm_SubmitOrder", {
      playerId: 42,
      order: { foo: 1 },
      _account: pmAccount,
    });

    expect(result).toEqual({ success: true, orderID: "local-oid" });
    expect(resolvePmHttpMode()).toBe("extension");
    expect(a8PluginPost).not.toHaveBeenCalled();
    expect(changmenPmEsportCall).not.toHaveBeenCalled();
  });

  it("extension 插件 resolve(AxiosError) 也将 HTTP 降回 vps", async () => {
    setPmHttpModeForTests("extension");
    vi.mocked(a8PluginPost).mockResolvedValue({
      message: "Network Error",
      code: "ERR_NETWORK",
      config: { data: "{}" },
      request: {},
    });

    await expect(pmEsportCall("Pm_Heartbeat", {
      playerId: 42,
      order: { foo: 1 },
      _account: pmAccount,
    })).rejects.toThrow(/Network Error/);

    expect(resolvePmHttpMode()).toBe("vps");
  });

  it("local FOK 业务失败不降级查询 HTTP", async () => {
    setPmHttpModeForTests("extension");
    setPmOrderSubmitMode("local");
    vi.mocked(directPostJson).mockResolvedValue({ success: false, errorMsg: "FOK 未成交" });

    const result = await pmEsportCall("Pm_SubmitOrder", {
      playerId: 42,
      order: { foo: 1 },
      _account: pmAccount,
    });

    expect(result).toEqual({ success: false, errorMsg: "FOK 未成交" });
    expect(resolvePmHttpMode()).toBe("extension");
  });
});
