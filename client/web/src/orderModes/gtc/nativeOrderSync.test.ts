import type { GtcOrderPlan } from "@changmen/shared/pm_gtc_order";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/client-core/contract";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStoredGtcOrder, mutateStoredGtcOrder } from "./orderStore";
import { pendingGtcResults } from "./localStore";
import { saveOrders } from "./ordersApi";
import { flushGtcResults, startGtcOrderSync, stopGtcOrderSync } from "@/stores/account/gtcOrderSync";
import { rememberGtcOrderReference } from "./executionProjection";

const mock = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => true, post: mock.post,
  unwrap: (response: { success: number; info: unknown }) => { if (response.success !== 1) throw new Error("offline"); return response.info; } }));
vi.mock("@/api/order", () => ({ registerOrderSyncProjection: () => () => {} }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", isLoggedIn: true }) }));
vi.mock("./api", () => ({ listGtc: mock.legacy }));
vi.mock("./sellFinancials", () => ({ reconcileGtcSellFinancials: async (_account: PlatformAccount, orders: VenueOrder[]) => orders }));
const hash = `0x${"b".repeat(64)}`;
const id = "11111111-1111-4111-8111-111111111111";
const plan: GtcOrderPlan = { tokenId: "t", conditionId: "c", shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5", protocol: 2, negRisk: false, route: "direct", orderHash: hash };
beforeEach(() => {
  stopGtcOrderSync(); vi.clearAllMocks(); vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  mock.post.mockResolvedValue({ success: 1, info: true }); mock.legacy.mockRejectedValue(new Error("old history unavailable"));
});
afterEach(stopGtcOrderSync);
async function original() {
  let row = await createStoredGtcOrder(id, "owner", 1, "maker", plan, { item: "YES", linkId: -1 });
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
