import type { GtcFacts, GtcOrderPlan } from "@changmen/shared/pm_gtc_order";
import type { PlatformAccount } from "@/models/platformAccount";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStoredGtcOrder, mutateStoredGtcOrder, listStoredGtcOrders } from "./orderStore";
import * as storage from "./orderStore";
import { pendingGtcResults } from "./localStore";
import { gtcOrders } from "./orderState";
import { gtcOrderReconciled } from "./core/orderRecord";
import { startNativeGtcOrders, stopNativeGtcOrders, recoverGtcOrders, pollGtcOrder, cancelNativeGtcOrder, changeGtcOrder, flushGtcOrder, currentGtcOrder } from "./orderRuntime";

const mock = vi.hoisted(() => ({ read: vi.fn(), cancel: vi.fn(), session: 1,
  account: {} as PlatformAccount, loop: undefined as unknown as { active: () => boolean; tick: () => void }, history: vi.fn(), observe: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mock.session, isAuthSessionCurrent: (stamp: number) => stamp === mock.session }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: () => mock.account }) }));
vi.mock("@/runtime/orderMonitoring/loop", () => ({ createOrderMonitorLoop: (context: typeof mock.loop) => { mock.loop = context; return { start: vi.fn(), stop: vi.fn() }; } }));
vi.mock("@changmen/venue-browser/polymarket/gtc/index", () => ({ readGtcFacts: mock.read, pmCancelOrder: mock.cancel, readGtcTradeHistory: mock.history }));
vi.mock("@changmen/venue-browser/adapter/polymarket", async importOriginal => ({ ...await importOriginal<typeof import("@changmen/venue-browser/adapter/polymarket")>(), observePolymarketOrderWatch: mock.observe }));
const hash = `0x${"b".repeat(64)}`;
const plan: GtcOrderPlan = { tokenId: "token", conditionId: "condition", shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5", protocol: 2, negRisk: false, route: "direct", orderHash: hash };
const facts = (quantity = "3", status = "LIVE", fee: string | null = "0"): GtcFacts => ({
  order: { id: hash, original: "10", matched: quantity, status, tradeIds: quantity === "0" ? [] : ["trade"] },
  fills: quantity === "0" ? [] : [{ key: "trade", tradeId: "trade", bucket: "maker", role: "MAKER", shares: quantity, price: "0.5", fee, status: "CONFIRMED", updatedAt: 1 }], complete: true, observedAt: 1,
});
beforeEach(() => {
  stopNativeGtcOrders(); sessionStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks(); mock.session = 1;
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  mock.account = { accountId: 1, provider: "Polymarket", token: "wallet-binding" } as PlatformAccount;
  mock.read.mockResolvedValue(facts()); mock.cancel.mockResolvedValue({ canceled: [hash] }); mock.observe.mockReturnValue(() => {}); mock.history.mockResolvedValue({ trades: [], complete: true });
});
afterEach(stopNativeGtcOrders);
async function seed(authorized = true) {
  let row = await createStoredGtcOrder("id", "owner", 1, "maker", plan, { item: "YES" });
  if (authorized) row = await mutateStoredGtcOrder("owner", row.id, row.revision, { kind: "authorize" });
  startNativeGtcOrders("owner"); await recoverGtcOrders();
  return row;
}
it("restores a consumed send permit by querying the same hash, without any submit capability", async () => {
  await seed();
  expect(currentGtcOrder("id")).toMatchObject({ submit: "dispatching", pmAuthorized: true, submissionClosed: true });
  await pollGtcOrder("id");
  expect(mock.read).toHaveBeenCalledWith(mock.account, plan, hash, expect.any(Number), undefined);
  expect(currentGtcOrder("id")).toMatchObject({ submit: "accepted", orderId: hash, matched: "3", open: "7" });
  await expect(changeGtcOrder("id", { kind: "authorize" })).rejects.toThrow("禁止重发");
  stopNativeGtcOrders(); startNativeGtcOrders("owner"); await recoverGtcOrders();
  await expect(changeGtcOrder("id", { kind: "authorize" })).rejects.toThrow("禁止重发");
});
it("an unsubmitted record closes on recovery and never queries or acquires a new send permit", async () => {
  await seed(false); await pollGtcOrder("id");
  expect(currentGtcOrder("id")).toMatchObject({ submit: "not_attempted", pmAuthorized: false, terminal: true, open: "0" });
  expect(mock.read).not.toHaveBeenCalled(); expect(gtcOrderReconciled(currentGtcOrder("id"))).toBe(true);
  await expect(changeGtcOrder("id", { kind: "authorize" })).rejects.toThrow("禁止重发");
});
it("cancels only the remaining quantity and keeps all prior confirmed fills", async () => {
  await seed(); await pollGtcOrder("id"); mock.read.mockResolvedValue(facts("3", "CANCELED"));
  await cancelNativeGtcOrder("id");
  expect(mock.cancel).toHaveBeenCalledExactlyOnceWith(mock.account, hash);
  expect(currentGtcOrder("id")).toMatchObject({ matched: "3", principal: "1.5", open: "0", terminal: true, cancel: { state: "acknowledged" } });
  expect(gtcOrderReconciled(currentGtcOrder("id"))).toBe(true);
  expect((await pendingGtcResults("owner"))[0]!.result).toMatchObject({ executionId: "id", buyShares: "3", principalUsdc: "1.5" });
});
it("query failure leaves confirmed quantities intact and retry uses the same original id", async () => {
  await seed(); await pollGtcOrder("id"); mock.read.mockRejectedValueOnce(new Error("offline"));
  await expect(pollGtcOrder("id")).rejects.toThrow("offline");
  expect(currentGtcOrder("id")).toMatchObject({ matched: "3", principal: "1.5" }); expect(gtcOrders.queryIssues.id).toBeDefined();
  await pollGtcOrder("id"); expect(gtcOrders.queryIssues.id).toBeUndefined(); expect(mock.read.mock.calls.every(call => call[2] === hash)).toBe(true);
});
it("keeps unresolved fees active even after the remainder is canceled", async () => {
  await seed(); mock.read.mockResolvedValue(facts("3", "CANCELED", null)); await pollGtcOrder("id");
  expect(gtcOrderReconciled(currentGtcOrder("id"))).toBe(false); expect(await pendingGtcResults("owner")).toEqual([]);
  mock.read.mockResolvedValue(facts("3", "CANCELED")); await pollGtcOrder("id");
  expect(gtcOrderReconciled(currentGtcOrder("id"))).toBe(true); expect(await pendingGtcResults("owner")).toHaveLength(1);
});
it("official acceptance remains visible while storage is down; only saving is retried", async () => {
  await seed();
  const writer = vi.spyOn(storage, "mutateStoredGtcOrder").mockRejectedValue(new Error("disk offline"));
  await changeGtcOrder("id", { kind: "receipt", receipt: { success: true, orderID: hash } });
  expect(currentGtcOrder("id")).toMatchObject({ submit: "accepted", orderId: hash });
  expect(gtcOrders.saveIssues.id).toBeDefined(); expect(sessionStorage.getItem("PM_GTC_ORDER_V2_COPIES:owner")).toContain(hash);
  writer.mockRestore(); await flushGtcOrder("id");
  expect((await listStoredGtcOrders("owner"))[0]!.submit).toBe("accepted"); expect(gtcOrders.saveIssues.id).toBeUndefined();
  expect(mock.read).not.toHaveBeenCalled();
});
it("a late account-change response cannot overwrite the new session's order state", async () => {
  await seed(); let finish!: (value: GtcFacts) => void;
  mock.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const task = pollGtcOrder("id"); await vi.waitFor(() => expect(mock.read).toHaveBeenCalled());
  mock.account.token = "different-wallet"; finish(facts());
  await expect(task).rejects.toThrow("账号已变更"); expect(currentGtcOrder("id").matched).toBe("0");
});
it("an empty native order set sends no PM query and no websocket subscription", async () => {
  startNativeGtcOrders("owner"); await recoverGtcOrders(); mock.loop.tick();
  expect(mock.read).not.toHaveBeenCalled(); expect(mock.history).not.toHaveBeenCalled(); expect(mock.observe).not.toHaveBeenCalled();
});
