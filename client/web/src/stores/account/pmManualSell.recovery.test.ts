import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ElMessage } from "element-plus";
import type { PlatformAccount } from "@/models/platformAccount";
import type { OrderRow } from "@/types/order";

const mocks = vi.hoisted(() => ({
  save: vi.fn(), gtcSave: vi.fn(), final: vi.fn(), sell: vi.fn(), finish: vi.fn(),
  scope: "user-one-wallet-one", session: "session-one",
  orders: new Map<number, OrderRow[]>(), fetch: vi.fn(),
  account: { accountId: 9, provider: "Polymarket", token: "{}" } as PlatformAccount,
}));
vi.mock("@/api/order", () => ({ saveOrders: mocks.save }));
vi.mock("@/orderModes/gtc/ordersApi", () => ({ saveOrders: mocks.gtcSave }));
vi.mock("@/shared/orderLink", () => ({ groupOrdersByEffectiveLink: (rows: OrderRow[]) => new Map([[11, rows]]) }));
vi.mock("@/shared/pmOrderDisplay", () => ({ formatPolymarketApiDecimal: String }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.session, isAuthSessionCurrent: (v: string) => v === mocks.session }));
vi.mock("element-plus", () => ({ ElMessage: { error: vi.fn(), warning: vi.fn(), success: vi.fn() }, ElMessageBox: { confirm: async () => {} } }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: [mocks.account], findAccount: () => mocks.account }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ get orders() { return mocks.orders; }, set orders(v) { mocks.orders = v; }, fetchOrders: mocks.fetch }) }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({
  awaitPolymarketManualSellFinalOutcome: mocks.final, sellPolymarketBuyPosition: mocks.sell,
  finishPmSubmitAttempt: mocks.finish, pmAccountSubmitAttempts: () => [], pmSubmitScope: () => mocks.scope,
  resolvePmRemainingShares: (row: OrderRow) => Number(row.PmShares) - Number(row.PmAttributedSellShares || 0),
  hasOpenPolymarketPosition: () => true,
}));
const row = { OrderID: "buy-one", PlayerID: 9, Type: "Polymarket", Link: 11,
  PmTokenId: "123", PmShares: 10, PmSellState: "open", BetMoney: 67, Money: 0 } as OrderRow;
const patch = [{ provider: "Polymarket", orderId: "buy-one", pmSide: "buy", pmSellState: "closed",
  pmAttributedSellShares: 10, pmStakeUsdc: 0, money: 13.4, pmRealizedPnlUsdc: 2, pmSellProceeds: 12,
  pmLastSellOrderId: "sell-one" }];

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); sessionStorage.clear();
  mocks.scope = "user-one-wallet-one"; mocks.session = "session-one";
  mocks.orders = new Map([[11, [{ ...row }]]]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

test("failed accounting survives reload despite optimistic closed display and replays the exact patch", async () => {
  mocks.save.mockRejectedValue(new Error("DB unavailable"));
  mocks.sell.mockImplementation(async ({ onSubmitted }) => {
    onSubmitted({ sellOrderId: "sell-one", fallbackPrice: 0.6, sharesWanted: 10 });
    return { ok: true, ordersToSave: patch, sharesSold: 10 };
  });
  let api = await import("./pmManualSell");
  await api.confirmAndSellPmBuyOrder(row);
  expect(api.isPmManualSellClosing("buy-one")).toBe(true);
  expect([...mocks.orders.values()].flat().find(r => r.OrderID === "buy-one")?.PmSellState).toBe("closed");
  expect(mocks.finish).not.toHaveBeenCalled();
  vi.resetModules(); api = await import("./pmManualSell");
  mocks.save.mockResolvedValue(undefined);
  await api.resumePmManualSellClosings();
  expect(mocks.save).toHaveBeenLastCalledWith(mocks.account, patch);
  expect(mocks.final).not.toHaveBeenCalled();
  expect(mocks.finish).toHaveBeenCalledWith(mocks.account, "sell-one");
  expect(api.isPmManualSellClosing("buy-one")).toBe(false);
});

test("changing wallet preserves the old closing without querying or releasing its journal", async () => {
  const api = await import("./pmManualSell");
  api.trackPmManualSellClosing("buy-one", { sellOrderId: "sell-one" }, mocks.account);
  mocks.scope = "user-one-wallet-two";
  await api.resumePmManualSellClosings();
  expect(mocks.final).not.toHaveBeenCalled();
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(api.isPmManualSellClosing("buy-one")).toBe(true);
});

test("a session switch while confirming cannot save the old result under the new session", async () => {
  const api = await import("./pmManualSell");
  api.trackPmManualSellClosing("buy-one", { sellOrderId: "sell-one" }, mocks.account);
  mocks.final.mockImplementation(async () => {
    mocks.session = "session-two";
    return { outcome: "filled", ordersToSave: patch };
  });
  await api.resumePmManualSellClosings();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(api.isPmManualSellClosing("buy-one")).toBe(true);
});

test.each([true, false])("only the exact sell accounting event releases a restored partial closing: %s", async (sameSell) => {
  const api = await import("./pmManualSell");
  api.trackPmManualSellClosing("buy-one", { sellOrderId: "sell-one" }, mocks.account);
  mocks.orders = new Map([[11, [{ ...row, PmAttributedSellShares: sameSell ? 3 : 10,
    PmSellState: sameSell ? "partial" : "closed", PmLastSellOrderId: sameSell ? "sell-one" : "another-sell" }]]]);
  await api.resumePmManualSellClosings();
  expect(mocks.final).not.toHaveBeenCalled();
  expect(mocks.finish).toHaveBeenCalledTimes(sameSell ? 1 : 0);
  expect(api.isPmManualSellClosing("buy-one")).toBe(!sameSell);
});

test("a GTC manual sale uses its own cash reconciliation and retains the execution identity", async () => {
  mocks.gtcSave.mockResolvedValue(undefined);
  mocks.sell.mockImplementation(async ({ onSubmitted }) => {
    onSubmitted({ sellOrderId: "sell-one", fallbackPrice: 0.6, sharesWanted: 10 });
    return { ok: true, ordersToSave: patch, sharesSold: 10 };
  });
  const api = await import("./pmManualSell");
  await api.confirmAndSellPmBuyOrder({ ...row, PmGtcExecutionId: "own-gtc" });
  expect(mocks.gtcSave).toHaveBeenCalledWith(mocks.account, patch.map(item => ({ ...item, pmGtcExecutionId: "own-gtc" })));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(api.isPmManualSellClosing("buy-one")).toBe(false);
});

test("missing GTC net cash keeps the original sell pending and retries without falling through to FOK", async () => {
  mocks.gtcSave.mockRejectedValue(new Error("GTC 原卖单净回款待核实"));
  mocks.sell.mockImplementation(async ({ onSubmitted }) => {
    onSubmitted({ sellOrderId: "sell-one", fallbackPrice: 0.6, sharesWanted: 10 });
    return { ok: true, ordersToSave: patch, sharesSold: 10 };
  });
  const api = await import("./pmManualSell");
  await api.confirmAndSellPmBuyOrder({ ...row, PmGtcExecutionId: "own-gtc" });
  expect(mocks.gtcSave).toHaveBeenCalledTimes(2);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  expect(api.isPmManualSellClosing("buy-one")).toBe(true);
  expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining("成交确认、净回款核对或订单保存尚未完成"));
  expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining("自动重试，请勿重复卖出"));
  expect(ElMessage.error).not.toHaveBeenCalled();
});
