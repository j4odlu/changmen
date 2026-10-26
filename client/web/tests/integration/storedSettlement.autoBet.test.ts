// 跨层集成测试：连接真实订单适配器与客户端自动下注门控；场馆 HTTP 和实际下单均 mock。
import { beforeEach, expect, it, vi } from "vitest";
import { fetchPolymarketVenueOrdersMerged } from "@changmen/venue-browser/polymarket/orders/history/orders";
import { storedMarketRefresh } from "@changmen/venue-browser/polymarket/orders/history/storedMarketRefresh";
import { updateVenueOrders } from "@/stores/account/venueOrders";
import { accountsFundingReady } from "@/stores/account/accountPicker";
import { runArbBetRound } from "@/stores/betting/runArbBetRound";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "@/stores/account/context";
import type { VenueOrder } from "@changmen/client-core/contract";

const state = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), round: vi.fn(),
  account: {} as PlatformAccount, stored: [] as VenueOrder[],
  mode: "FOK", preflight: "legacy" }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetTrades: async () => [] }));
vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: state.get }));
vi.mock("@changmen/venue-browser/polymarket/orders/history/pmStoredOrders", () => ({ loadPolymarketStoredVenueOrders: async () => state.stored }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmFee", () => ({ enrichPolymarketBuyOrdersWithFees: async (rows: VenueOrder[]) => rows }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ getOrders: fetchPolymarketVenueOrdersMerged }) }));
vi.mock("@/api/order", () => ({ saveOrders: state.save }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({
  config: { betting: true, makeUp: false }, extensionPrefs: { pmArbOrderMode: state.mode, pmFokPreflightMode: state.preflight },
}) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ loaded: true, accounts: [state.account] }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/stores/betting/pendingOrderBind", () => ({ peekPendingOrderBinds: () => [], processPendingOrderBinds: vi.fn() }));
vi.mock("@/stores/betting/a8/runA8ArbRound", () => ({ runA8ArbRound: state.round }));

const market = { conditionId: "history-condition", question: "LoL: Team WE vs HANJIN BRION - Game 3 Winner",
  clobTokenIds: ["home-token", "away-token"], outcomes: ["Team WE", "HANJIN BRION"], outcomePrices: ["0.5", "0.5"] };
const ctx = { setMessage: vi.fn(), processLoseOrders: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks(); storedMarketRefresh.clear();
  state.account = { accountId: 292, provider: "Polymarket", token: "{}", balance: 100, loadingBalance: false } as PlatformAccount;
  state.stored = [{ provider: "Polymarket", orderId: "historical-order", pmOrigin: "changmen", pmSide: "buy",
    pmConditionId: market.conditionId, pmTokenId: "away-token", pmShares: 10, pmStakeUsdc: 5,
    pmSellState: "open", status: "none", betMoney: 33.5, reward: 67, money: 0, odds: 2, createAt: 1, link: 123,
    game: "lol", match: market.question, bet: "地图3", item: "HANJIN BRION" }];
  state.save.mockResolvedValue(undefined);
});

it.each([["FOK", "legacy"], ["FOK", "optimized"]])(
  "%s/%s keeps automatic rounds available during historical reads and saves the eventual result",
  async (mode, preflight) => {
    state.mode = mode; state.preflight = preflight;
    let finish!: (value: unknown) => void;
    state.get.mockImplementation(async (url: string) => url.includes("gamma-api") ? [market]
      : new Promise(resolve => { finish = resolve; }));
    await updateVenueOrders(state.account);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(state.account.loadingBalance).toBe(false);
    expect(accountsFundingReady({ loaded: true, accounts: [state.account] } as AccountStoreContext)).toBe(true);
    expect(state.save.mock.calls.at(-1)![1][0]).toMatchObject({ status: "none", link: 123 });
    await runArbBetRound(ctx);
    expect(state.round).toHaveBeenCalledOnce();
    // 正常刷新不加入在途历史查询，不改变开关或账户筛选规则。
    const calls = state.get.mock.calls.length;
    await updateVenueOrders(state.account);
    expect(state.get).toHaveBeenCalledTimes(calls);
    finish({ tokens: [{ token_id: "home-token", winner: false }, { token_id: "away-token", winner: true }] });
    await vi.waitFor(async () => {
      await updateVenueOrders(state.account);
      expect(state.save.mock.calls.at(-1)![1][0]).toMatchObject({
        orderId: "historical-order", status: "win", pmMatchResult: "win", pmSellState: "settled", link: 123,
      });
    });
    expect(state.account.loadingBalance).toBe(false);
    await runArbBetRound(ctx); expect(state.round).toHaveBeenCalledTimes(2);
  },
);

it("a failed historical request retains the stored order and cannot block an automatic round", async () => {
  state.get.mockRejectedValue(new Error("history service offline"));
  await updateVenueOrders(state.account);
  await new Promise(resolve => setTimeout(resolve, 0));
  await updateVenueOrders(state.account);
  expect(state.save.mock.calls.at(-1)![1][0]).toMatchObject({ status: "none", link: 123, betMoney: 33.5 });
  expect(state.account.loadingBalance).toBe(false);
  await runArbBetRound(ctx); expect(state.round).toHaveBeenCalledOnce();
});
