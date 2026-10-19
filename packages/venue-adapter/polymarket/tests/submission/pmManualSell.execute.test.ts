import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { pmGetBook, pmPrepareSubmit, pmSubmitClockReady, pmSubmitOrder } from "@changmen/venue-browser/polymarket/orders/pmClientApi";
import { estimatePolymarketManualSellProceedsUsdc, sellPolymarketBuyPosition } from "@changmen/venue-browser/polymarket/submission/pmManualSell";
import { resolvePolymarketBuilderCode } from "@changmen/venue-browser/polymarket/submission/client/builder";
import { PM_ORDER_SUBMIT_MODE_KEY, setPmOrderSubmitMode } from "@changmen/venue-browser/polymarket/pmOrderSubmitMode";
import { preparePolymarketAccountRuntimes, clearPolymarketOrderClientCache } from "@changmen/venue-browser/polymarket/submission/client/pmOrderClientCache";
import { clearPmSubmitJournalForTests } from "@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal";
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({
  pmGetBook: vi.fn(), pmPrepareSubmit: vi.fn(), pmSubmitClockReady: vi.fn(), pmSubmitOrder: vi.fn(),
}));
const privateKey = `0x${"0".repeat(63)}1`;
function account(): PlatformAccount {
  return {
    accountId: 9001, provider: "Polymarket", gateway: "https://clob.polymarket.com",
    token: JSON.stringify({ privateKey, walletAddress: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
      apiKey: "test-api-key", secret: "dGVzdA==", passphrase: "test-passphrase", signatureType: 0 }),
  } as PlatformAccount;
}
const buy = {
  provider: "Polymarket" as const, orderId: "0xbuy", odds: 2, createAt: 1, betMoney: 100,
  reward: 0, money: 0, status: "none" as const, match: "A vs B", bet: "ml", item: "A",
  pmTokenId: "123", pmShares: 10, pmStakeUsdc: 5, pmFillPrice: 0.5,
  pmSide: "buy" as const, pmOrigin: "changmen" as const, pmSellState: "open" as const,
};
beforeEach(async () => {
  localStorage.clear(); clearPmSubmitJournalForTests();
  await preparePolymarketAccountRuntimes([account()]);
  globalThis.localStorage.removeItem(PM_ORDER_SUBMIT_MODE_KEY);
  vi.mocked(pmGetBook).mockReset().mockResolvedValue({ asset_id: "123", bids: [{ price: "0.5", size: "100" }], tick_size: "0.01", min_order_size: 1, neg_risk: false });
  vi.mocked(pmPrepareSubmit).mockReset().mockResolvedValue(undefined);
  vi.mocked(pmSubmitClockReady).mockReset().mockReturnValue(true);
  vi.mocked(pmSubmitOrder).mockReset().mockResolvedValue({ success: false, errorMsg: "FOK 未成交" });
});

