import type { GtcOrderPlan } from "@changmen/shared/pm_gtc_order";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/client-core/contract";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOrderStore } from "@/stores/orderStore";
import { nativeGtcPendingRows } from "./orderDisplay";
import { mergeGtcPendingDisplayEntries } from "./orderDisplayProjection";
import { isRebindableOrderRow, orderLinkMapEntries } from "@/shared/orderLink";
import { createStoredGtcOrder, mutateStoredGtcOrder } from "./orderStore";
import { pendingGtcResults } from "./localStore";
import { saveOrders } from "./ordersApi";
import { flushGtcResults, startGtcOrderSync, stopGtcOrderSync } from "@/stores/account/gtcOrderSync";
import { rememberGtcOrderReference } from "./executionProjection";

const mock = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn(), list: vi.fn(), report: vi.fn(), accounts: [] as PlatformAccount[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => true, post: mock.post,
  unwrap: (response: { success: number; info: unknown }) => { if (response.success !== 1) throw new Error("offline"); return response.info; } }));
vi.mock("@/api/order", () => ({ registerOrderSyncProjection: () => () => {} }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", isLoggedIn: true }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: mock.accounts, loaded: true }) }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ orderReportMessage: mock.report }) }));
vi.mock("@/api/esport", () => ({ getOrderList: mock.list }));
vi.mock("./api", () => ({ listGtc: mock.legacy }));
vi.mock("./sellFinancials", () => ({ reconcileGtcSellFinancials: async (_account: PlatformAccount, orders: VenueOrder[]) => orders }));
const hash = `0x${"b".repeat(64)}`;
const id = "11111111-1111-4111-8111-111111111111";
const plan: GtcOrderPlan = { tokenId: "t", conditionId: "c", shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5", protocol: 2, negRisk: false, route: "direct", orderHash: hash };
beforeEach(() => {
  stopGtcOrderSync(); vi.clearAllMocks(); vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  setActivePinia(createPinia()); mock.list.mockResolvedValue({ list: [] });
  mock.accounts.length = 0;
  mock.post.mockResolvedValue({ success: 1, info: true }); mock.legacy.mockRejectedValue(new Error("old history unavailable"));
});
afterEach(stopGtcOrderSync);
async function original() {
  let row = await createStoredGtcOrder(id, "owner", 1, "maker", plan, { item: "YES", linkId: -Date.now() });
  row = await mutateStoredGtcOrder("owner", id, row.revision, { kind: "authorize" });
  return mutateStoredGtcOrder("owner", id, row.revision, { kind: "receipt", receipt: { success: true, orderID: hash } });
}
it("saves a new original and its sell through exact identity without reading old executions", async () => {
  await original(); rememberGtcOrderReference(id, "owner", 1, hash, hash);
  const account = { accountId: 1, provider: "Polymarket" } as PlatformAccount;
  const sell: VenueOrder & { pmGtcExecutionId: string } = { provider: "Polymarket", orderId: "sell", pmBuyOrderId: hash, pmSide: "sell", pmGtcExecutionId: id,
    odds: 2, createAt: Date.now(), betMoney: 1, reward: 0, money: 0, status: "none", game: "CS2", match: "match", bet: "winner", item: "YES" };
  await saveOrders(account, [sell]);
  expect(mock.legacy).not.toHaveBeenCalled();
  expect(mock.post).toHaveBeenCalledExactlyOnceWith("Pm_GtcSaveOrders", expect.objectContaining({ playerId: 1,
    origins: [{ executionId: id, playerId: 1, provider: "Polymarket", orderId: hash }] }));
});
it("confirmed native fills use the existing result queue and common save protocol", async () => {
  const row = await original();
  await mutateStoredGtcOrder("owner", id, row.revision, { kind: "facts", facts: { order: { id: hash, original: "10", matched: "3", status: "LIVE", tradeIds: ["one"] },
    fills: [{ key: "one", tradeId: "one", bucket: "maker", role: "MAKER", shares: "3", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 }], complete: true, observedAt: 1 } });
  startGtcOrderSync("owner"); await flushGtcResults();
  expect(mock.post).toHaveBeenCalledWith("Pm_GtcSyncResult", { result: expect.objectContaining({ executionId: id, orderId: hash, buyShares: "3", principalUsdc: "1.5" }) }, "", { errorTip: false });
  expect(await pendingGtcResults("owner")).toEqual([]); expect(mock.legacy).not.toHaveBeenCalled();
});
it("replaces the completed display-only original with the persisted row so its badge can be rebound", async () => {
  const originalRow = await original();
  const row = await mutateStoredGtcOrder("owner", id, originalRow.revision, { kind: "facts", facts: {
    order: { id: hash, original: "10", matched: "10", status: "MATCHED", tradeIds: ["one"] },
    fills: [{ key: "one", tradeId: "one", bucket: "taker", role: "TAKER", shares: "10", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 }],
    complete: true, observedAt: 1 } });
  const store = useOrderStore(); store.filterAccountId = 1;
  const display = () => mergeGtcPendingDisplayEntries(orderLinkMapEntries(store.orders),
    nativeGtcPendingRows([...store.orders.values()].flat(), [row], store.orderDate, store.filterAccountId));
  expect(isRebindableOrderRow(display()[0]![1][0]!)).toBe(false);
  mock.list.mockResolvedValue({ list: [{ OrderID: hash, PlayerID: 1, Type: "Polymarket", Link: row.context.linkId,
    CreateAt: row.createdAt, PmGtcExecutionId: id, PmOrderType: "GTC", PmSide: "buy", BetMoney: 33.5 }] });
  startGtcOrderSync("owner"); await flushGtcResults();
  const rows = display().flatMap(([, orders]) => orders);
  expect(rows).toHaveLength(1); expect(rows[0]!.DisplayOnly).toBeUndefined();
  expect(isRebindableOrderRow(rows[0]!)).toBe(true);
  expect(store.filterAccountId).toBe(1); expect(mock.report).not.toHaveBeenCalled();
});
it("loads an accepted zero-fill original as an ordinary draggable row and counts its later fill once", async () => {
  const row = await original();
  const account = { accountId: 1, provider: "Polymarket", balance: 0 } as PlatformAccount;
  mock.accounts.push(account);
  const store = useOrderStore();
  const persisted = { OrderID: hash, PlayerID: 1, Type: "Polymarket", Link: row.context.linkId,
    CreateAt: row.createdAt, PmGtcExecutionId: id, PmOrderType: "GTC" as const, PmSide: "buy" as const,
    PmGtcBuyShares: 0, PmShares: 0, BetMoney: 0, Money: 0, Status: "None" };
  mock.list.mockResolvedValue({ list: [persisted] });
  startGtcOrderSync("owner"); await flushGtcResults();
  expect(mock.post).toHaveBeenCalledWith("Pm_GtcSyncResult", { result: expect.objectContaining({ orderId: hash,
    buyShares: "0", fills: [], acceptedOrder: { shares: "10", price: "0.5" } }) }, "", { errorTip: false });
  expect([...store.orders.values()].flat()).toHaveLength(1);
  expect(isRebindableOrderRow([...store.orders.values()].flat()[0]!)).toBe(true);
  store.updateTodayProfit([persisted]);
  expect(account.orderCount).toBe(0); expect(account.unsettle).toBe(0);
  const filled = { ...persisted, PmGtcBuyShares: 3, PmShares: 3, BetMoney: 10, PmFillPrice: 0.5 };
  await mutateStoredGtcOrder("owner", id, row.revision, { kind: "facts", facts: {
    order: { id: hash, original: "10", matched: "3", status: "CANCELED", tradeIds: ["one"] },
    fills: [{ key: "one", tradeId: "one", bucket: "maker", role: "MAKER", shares: "3", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 }],
    complete: true, observedAt: 1 } });
  mock.list.mockResolvedValue({ list: [filled] });
  await flushGtcResults();
  expect([...store.orders.values()].flat()).toHaveLength(1);
  expect([...store.orders.values()].flat()[0]!.OrderID).toBe(hash);
  store.updateTodayProfit([filled]); expect(account.orderCount).toBe(1); expect(account.unsettle).toBe(1);
});
it.each(["date", "session"])("ignores a late background order-list read after the %s changes", async stage => {
  const store = useOrderStore(); const date = store.orderDate;
  store.orders.set(123, [{ OrderID: "keep", Link: 123 }]);
  const previous = store.orders;
  let resolve!: (page: unknown) => void; let sessionCurrent = true;
  mock.list.mockReturnValue(new Promise(done => { resolve = done; }));
  const reading = store.fetchOrders(date, { sideEffects: false,
    isCurrent: () => sessionCurrent && store.orderDate === date });
  if (stage === "date") store.orderDate = "2026-01-01";
  else sessionCurrent = false;
  resolve({ list: [] });
  expect(await reading).toBe(false); expect(store.orders).toBe(previous);
  expect(store.orders.get(123)?.[0]?.OrderID).toBe("keep");
});
