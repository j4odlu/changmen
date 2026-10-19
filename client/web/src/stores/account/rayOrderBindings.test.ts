import type { VenueOrder } from "@changmen/client-core/contract";
import type { OrderRow } from "@/types/order";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { useRayOrderContextStore } from "@/runtime/rayOrderMonitor/contextStore";
import { registerRayOrderContext, bindRayOrderContexts, observeRayOrderContexts } from "@/runtime/rayOrderMonitor/contexts";
import { syncVenueOrders } from "./venueOrders";

const mock = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), bind: vi.fn(), refresh: vi.fn(),
  owner: "owner", rows: new Map<number, OrderRow[]>(), accounts: [] as PlatformAccount[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mock.owner, isAuthSessionCurrent: (owner: string) => owner === mock.owner }));
vi.mock("@/api/order", () => ({ saveOrders: mock.save }));
vi.mock("@/api/chat", () => ({ saveUserLog: vi.fn().mockResolvedValue(true) }));
vi.mock("@/services/orderObservation", () => ({ observeOrder: vi.fn() }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ getOrders: mock.read }) }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbOrderId: mock.bind }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: (id: number) => mock.accounts.find(a => a.accountId === id) }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: mock.rows, fetchOrders: mock.refresh }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mock.owner, extensionPrefs: { rayLateRejectAutoMakeup: { enabled: false } } }) }));
const original: VenueOrder = { provider: "RAY", orderId: "one", status: "reject", createAt: 100_000,
  odds: 2, betMoney: 70, money: 0, reward: 0, game: "CS2", match: "Alpha vs Beta", bet: "map1", item: "Beta" };
function context() {
  registerRayOrderContext({ linkId: 100, matchId: 1, betId: 10, side: "B", accountId: 2, submittedAt: 100_000,
    match: original.match, bet: original.bet, item: original.item, target: "Away", odds: 2, betMoney: 70,
    anchorConfirmed: true, anchorProvider: "OB", anchorAccountId: 1, anchorBetMoney: 70, anchorOdds: 2,
    initialOrders: [], initialRejected: false });
  bindRayOrderContexts(mock.accounts[0]!, [original], () => true);
}
beforeEach(() => {
  setActivePinia(createPinia()); sessionStorage.clear(); vi.clearAllMocks(); mock.owner = "owner"; mock.rows.clear();
  mock.accounts = [new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" })];
  mock.save.mockResolvedValue(undefined); mock.bind.mockResolvedValue(true); mock.read.mockResolvedValue([original]);
});
it("normal synchronization saves once, then binds the locally identified original without fetching the sidebar", async () => {
  context(); observeRayOrderContexts(2, [original], () => true);
  expect(useRayOrderContextStore().taskForLink(100)).toMatchObject({ status: "rejected", monitorBound: true });
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.bind).not.toHaveBeenCalled();
  await syncVenueOrders(mock.accounts[0]!);
  await vi.dynamicImportSettled();
  expect(mock.read).toHaveBeenCalledOnce(); expect(mock.save).toHaveBeenCalledExactlyOnceWith(mock.accounts[0], [original]);
  expect(mock.bind).toHaveBeenCalledExactlyOnceWith(100, "RAY", 2, "one"); expect(mock.refresh).not.toHaveBeenCalled();
  expect(useRayOrderContextStore().taskForLink(100)).toMatchObject({ status: "rejected", bindingSaved: true });
});
it("a failed order save cannot claim or bind database ownership", async () => {
  context(); mock.save.mockRejectedValueOnce(new Error("save failed"));
  await expect(syncVenueOrders(mock.accounts[0]!)).rejects.toThrow("save failed");
  expect(mock.bind).not.toHaveBeenCalled(); expect(useRayOrderContextStore().taskForLink(100)?.bindingSaved).not.toBe(true);
});
it("a slow Link save does not delay the original venue order confirmation result", async () => {
  context(); let release!: (ok: boolean) => void;
  mock.bind.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const orders = await syncVenueOrders(mock.accounts[0]!);
  expect(orders).toEqual([original]); expect(mock.save).toHaveBeenCalledOnce();
  await vi.dynamicImportSettled(); expect(mock.bind).toHaveBeenCalledOnce();
  release(true); await Promise.resolve();
});
it("failed binding retries only on normal synchronization, with no second order save in that round", async () => {
  context(); mock.bind.mockResolvedValueOnce(false);
  await syncVenueOrders(mock.accounts[0]!);
  await vi.dynamicImportSettled();
  expect(useRayOrderContextStore().taskForLink(100)?.bindingSaved).not.toBe(true);
  expect(mock.save).toHaveBeenCalledOnce();
  await syncVenueOrders(mock.accounts[0]!);
  await vi.dynamicImportSettled();
  expect(mock.save).toHaveBeenCalledTimes(2); expect(mock.bind).toHaveBeenCalledTimes(2);
  expect(useRayOrderContextStore().taskForLink(100)?.bindingSaved).toBe(true);
});
it("normal synchronization does not rebind an original owned by another Link", async () => {
  context(); mock.rows.set(999, [{ Type: "RAY", PlayerID: 2, OrderID: "one", Link: 999, CreateAt: 100_000 }]);
  await syncVenueOrders(mock.accounts[0]!);
  await vi.dynamicImportSettled();
  expect(mock.bind).not.toHaveBeenCalled(); expect(useRayOrderContextStore().taskForLink(100)?.bindingSaved).not.toBe(true);
});
it("normal synchronization cannot bind a context rejected by local identity protection", async () => {
  context(); const task = useRayOrderContextStore().taskForLink(100)!;
  useRayOrderContextStore().patch(task.key, { monitorBound: false, lastError: "Link conflict" });
  await syncVenueOrders(mock.accounts[0]!); await vi.dynamicImportSettled();
  expect(mock.bind).not.toHaveBeenCalled(); expect(useRayOrderContextStore().taskForLink(100)?.bindingSaved).not.toBe(true);
});
it("local terminal contexts survive reload until normal synchronization persists their Link", async () => {
  context(); observeRayOrderContexts(2, [{ ...original, status: "win" }], () => true);
  setActivePinia(createPinia()); useRayOrderContextStore().restore("owner");
  expect(useRayOrderContextStore().tasks.size).toBe(1); expect(useRayOrderContextStore().activeTasks).toHaveLength(0);
  await syncVenueOrders(mock.accounts[0]!);
  await vi.dynamicImportSettled();
  setActivePinia(createPinia()); useRayOrderContextStore().restore("owner");
  expect(useRayOrderContextStore().tasks.size).toBe(0);
});
