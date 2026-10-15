/** [changmen 扩展] 原有账号查询结果供各原单消费；PM 模式恢复不增加 RAY 请求。 */
import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { OrderRow } from "@/types/order";
import { applyGtcCommand, createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { getProvider } from "@/runtime/providers";
import { registerRayOrderContext } from "@/runtime/rayOrderMonitor/contexts";
import { useRayOrderContextStore } from "@/runtime/rayOrderMonitor/contextStore";
import { startRayOrderMonitoring, stopRayOrderMonitoring } from "@/runtime/rayOrderMonitor/runtime";
import { gtcProgress } from "@/orderModes/gtc/executionState";
import { observedRayOrders, resetRayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { rayMonitoring } from "@/runtime/rayOrderMonitor/state";
import { startGtcOrderMonitoring as startGtcRuntime, stopGtcOrderMonitoring as stopGtcRuntime } from "./runtime";
import { mockUnifiedGtcRecovery } from "@/test/gtcRecoverFixture";

vi.mock("@/runtime/rayOrderMonitor/api", () => ({ loadRayMonitorOrders: vi.fn().mockResolvedValue([]), saveRayMonitorOrders: mocks.ordinarySave }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), pmRead: vi.fn(), mark: vi.fn(), save: vi.fn(), ordinarySave: vi.fn(), refresh: vi.fn(), records: new Map<string, GtcExecution>(), orders: new Map<number, OrderRow[]>(), accounts: [] as PlatformAccount[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => true,
  post: (action: string, request: import("@changmen/shared/pm_gtc_recovery").GtcRecoverRequest) => mockUnifiedGtcRecovery(action, request, async () => [...mocks.records.values()], async () => []),
  unwrap: (response: { info: unknown }) => response.info }));
vi.mock("@/runtime/venueAdapters", () => ({ getProvider: () => ({ getOrders: mocks.read }) }));
vi.mock("@/api/chat", () => ({ saveUserLog: vi.fn().mockResolvedValue(true) }));
vi.mock("@/api/order", () => ({ saveOrders: mocks.ordinarySave }));
vi.mock("@/services/orderObservation", () => ({ observeOrder: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbOrderId: vi.fn().mockResolvedValue(true), refreshOrderListAfterBind: vi.fn() }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: mocks.accounts, findAccount: (id: number) => mocks.accounts.find(a => a.accountId === id) }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: mocks.orders, orderDate: "2026-10-14", fetchOrders: mocks.refresh, updateTodayProfit: vi.fn() }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", extensionPrefs: {} }) }));
vi.mock("@/orderModes/gtc/successMarkers", () => ({ markGtcSuccess: mocks.mark }));
vi.mock("@/orderModes/gtc/ordersApi", () => ({ loadGtcMonitorOrders: vi.fn().mockResolvedValue([]), saveOrders: mocks.save, refreshGtcOrders: mocks.refresh }));
vi.mock("@/orderModes/gtc/api", () => ({ listGtc: async () => [...mocks.records.values()], commandGtc: async (row: GtcExecution, command: GtcCommand) => {
  const next = applyGtcCommand(JSON.parse(JSON.stringify(row)), command, Date.now()); mocks.records.set(next.id, next); return next;
} }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ readGtcTradeHistory: vi.fn().mockResolvedValue({ trades: [], complete: true }), readGtcFacts: mocks.pmRead }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ observePolymarketOrderWatch: () => () => {} }));

