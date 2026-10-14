import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { acceptGtc, currentGtc, gtcProgress, initializeGtcState, resetGtcState } from "@/orderModes/gtc/executionState";
import { pollGtc, startPmGtcMonitoring, stopPmGtcMonitoring } from "./pm";

const mocks = vi.hoisted(() => ({ history: vi.fn(), facts: vi.fn(), dispose: vi.fn(), watch: vi.fn(), accounts: [] as PlatformAccount[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "owner", isAuthSessionCurrent: () => true }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: (id: number) => mocks.accounts.find(a => a.accountId === id) }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner" }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/orderModes/gtc/successMarkers", () => ({ markGtcSuccess: vi.fn() }));
vi.mock("@/orderModes/gtc/api", () => ({ commandGtc: async (row: GtcExecution, command: GtcCommand) => applyGtcCommand(structuredClone(JSON.parse(JSON.stringify(row))), command, Date.now()) }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ readGtcTradeHistory: mocks.history, readGtcFacts: mocks.facts }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ observePolymarketOrderWatch: mocks.watch }));
vi.mock("./recovery", () => ({ recoverMonitorRecords: async () => {} }));
function record(id: string, accountId = 1) {
  const plan = { source: "manual", playerId: accountId, shares: "10", tokenId: id, orderHash: id } as GtcPlan;
  const row = createGtcExecution(id, "owner", "wallet", "maker", plan, Date.now() - (id === "old" ? 60000 : 1000));
  row.pmAuthorized = true; row.submit = "accepted"; row.orderId = id; row.decision = "closed";
  acceptGtc(row);
}
beforeEach(async () => {
  await import("@changmen/venue-adapter/polymarket/gtc");
  await import("@changmen/venue-adapter/polymarket");
  stopPmGtcMonitoring(); resetGtcState(); initializeGtcState("owner"); vi.useFakeTimers(); vi.clearAllMocks();
  mocks.accounts = [1, 2].map(accountId => new PlatformAccount({ accountId, provider: "Polymarket", token: "test", playerName: "PM" }));
  mocks.history.mockResolvedValue({ trades: [], complete: true }); mocks.watch.mockReturnValue(mocks.dispose);
  mocks.facts.mockImplementation(async (_account, _plan, id, _since, history) => {
    await history;
    return { order: { id, original: "10", matched: "0", status: "CANCELED", tradeIds: [] }, fills: [], complete: true, observedAt: Date.now() };
  });
  gtcProgress.ready = true;
});
afterEach(() => { stopPmGtcMonitoring(); resetGtcState(); vi.useRealTimers(); });
it("pM monitors run without the GTC coordinator, share account history and dispose terminal watches", async () => {
  record("old"); record("new");
  expect(gtcProgress.records.map(row => [row.id, row.pmAuthorized])).toEqual([["new", true], ["old", true]]);
  startPmGtcMonitoring(); await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.history).toHaveBeenCalledOnce();
  expect(mocks.history.mock.calls[0]![1]).toBe(Date.now() - 60000);
  expect(gtcProgress.queryIssues).toEqual({});
  expect(mocks.facts).toHaveBeenCalledTimes(2);
  expect(currentGtc("old").terminal).toBe(true); expect(currentGtc("new").terminal).toBe(true);
  await vi.advanceTimersByTimeAsync(65000);
  expect(mocks.facts).toHaveBeenCalledTimes(2);
  expect(mocks.dispose).toHaveBeenCalledTimes(mocks.watch.mock.calls.length);
});
it("a slow account does not stop another account's independent PM monitor", async () => {
  record("old", 1); record("other", 2);
  let resolve!: (history: { trades: []; complete: true }) => void;
  mocks.history.mockImplementation((account: PlatformAccount) => account.accountId === 1 ? new Promise((r) => { resolve = r; }) : Promise.resolve({ trades: [], complete: true }));
  startPmGtcMonitoring(); await vi.advanceTimersByTimeAsync(5000); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.history).toHaveBeenCalledTimes(2);
  expect(currentGtc("other").terminal).toBe(true); expect(currentGtc("old").terminal).toBe(false);
  resolve({ trades: [], complete: true }); await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  expect(currentGtc("old").terminal).toBe(true);
});
it("shared history failures preserve order identities and retry once per account next round", async () => {
  record("old"); record("new"); mocks.history.mockRejectedValueOnce(new Error("Network Error"));
  startPmGtcMonitoring(); await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.history).toHaveBeenCalledOnce(); expect(Object.keys(gtcProgress.queryIssues)).toHaveLength(2);
  expect(currentGtc("old").orderId).toBe("old");
  await vi.advanceTimersByTimeAsync(5000); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.history).toHaveBeenCalledTimes(2); expect(gtcProgress.queryIssues).toEqual({});
});

// [changmen 扩展] 执行窗口内默认核对不能提前创建共享成交历史。
it("direct polling retains the adapter's default sequential read without a history promise", async () => {
  record("new");
  await pollGtc("new");
  expect(mocks.history).not.toHaveBeenCalled();
  expect(mocks.facts).toHaveBeenCalledExactlyOnceWith(mocks.accounts[0], currentGtc("new").plan, "new", expect.any(Number));
});
it("background polling of an open execution cannot start shared history before the adapter reads its order", async () => {
  record("new");
  currentGtc("new").decision = "open";
  startPmGtcMonitoring(); await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.history).not.toHaveBeenCalled();
  expect(mocks.facts.mock.calls[0]).toHaveLength(4);
});
