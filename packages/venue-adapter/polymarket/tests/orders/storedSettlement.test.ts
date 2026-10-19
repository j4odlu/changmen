import type { VenueOrder } from "@changmen/client-core/contract";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPolymarketVenueOrdersMerged } from "@changmen/venue-browser/polymarket/orders/history/orders";
import { rememberPolymarketMarketBetLabel } from "@changmen/venue-browser/polymarket/markets/orderBetLabel";
import { storedMarketRefresh } from "@changmen/venue-browser/polymarket/orders/history/storedMarketRefresh";

const mocks = vi.hoisted(() => ({ trades: vi.fn(), get: vi.fn(), stored: vi.fn() }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetTrades: mocks.trades }));
vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: mocks.get }));
vi.mock("@changmen/venue-browser/polymarket/orders/history/pmStoredOrders", () => ({ loadPolymarketStoredVenueOrders: mocks.stored }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmFee", () => ({ enrichPolymarketBuyOrdersWithFees: async (rows: VenueOrder[]) => rows }));

const condition = "0xf2100079b1360cfb3ffe88642455ff3ad6596c029f8c54962985aca7283280dc";
const token = "57232858937149583352927277805092640185006103000471324975696067551168118876742";
const market = {
  conditionId: condition, question: "LoL: Team WE vs HANJIN BRION - Game 3 Winner",
  outcomes: ["Team WE", "HANJIN BRION"], clobTokenIds: ["we-token", token],
  outcomePrices: ["0.0005", "0.9995"], closed: false,
};
const saved: VenueOrder = {
  provider: "Polymarket", orderId: "0xa261ea11e2ca274c08bf23dc3091ab5d32be57555db93b4c20b1eefc31acb593",
  pmOrigin: "changmen", pmSide: "buy", pmConditionId: condition, pmTokenId: token,
  pmShares: 142, pmFillPrice: 0.2196, pmFeeUsdc: 1.4041, pmStakeUsdc: 32.5941,
  betMoney: 218.38047, money: 0, reward: 949.88647, odds: 4.5455,
  status: "none", pmSellState: "open", createAt: 1792063015000,
  game: "lol", match: market.question, bet: "地图3", item: "HANJIN BRION", link: 1792062975029,
};
const account = { accountId: 215, token: "{}" } as PlatformAccount;

beforeEach(() => {
  storedMarketRefresh.clear();
  vi.clearAllMocks();
  mocks.trades.mockResolvedValue([]);
  mocks.stored.mockResolvedValue([{ ...saved }]);
  mocks.get.mockImplementation(async (url: string) => {
    if (url.includes("gamma-api")) return [market];
    return { tokens: [{ token_id: "we-token", winner: false, price: 0.0005 }, { token_id: token, winner: false, price: 0.9995 }] };
  });
  // 已缓存盘口名称不能让后续轮询停止读取赛果。
  rememberPolymarketMarketBetLabel(market);
});

async function refreshOrders() {
  await fetchPolymarketVenueOrdersMerged(account);
  // 后台公开查询完成后，下一轮普通拉单仍负责应用及保存赛果。
  await new Promise(resolve => setTimeout(resolve, 0));
  return fetchPolymarketVenueOrdersMerged(account);
}

describe("stored PM buy settlement without a current trade row", () => {
  it("refreshes the 142-share stored order even with a cached label and empty trades", async () => {
    const [row] = await refreshOrders();
    expect(row).toMatchObject({ status: "win", pmMatchResult: "win", pmSellState: "open", pmShares: 142, link: saved.link });
    expect(row!.money).toBeCloseTo((142 - 32.5941) * 6.7, 5);
    expect(row!.betMoney).toBeCloseTo(saved.betMoney, 5);
    expect(row!.reward).toBeCloseTo(142 * 6.7, 5);
    expect(saved.status).toBe("none");
  });

  it("still reads public settlement when the private trades request fails", async () => {
    mocks.trades.mockRejectedValue(new Error("CLOB read unavailable"));
    expect((await refreshOrders())[0]!.pmMatchResult).toBe("win");
  });

  it("preserves actual closed-position profit while updating its match result", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, pmSellState: "closed", pmAttributedSellShares: 142,
      pmStakeUsdc: 0, pmSellProceeds: 141.85091, pmRealizedPnlUsdc: 109.25681, money: 732.020627 }]);
    const [row] = await refreshOrders();
    expect(row).toMatchObject({ pmMatchResult: "win", pmSellState: "closed", pmAttributedSellShares: 142, pmStakeUsdc: 0 });
    expect(row!.money).toBeCloseTo(732.020627, 3);
  });

  it("keeps unknown markets and failed orders unchanged", async () => {
    mocks.get.mockRejectedValue(new Error("market unavailable"));
    expect((await refreshOrders())[0]!.status).toBe("none");
    mocks.stored.mockResolvedValue([{ ...saved, status: "reject", pmShares: 0 }]);
    expect((await fetchPolymarketVenueOrdersMerged(account))[0]!.status).toBe("reject");
  });

  it("applies an official correction and marks the remaining holding settled", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, status: "win", pmMatchResult: "win", money: 733.01953 }]);
    mocks.get.mockImplementation(async (url: string) => url.includes("gamma-api") ? [market] : {
      tokens: [{ token_id: "we-token", winner: true }, { token_id: token, winner: false }],
    });
    const [row] = await refreshOrders();
    expect(row).toMatchObject({ status: "lose", pmMatchResult: "lose", pmSellState: "settled" });
    expect(row!.money).toBeCloseTo(-saved.betMoney, 5);
  });

  it("is idempotent for partial sells and preserves realized profit", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, pmSellState: "partial", pmAttributedSellShares: 42,
      pmStakeUsdc: 20, pmRealizedPnlUsdc: 5, money: 5 * 6.7 }]);
    const first = await refreshOrders();
    expect(first[0]!.money).toBeCloseTo((5 + 100 - 20) * 6.7, 5);
    expect(first[0]!.reward).toBeCloseTo(100 * 6.7, 5);
    mocks.stored.mockResolvedValue(first);
    expect((await fetchPolymarketVenueOrdersMerged(account))[0]!.money).toBeCloseTo(first[0]!.money, 5);
  });

  it("does not settle a token absent from the returned market", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, pmTokenId: "unrelated-token" }]);
    expect((await refreshOrders())[0]!.status).toBe("none");
  });

  it("returns stored orders while historical CLOB hangs, then applies its result on the next sync", async () => {
    let finish!: (value: unknown) => void;
    mocks.get.mockImplementation(async (url: string) => url.includes("gamma-api") ? [market]
      : new Promise(resolve => { finish = resolve; }));
    const [initial] = await fetchPolymarketVenueOrdersMerged(account);
    expect(initial).toMatchObject({ status: "none", link: saved.link, pmShares: 142 });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    // 再次刷新也不能加入后台在途请求或重复发起它。
    const calls = mocks.get.mock.calls.length;
    expect((await fetchPolymarketVenueOrdersMerged(account))[0]!.status).toBe("none");
    expect(mocks.get).toHaveBeenCalledTimes(calls);
    finish({ tokens: [{ token_id: "we-token", winner: false }, { token_id: token, winner: true }] });
    await vi.waitFor(async () => {
      expect((await fetchPolymarketVenueOrdersMerged(account))[0]).toMatchObject({
        status: "win", pmMatchResult: "win", pmSellState: "settled", link: saved.link,
      });
    });
  });

  it("repeated confirmed trades use background settlement without losing stored profit or identity", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, status: "win", money: 123, pmMatchResult: "win" }]);
    mocks.trades.mockResolvedValue([{ taker_order_id: saved.orderId, side: "BUY", status: "CONFIRMED",
      market: condition, asset_id: token, size: "142", price: "0.2196", match_time: Math.floor(Date.now() / 1000) }]);
    let finish!: (value: unknown) => void;
    mocks.get.mockImplementation(async (url: string) => url.includes("gamma-api") ? [market]
      : new Promise(resolve => { finish = resolve; }));
    const [row] = await fetchPolymarketVenueOrdersMerged(account);
    expect(row).toMatchObject({ orderId: saved.orderId, link: saved.link, status: "win", pmShares: 142 });
    expect(row!.money).toBeCloseTo(123, 3);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish({ tokens: [{ token_id: "we-token", winner: true }, { token_id: token, winner: false }] });
    await vi.waitFor(async () => expect((await fetchPolymarketVenueOrdersMerged(account))[0])
      .toMatchObject({ status: "lose", pmSellState: "settled", pmShares: 142 }));
  });

  it.each(["new order", "additional fill", "rejected order"])("preserves foreground confirmation for %s", async scenario => {
    mocks.stored.mockResolvedValue([{ ...saved, ...(scenario === "rejected order" ? { status: "reject" } : {}) }]);
    mocks.trades.mockResolvedValue([{ taker_order_id: scenario === "new order" ? "new-order" : saved.orderId,
      side: "BUY", status: "CONFIRMED", market: condition, asset_id: token,
      size: scenario === "additional fill" ? "150" : "142", price: "0.2196", match_time: Math.floor(Date.now() / 1000) }]);
    let finish!: (value: unknown) => void;
    mocks.get.mockImplementation(async (url: string) => url.includes("gamma-api") ? [market]
      : new Promise(resolve => { finish = resolve; }));
    let completed = false;
    const task = fetchPolymarketVenueOrdersMerged(account).then(rows => { completed = true; return rows; });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(completed).toBe(false);
    finish({ tokens: [{ token_id: "we-token", winner: false }, { token_id: token, winner: true }] });
    const rows = await task;
    const row = rows.find(row => row.orderId === (scenario === "new order" ? "new-order" : saved.orderId));
    expect(row).toMatchObject({ status: "win", pmShares: scenario === "additional fill" ? 150 : 142 });
  });
});