function execution(id: string, accountId = 2) {
  const hash = `pm-${id}`;
  const plan = { playerId: 1, otherPlayerId: accountId, otherProvider: "RAY", shares: "10", tokenId: "token", orderHash: hash, originalPmLeg: "A", betRowId: 2, target: "Home", otherTarget: "Away", otherOdds: 2 } as GtcPlan;
  const initial = createGtcExecution(id, "owner", "wallet", "maker", plan, Date.now());
  const row = mergeGtcFacts({ ...initial, pmAuthorized: true, submit: "accepted", orderId: hash, other: { state: "filled", orderId: `ray-${id}`, submittedAt: Date.now(), message: "" } }, {
    order: { id: hash, original: "10", matched: "10", status: "MATCHED", tradeIds: [`trade-${id}`] },
    fills: [{ key: id, tradeId: `trade-${id}`, bucket: "maker", role: "MAKER", shares: "10", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 }],
    complete: true,
    observedAt: Date.now(),
  });
  row.decision = "closed";
  mocks.records.set(id, row);
  mocks.orders.set(mocks.orders.size, [{ Type: "Polymarket", PlayerID: 1, OrderID: hash, PmGtcExecutionId: id, Status: "Win" }, { Type: "RAY", PlayerID: accountId, OrderID: `ray-${id}`, PmGtcExecutionId: id, Status: "None" }]);
}
function venue(id: string, status: VenueOrder["status"]): VenueOrder {
  return { provider: "RAY", orderId: `ray-${id}`, status, odds: 2, betMoney: 100, money: status === "lose" ? -100 : 0, reward: 0, createAt: Date.now(), game: "CS2", match: "match", bet: "map1", item: "Away" };
}
beforeEach(() => {
  setActivePinia(createPinia());
  stopGtcRuntime(); stopRayOrderMonitoring(); resetRayOrderResults(); vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear();
  mocks.records.clear(); mocks.orders.clear();
  mocks.accounts = [new PlatformAccount({ accountId: 1, provider: "Polymarket", playerName: "PM" }), new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" }), new PlatformAccount({ accountId: 3, provider: "RAY", playerName: "other RAY" })];
  mocks.save.mockResolvedValue(undefined); mocks.refresh.mockResolvedValue(undefined);
  mocks.ordinarySave.mockResolvedValue(undefined);
  mocks.mark.mockReset();
});
afterEach(() => { stopRayOrderMonitoring(); stopGtcRuntime(); resetRayOrderResults(); vi.useRealTimers(); });

it("fOK and GTC contexts consume one independent account poll and keep GTC as a facts consumer", async () => {
  execution("gtc");
  const pendingGtc = venue("gtc", "none"); const pendingFok = venue("fok", "none");
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  const store = useRayOrderContextStore();
  for (const [index, original] of [pendingGtc, pendingFok].entries()) {
    registerRayOrderContext({ linkId: 100 + index, matchId: 1, betId: 2 + index, side: "B", accountId: 2, submittedAt: original.createAt, match: original.match, bet: original.bet, item: original.item, target: "Away", odds: original.odds, betMoney: original.betMoney, anchorProvider: "Polymarket", anchorAccountId: 1, anchorBetMoney: 5, anchorOdds: 2, anchorConfirmed: false, initialOrders: [original], initialRejected: false });
  }
  mocks.read.mockResolvedValue([pendingGtc, pendingFok]); startRayOrderMonitoring(); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).toHaveBeenCalledOnce(); expect(store.activeTasks).toHaveLength(2);
  mocks.read.mockResolvedValue([venue("gtc", "reject"), pendingFok]); await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(store.taskForLink(100)).toMatchObject({ status: "rejected", autoMakeupStatus: "disabled" });
  expect(store.taskForLink(101)?.status).toBe("watching"); expect(gtcProgress.records[0]!.other.state).toBe("rejected");
  await vi.advanceTimersByTimeAsync(60000); expect(mocks.read).toHaveBeenCalledTimes(14);
  stopRayOrderMonitoring(); await vi.advanceTimersByTimeAsync(60000); expect(mocks.read).toHaveBeenCalledTimes(14);
});
it("three originals consume one existing query; background rounds never query RAY and unrelated FOK orders are never saved", async () => {
  execution("one"); execution("two"); execution("pending");
  mocks.records.get("one")!.other.state = "accepted";
  const unrelated = { ...venue("fok", "win"), link: 1791559000999 };
  mocks.read.mockResolvedValueOnce([venue("one", "lose"), venue("two", "win"), venue("pending", "none"), unrelated])
    .mockResolvedValue([venue("one", "lose"), venue("two", "win"), venue("pending", "lose"), unrelated]);
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).not.toHaveBeenCalled();
  await getProvider(mocks.accounts[1]!)!.getOrders!(mocks.accounts[1]!); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.pmRead).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledTimes(3);
  expect(gtcProgress.records.find(row => row.id === "one")!.other.state).toBe("filled");
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledTimes(3);
  await getProvider(mocks.accounts[1]!)!.getOrders!(mocks.accounts[1]!); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.save).toHaveBeenCalledTimes(4);
  expect(mocks.save.mock.calls.map(call => call[1][0].orderId).sort()).toEqual(["ray-one", "ray-two", "ray-pending", "ray-pending"].sort());
  // 普通列表故意仍为旧 None，切换日期后也不能重新拉已保存的结算单。
  mocks.orders.clear(); await vi.advanceTimersByTimeAsync(120000);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(gtcProgress.otherQueryIssues).toEqual({});
  expect(unrelated.link).toBe(1791559000999);
  expect(mocks.accounts[1]!.unsettle).toBe(0);
});

