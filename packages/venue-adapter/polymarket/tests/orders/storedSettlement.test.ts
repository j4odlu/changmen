import type { VenueOrder } from "../../../contract";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPolymarketVenueOrdersMerged } from "../../orders";
import { rememberPolymarketMarketBetLabel } from "../../markets/orderBetLabel";

const mocks = vi.hoisted(() => ({ trades: vi.fn(), get: vi.fn(), stored: vi.fn() }));
vi.mock("../../pmClientApi", () => ({ pmGetTrades: mocks.trades }));
vi.mock("../../transport", () => ({ polymarketPluginGet: mocks.get }));
vi.mock("../../pmStoredOrders", () => ({ loadPolymarketStoredVenueOrders: mocks.stored }));
vi.mock("../../pmFee", () => ({ enrichPolymarketBuyOrdersWithFees: async (rows: VenueOrder[]) => rows }));

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

describe("stored PM buy settlement without a current trade row", () => {
  it("refreshes the 142-share stored order even with a cached label and empty trades", async () => {
    const [row] = await fetchPolymarketVenueOrdersMerged(account);
    expect(row).toMatchObject({ status: "win", pmMatchResult: "win", pmSellState: "open", pmShares: 142, link: saved.link });
    expect(row!.money).toBeCloseTo((142 - 32.5941) * 6.7, 5);
    expect(row!.betMoney).toBeCloseTo(saved.betMoney, 5);
    expect(row!.reward).toBeCloseTo(142 * 6.7, 5);
    expect(saved.status).toBe("none");
  });

  it("still reads public settlement when the private trades request fails", async () => {
    mocks.trades.mockRejectedValue(new Error("CLOB read unavailable"));
    expect((await fetchPolymarketVenueOrdersMerged(account))[0]!.pmMatchResult).toBe("win");
  });

  it("preserves actual closed-position profit while updating its match result", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, pmSellState: "closed", pmAttributedSellShares: 142,
      pmStakeUsdc: 0, pmSellProceeds: 141.85091, pmRealizedPnlUsdc: 109.25681, money: 732.020627 }]);
    const [row] = await fetchPolymarketVenueOrdersMerged(account);
    expect(row).toMatchObject({ pmMatchResult: "win", pmSellState: "closed", pmAttributedSellShares: 142, pmStakeUsdc: 0 });
    expect(row!.money).toBeCloseTo(732.020627, 3);
  });

  it("keeps unknown markets and failed orders unchanged", async () => {
    mocks.get.mockRejectedValue(new Error("market unavailable"));
    expect((await fetchPolymarketVenueOrdersMerged(account))[0]!.status).toBe("none");
    mocks.stored.mockResolvedValue([{ ...saved, status: "reject", pmShares: 0 }]);
    expect((await fetchPolymarketVenueOrdersMerged(account))[0]!.status).toBe("reject");
  });

  it("applies an official correction and marks the remaining holding settled", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, status: "win", pmMatchResult: "win", money: 733.01953 }]);
    mocks.get.mockImplementation(async (url: string) => url.includes("gamma-api") ? [market] : {
      tokens: [{ token_id: "we-token", winner: true }, { token_id: token, winner: false }],
    });
    const [row] = await fetchPolymarketVenueOrdersMerged(account);
    expect(row).toMatchObject({ status: "lose", pmMatchResult: "lose", pmSellState: "settled" });
    expect(row!.money).toBeCloseTo(-saved.betMoney, 5);
  });

  it("is idempotent for partial sells and preserves realized profit", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, pmSellState: "partial", pmAttributedSellShares: 42,
      pmStakeUsdc: 20, pmRealizedPnlUsdc: 5, money: 5 * 6.7 }]);
    const first = await fetchPolymarketVenueOrdersMerged(account);
    expect(first[0]!.money).toBeCloseTo((5 + 100 - 20) * 6.7, 5);
    expect(first[0]!.reward).toBeCloseTo(100 * 6.7, 5);
    mocks.stored.mockResolvedValue(first);
    expect((await fetchPolymarketVenueOrdersMerged(account))[0]!.money).toBeCloseTo(first[0]!.money, 5);
  });

  it("does not settle a token absent from the returned market", async () => {
    mocks.stored.mockResolvedValue([{ ...saved, pmTokenId: "unrelated-token" }]);
    expect((await fetchPolymarketVenueOrdersMerged(account))[0]!.status).toBe("none");
  });
});