describe("manual sell submission preparation", () => {
  it.each(["local", "vps"] as const)("%s sell prepares without requiring an estimate and preserves signed Builder attribution", async mode => {
    setPmOrderSubmitMode(mode);
    const a = account();
    const result = await sellPolymarketBuyPosition({ account: a, buyRow: buy });
    expect(result.error).toBe("FOK 未成交");
    expect(pmPrepareSubmit).toHaveBeenCalledExactlyOnceWith(a);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
    expect(vi.mocked(pmSubmitOrder).mock.calls[0][1]).toMatchObject({ orderType: "FOK", order: {
      builder: resolvePolymarketBuilderCode(), side: "SELL", signature: expect.stringMatching(/^0x/),
    } });
  });

  it("readonly proceeds estimation requires no signing clock preparation", async () => {
    vi.mocked(pmPrepareSubmit).mockRejectedValue(new Error("clock unavailable"));
    expect(await estimatePolymarketManualSellProceedsUsdc({ account: account(), buyRow: buy })).toBe(5);
    expect(pmPrepareSubmit).not.toHaveBeenCalled();
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });

  it("clock preparation failure stops before signing or POST", async () => {
    vi.mocked(pmPrepareSubmit).mockRejectedValue(new Error("校时未就绪"));
    const result = await sellPolymarketBuyPosition({ account: account(), buyRow: buy });
    expect(result.error).toContain("校时未就绪");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });

  it("route changes during preparation cannot silently reroute the sell", async () => {
    vi.mocked(pmPrepareSubmit).mockImplementation(async () => { setPmOrderSubmitMode("local"); });
    const result = await sellPolymarketBuyPosition({ account: account(), buyRow: buy });
    expect(result.error).toContain("下单方式已改变");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });

  it("an expired clock sample cannot reach POST", async () => {
    vi.mocked(pmSubmitClockReady).mockReturnValue(false);
    const result = await sellPolymarketBuyPosition({ account: account(), buyRow: buy });
    expect(result.error).toContain("校时未就绪");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });

  it.each(["account", "wallet"])("a changed %s during preparation stops before POST", async what => {
    const a = account();
    vi.mocked(pmPrepareSubmit).mockImplementation(async () => {
      if (what === "account") a.accountId = 9002;
      else clearPolymarketOrderClientCache();
    });
    const result = await sellPolymarketBuyPosition({ account: a, buyRow: buy });
    expect(result.error).toMatch(/账号或钱包会话已改变|签名器未就绪/);
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });

  it.each(["other", "own", "all"])("sell checks account-scoped revocation during preparation: %s", async target => {
    const a = account(); const b = { ...a, accountId: 9002 };
    await preparePolymarketAccountRuntimes([a, b]);
    vi.mocked(pmPrepareSubmit).mockImplementationOnce(async () => {
      if (target === "all") clearPolymarketOrderClientCache();
      else await preparePolymarketAccountRuntimes(target === "other" ? [a] : [b]);
    });
    const result = await sellPolymarketBuyPosition({ account: a, buyRow: buy });
    expect(result.error).toMatch(target === "other" ? /FOK 未成交/ : /账号或钱包会话已改变|签名器未就绪/);
    expect(pmSubmitOrder).toHaveBeenCalledTimes(target === "other" ? 1 : 0);
  });

  it.each(["other", "own", "all"])("sell rechecks account revocation at dispatch: %s", async target => {
    const a = account(); const b = { ...a, accountId: 9002 };
    await preparePolymarketAccountRuntimes([a, b]);
    vi.stubGlobal("navigator", { locks: { request: async (_key: string, action: () => Promise<unknown>) => {
      if (target === "all") clearPolymarketOrderClientCache();
      else await preparePolymarketAccountRuntimes(target === "other" ? [a] : [b]);
      return action();
    } } });
    try {
      const result = await sellPolymarketBuyPosition({ account: a, buyRow: buy });
      expect(result.error).toMatch(target === "other" ? /FOK 未成交/ : /账号或钱包会话已改变/);
      expect(pmSubmitOrder).toHaveBeenCalledTimes(target === "other" ? 1 : 0);
    } finally { vi.unstubAllGlobals(); }
  });

  it("a mismatched signing wallet is rejected locally", async () => {
    const a = account();
    const config = JSON.parse(a.token!);
    config.walletAddress = "0x0000000000000000000000000000000000000001";
    a.token = JSON.stringify(config);
    const result = await sellPolymarketBuyPosition({ account: a, buyRow: buy });
    const results = await preparePolymarketAccountRuntimes([a]);
    expect(results[0]).toMatchObject({ status: "rejected", reason: new Error("PM 私钥与 walletAddress 不匹配") });
    expect(result.error).toContain("签名器未就绪");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });

  it("an ACK lost on SELL remains closing and blocks a fresh sell, including another parent on the asset", async () => {
    vi.mocked(pmSubmitOrder).mockRejectedValueOnce(new Error("timeout"));
    const onSubmitted = vi.fn();
    const first = await sellPolymarketBuyPosition({ account: account(), buyRow: buy, onSubmitted });
    expect(first).toMatchObject({ ok: false, pending: true, pmSubmitUnknown: true, unfilled: false, chainSubmitted: false });
    expect(onSubmitted).toHaveBeenCalledOnce();
    const second = await sellPolymarketBuyPosition({ account: account(), buyRow: buy });
    expect(second.sellOrderId).toBe(first.sellOrderId);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
    const wrongParent = vi.fn();
    const third = await sellPolymarketBuyPosition({ account: account(), buyRow: { ...buy, orderId: "other-buy" }, onSubmitted: wrongParent });
    expect(third.sellOrderId).toBeUndefined();
    expect(wrongParent).not.toHaveBeenCalled();
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
  });

  it.each(["local", "vps"] as const)("%s Deposit Wallet SELL uses Exchange V3 for a v2 book", async mode => {
    setPmOrderSubmitMode(mode);
    const a = account(); const config = JSON.parse(a.token!);
    a.token = JSON.stringify({ ...config, signatureType: 3, funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5" });
    await preparePolymarketAccountRuntimes([a]);
    vi.mocked(pmGetBook).mockResolvedValue({ asset_id: "123", version: "v2",
      bids: [{ price: "0.5", size: "100" }], tick_size: "0.01", min_order_size: 1, neg_risk: false });
    await sellPolymarketBuyPosition({ account: a, buyRow: buy });
    expect(vi.mocked(pmSubmitOrder).mock.calls[0][1]).toMatchObject({ orderType: "FOK", order: {
      maker: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5", signer: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: 3, side: "SELL", makerAmount: "10000000", takerAmount: "5000000",
      builder: resolvePolymarketBuilderCode(),
    } });
  });

  it.each([{ asset_id: "other" }, { version: "future" }, { neg_risk: undefined }])("invalid SELL market options stop before POST: %j", async patch => {
    vi.mocked(pmGetBook).mockResolvedValue({ asset_id: "123", bids: [{ price: "0.5", size: "100" }],
      tick_size: "0.01", min_order_size: 1, neg_risk: false, ...patch });
    expect((await sellPolymarketBuyPosition({ account: account(), buyRow: buy })).error).toContain("订单簿结构");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });
});