it("restoring many pending RAY originals for several minutes never starts an extra query", async () => {
  for (let i = 0; i < 10; i++)
    execution(String(i));
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(180000);
  expect(gtcProgress.records).toHaveLength(10);
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});

it("GTC consumes RAY results into its own facts without writing the RAY monitor state", async () => {
  execution("one");
  mocks.read.mockResolvedValue([venue("one", "reject")]);
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  await getProvider(mocks.accounts[1]!)!.getOrders!(mocks.accounts[1]!);
  await vi.advanceTimersByTimeAsync(0);
  expect(gtcProgress.records[0]!.other.state).toBe("rejected");
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(rayMonitoring.owner).toBe("");
  expect(rayMonitoring.orders.size).toBe(0);
});

it("results arriving during an earlier save are consumed afterwards without another venue request", async () => {
  execution("one");
  let release!: () => void;
  mocks.save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  mocks.read.mockResolvedValueOnce([venue("one", "none")]).mockResolvedValueOnce([venue("one", "reject")]);
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  const account = mocks.accounts[1]!;
  await getProvider(account)!.getOrders!(account); await vi.advanceTimersByTimeAsync(0);
  await getProvider(account)!.getOrders!(account); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.save).toHaveBeenCalledOnce();
  release(); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(gtcProgress.records[0]!.other.state).toBe("rejected");
  await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("separate accounts only consume their own existing query results", async () => {
  execution("one"); execution("two"); execution("other", 3);
  mocks.read.mockImplementation(async (account: PlatformAccount) => account.accountId === 2
    ? [venue("one", "lose"), venue("two", "win")]
    : [venue("other", "win")]);
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).not.toHaveBeenCalled();
  await getProvider(mocks.accounts[1]!)!.getOrders!(mocks.accounts[1]!); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.save).toHaveBeenCalledTimes(2);
  await getProvider(mocks.accounts[2]!)!.getOrders!(mocks.accounts[2]!); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.save).toHaveBeenCalledTimes(3);
});

it("an existing query failure preserves original identities without starting GTC retries", async () => {
  execution("one"); execution("two");
  mocks.read.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue([venue("one", "lose"), venue("two", "win")]);
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).not.toHaveBeenCalled();
  await expect(getProvider(mocks.accounts[1]!)!.getOrders!(mocks.accounts[1]!)).rejects.toThrow("Network Error");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  expect(gtcProgress.records.every(row => row.other.state === "filled")).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  await getProvider(mocks.accounts[1]!)!.getOrders!(mocks.accounts[1]!); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(gtcProgress.otherQueryIssues).toEqual({});
  await vi.advanceTimersByTimeAsync(65000);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("starting and stopping GTC preserves the RAY snapshot, state and independent polling", async () => {
  execution("one");
  mocks.read.mockResolvedValue([venue("one", "none")]);
  startRayOrderMonitoring(); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.read).toHaveBeenCalledOnce();
  const account = mocks.accounts[1]!;
  const snapshot = observedRayOrders(account);
  expect(snapshot).toBeDefined();
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  expect(observedRayOrders(account)).toBe(snapshot);
  const state = rayMonitoring.orders.get("2:ray-one");
  expect(state?.phase).toBe("watching");
  stopGtcRuntime();
  expect(observedRayOrders(account)).toBe(snapshot);
  expect(rayMonitoring.orders.get("2:ray-one")).toBe(state);
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(gtcProgress.records).toEqual([]);
});

