/** [changmen 扩展] 单一查询同时更新原单、关联上下文和补单交接。 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { OrderRow } from "@/types/order";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { startRayOrderMonitoring, stopRayOrderMonitoring } from "./runtime";
import { registerRayOrderContext } from "./contexts";
import { useRayOrderContextStore } from "./contextStore";
import { rayMonitoring } from "./state";
const mock = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), save: vi.fn(), initialSave: vi.fn(), bind: vi.fn(), makeup: vi.fn(),
  owner: "u1", enabled: false, rows: new Map<number, OrderRow[]>(), accounts: [] as PlatformAccount[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mock.owner, isAuthSessionCurrent: (owner: string) => owner === mock.owner }));
vi.mock("@/runtime/orderPolling/ray", () => ({ readRayAccountOrders: mock.read, resetRayOrderPolling: vi.fn() }));
vi.mock("./api", () => ({ loadRayMonitorOrders: mock.load, saveRayMonitorOrders: mock.save }));
vi.mock("@/api/order", () => ({ saveOrders: mock.initialSave }));
vi.mock("@/api/chat", () => ({ saveUserLog: vi.fn().mockResolvedValue(true) }));
vi.mock("@/services/orderObservation", () => ({ observeOrder: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbOrderId: mock.bind, refreshOrderListAfterBind: vi.fn() }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mock.owner, extensionPrefs: { rayLateRejectAutoMakeup: { enabled: mock.enabled } } }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: mock.accounts, findAccount: (id: number) => mock.accounts.find(a => a.accountId === id) }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: mock.rows, orderDate: "2026-10-14", fetchOrders: vi.fn().mockResolvedValue(true) }) }));
vi.mock("./autoMakeup", () => ({ handleRayLateRejectAutoMakeup: mock.makeup }));
function venue(id = "one", status: VenueOrder["status"] = "none"): VenueOrder {
  return { provider: "RAY", orderId: id, status, odds: 2, betMoney: 70, createAt: 100_000,
    match: "Alpha vs Beta", bet: "map1", item: "Beta", game: "CS2", money: 0, reward: 0 };
}
function context(linkId = 100, original: VenueOrder[] = [venue()]) {
  registerRayOrderContext({ linkId, matchId: 1, betId: 10, side: "B", accountId: 2, submittedAt: 100_000,
    match: "Alpha vs Beta", bet: "map1", item: "Beta", target: "Away", odds: 2, betMoney: 70,
    anchorConfirmed: true, anchorProvider: "OB", anchorAccountId: 1, anchorBetMoney: 70, anchorOdds: 2,
    initialOrders: original, initialRejected: false });
}
async function flush() { await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled(); }
beforeEach(() => {
  setActivePinia(createPinia()); stopRayOrderMonitoring(); sessionStorage.clear(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(100_000);
  mock.owner = "u1"; mock.enabled = false; mock.rows.clear(); mock.accounts = [new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" })];
  mock.load.mockResolvedValue([]); mock.save.mockResolvedValue(undefined); mock.initialSave.mockResolvedValue(undefined); mock.bind.mockResolvedValue(true);
  mock.read.mockResolvedValue([venue()]);
  mock.makeup.mockImplementation(async (task, current) => { if (current()) useRayOrderContextStore().patch(task.key, { autoMakeupStatus: "enqueued" }); });
});
afterEach(() => { stopRayOrderMonitoring(); vi.useRealTimers(); });
it("known orders and two contexts share one account request and one timer", async () => {
  mock.rows.set(1, [{ Type: "RAY", PlayerID: 2, OrderID: "one", Link: 100, Status: "None" },
    { Type: "RAY", PlayerID: 2, OrderID: "two", Link: 101, Status: "None", PmGtcExecutionId: "gtc" }]);
  context(); context(101, [venue("two")]); mock.read.mockResolvedValue([venue(), venue("two")]);
  startRayOrderMonitoring(); startRayOrderMonitoring(); await flush();
  expect(mock.read).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
  expect(useRayOrderContextStore().activeTasks.map(task => task.pollCount)).toEqual([1, 1]);
  await vi.advanceTimersByTimeAsync(5000); expect(mock.read).toHaveBeenCalledTimes(2);
  expect(mock.initialSave).not.toHaveBeenCalled(); expect(mock.bind).not.toHaveBeenCalled();
});
it("a delayed original appearing after five minutes is bound using the same query, then monitored to terminal", async () => {
  context(100, []); mock.read.mockResolvedValue([]); startRayOrderMonitoring(); await flush();
  await vi.advanceTimersByTimeAsync(6 * 60_000); expect(useRayOrderContextStore().activeTasks).toHaveLength(1);
  mock.read.mockResolvedValue([venue("one", "reject")]); await vi.advanceTimersByTimeAsync(5000); await flush();
  expect(mock.initialSave).toHaveBeenCalledExactlyOnceWith(mock.accounts[0], [expect.objectContaining({ orderId: "one", link: 100 })]);
  expect(mock.bind).toHaveBeenCalledExactlyOnceWith(100, "RAY", 2, "one");
  expect(mock.save).not.toHaveBeenCalled();
  expect(useRayOrderContextStore().taskForLink(100)).toMatchObject({ status: "rejected", autoMakeupStatus: "disabled" });
  const count = mock.read.mock.calls.length; await vi.advanceTimersByTimeAsync(15000); expect(mock.read).toHaveBeenCalledTimes(count);
});
it("one saved reject dispatches makeup once and ends the unified monitor for that original", async () => {
  context(); mock.enabled = true; mock.read.mockResolvedValue([venue("one", "reject")]); startRayOrderMonitoring(); await flush();
  expect(mock.makeup).toHaveBeenCalledOnce(); expect(useRayOrderContextStore().taskForLink(100)?.autoMakeupStatus).toBe("enqueued");
  expect(rayMonitoring.orders.get("2:one")).toMatchObject({ phase: "closed", status: "reject" });
  await vi.advanceTimersByTimeAsync(15000); await flush(); expect(mock.makeup).toHaveBeenCalledOnce(); expect(mock.read).toHaveBeenCalledOnce();
});
it("failed state saves do not drop context or stop retries", async () => {
  mock.rows.set(1, [{ Type: "RAY", PlayerID: 2, OrderID: "one", Link: 100, Status: "None" }]); context(); mock.enabled = true;
  mock.read.mockResolvedValue([venue("one", "reject")]); mock.save.mockRejectedValueOnce(new Error("database down")); startRayOrderMonitoring(); await flush();
  expect(mock.makeup).not.toHaveBeenCalled(); expect(useRayOrderContextStore().activeTasks).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000); await flush(); expect(mock.makeup).toHaveBeenCalledOnce(); expect(mock.read).toHaveBeenCalledTimes(2);
});
it("ambiguous candidates never save, bind or dispatch makeup", async () => {
  context(100, []); mock.enabled = true; mock.read.mockResolvedValue([venue("one", "reject"), venue("two", "reject")]); startRayOrderMonitoring(); await flush();
  expect(useRayOrderContextStore().taskForLink(100)?.status).toBe("ambiguous"); expect(mock.initialSave).not.toHaveBeenCalled();
  expect(mock.bind).not.toHaveBeenCalled(); expect(mock.makeup).not.toHaveBeenCalled();
});
it("failed binding retries on the next unified account poll", async () => {
  context(100, []); mock.bind.mockResolvedValueOnce(false); startRayOrderMonitoring(); await flush();
  expect(useRayOrderContextStore().taskForLink(100)?.bindingSaved).not.toBe(true);
  await vi.advanceTimersByTimeAsync(5000); await flush(); expect(mock.bind).toHaveBeenCalledTimes(2);
  expect(mock.initialSave).toHaveBeenCalledOnce();
  expect(useRayOrderContextStore().taskForLink(100)?.bindingSaved).toBe(true); expect(mock.read).toHaveBeenCalledTimes(2);
});
it("a late response after logout cannot bind, save or dispatch makeup", async () => {
  context(100, []); mock.enabled = true; let release!: (rows: VenueOrder[]) => void;
  mock.read.mockImplementation(() => new Promise(resolve => { release = resolve; })); startRayOrderMonitoring(); await flush();
  stopRayOrderMonitoring(); mock.owner = "u2"; release([venue("one", "reject")]); await flush();
  expect(mock.initialSave).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(mock.makeup).not.toHaveBeenCalled();
});
it("migrated contexts and original caches do not introduce a second timer", async () => {
  context(); const saved = [...useRayOrderContextStore().tasks.values()];
  sessionStorage.setItem("changmen:ray-reject-monitor:v1:u1", JSON.stringify(saved.map(task => ({ ...task, expiresAt: 1, monitorMinutes: 5 }))));
  sessionStorage.removeItem("changmen:ray-order-context:v1:u1"); setActivePinia(createPinia());
  startRayOrderMonitoring(); await flush(); expect(vi.getTimerCount()).toBe(1); expect(mock.read).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem("changmen:ray-reject-monitor:v1:u1")).toBeNull();
});