it("stopping RAY leaves the independent GTC original polling and identity active", async () => {
  const plan = { source: "manual", playerId: 1, shares: "10", tokenId: "token", orderHash: "pm-open" } as GtcPlan;
  const row = createGtcExecution("open", "owner", "wallet", "maker", plan, Date.now());
  Object.assign(row, { pmAuthorized: true, submit: "accepted", orderId: "pm-open", decision: "closed" });
  mocks.records.set(row.id, row);
  mocks.pmRead.mockResolvedValue({ order: { id: "pm-open", original: "10", matched: "0", status: "LIVE", tradeIds: [] }, fills: [], complete: true, observedAt: Date.now() });
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled();
  expect(mocks.pmRead).toHaveBeenCalledOnce();
  const timers = vi.getTimerCount();
  startGtcRuntime("owner");
  expect(vi.getTimerCount()).toBe(timers);
  startRayOrderMonitoring(); stopRayOrderMonitoring();
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.pmRead).toHaveBeenCalledTimes(2);
  expect(gtcProgress.records[0]).toMatchObject({ id: "open", orderId: "pm-open", matched: "0" });
  stopGtcRuntime();
  await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.pmRead).toHaveBeenCalledTimes(2);
});

it("legacy monitor entry points share the canonical functions and instance", async () => {
  const legacy = await import("@/runtime/orderMonitoring/session");
  expect(legacy.startOrderMonitoring).toBe(startGtcRuntime);
  expect(legacy.stopOrderMonitoring).toBe(stopGtcRuntime);
  const pm = await import("./pm");
  const legacyPm = await import("@/runtime/orderMonitoring/pm");
  expect(legacyPm.pollGtc).toBe(pm.pollGtc);
  expect(legacyPm.cancelGtc).toBe(pm.cancelGtc);
});

it("retries failed final RAY reconciliation without querying the venue or spinning", async () => {
  execution("final");
  mocks.records.get("final")!.other.state = "pending";
  mocks.orders.get(0)![1]!.Status = "Win";
  let failed = false;
  mocks.mark.mockImplementation((_owner: string, accountId: number) => {
    if (accountId === 2 && !failed) {
      failed = true;
      throw new Error("local statistics unavailable");
    }
  });
  const attempts = () => mocks.mark.mock.calls.filter(([, accountId]) => accountId === 2).length;
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  expect(gtcProgress.otherQueryIssues.final).toBeDefined();
  expect(attempts()).toBe(1);
  await vi.advanceTimersByTimeAsync(4999);
  expect(attempts()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(attempts()).toBe(2);
  expect(gtcProgress.otherQueryIssues.final).toBeUndefined();
  await vi.advanceTimersByTimeAsync(120000);
  expect(attempts()).toBe(2);
  expect(mocks.read).not.toHaveBeenCalled();
});

it("repeated final RAY failures back off and stopping GTC cancels further reconciliation", async () => {
  execution("retry");
  mocks.records.get("retry")!.other.state = "pending";
  mocks.orders.get(0)![1]!.Status = "Win";
  mocks.mark.mockImplementation((_owner: string, accountId: number) => {
    if (accountId === 2) throw new Error("local statistics unavailable");
  });
  const attempts = () => mocks.mark.mock.calls.filter(([, accountId]) => accountId === 2).length;
  startGtcRuntime("owner"); await vi.advanceTimersByTimeAsync(0);
  expect(attempts()).toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(attempts()).toBe(2);
  await vi.advanceTimersByTimeAsync(9999);
  expect(attempts()).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(attempts()).toBe(3);
  stopGtcRuntime(); await vi.advanceTimersByTimeAsync(60000);
  expect(attempts()).toBe(3);
  expect(mocks.read).not.toHaveBeenCalled();
});
