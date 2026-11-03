import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startGtcOrderSync, stopGtcOrderSync, flushGtcResults } from "./gtcOrderSync";
const mock = vi.hoisted(() => ({ pending: vi.fn(), finish: vi.fn(), post: vi.fn(), refresh: vi.fn(), restored: vi.fn(),
  date: "2026-11-03", session: 1, issues: {} }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => mock.session,
  isAuthSessionCurrent: (session: number) => session === mock.session,
  unwrap: (response: { success: number; info: unknown; msg?: string }) => { if (response.success !== 1) throw new Error(response.msg); return response.info; } }));
vi.mock("@/orderModes/gtc/localStore", () => ({ listLocalGtc: async () => [], pendingGtcResults: mock.pending, finishGtcResult: mock.finish, localGtcChanges: { revision: 0 }, listenLocalGtcChanges: () => () => {} }));
vi.mock("@/orderModes/gtc/gtcProgressState", () => ({ gtcProgress: { saveIssues: mock.issues } }));
vi.mock("@/api/order", () => ({ registerOrderSyncProjection: () => () => {} }));
vi.mock("@/orderModes/gtc/orderStore", () => ({ listStoredGtcOrders: mock.restored, queueStoredGtcOrderResults: async () => {} }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ get orderDate() { return mock.date; }, fetchOrders: mock.refresh }) }));
const entry = { key: "k", owner: "owner", at: 0, failures: 0, result: { executionId: "id", revision: 8, fills: [{ status: "CONFIRMED" }], financial: { pmShares: 3 } } };
beforeEach(() => { vi.useFakeTimers(); stopGtcOrderSync(); vi.clearAllMocks(); mock.session = 1;
  mock.date = "2026-11-03"; mock.restored.mockResolvedValue([]); mock.refresh.mockResolvedValue(true);
  mock.pending.mockResolvedValue([entry]); mock.finish.mockImplementation(async (_entry, failure) => {
    if (!failure) mock.pending.mockResolvedValue([]);
  }); mock.post.mockResolvedValue({ success: 1, info: true }); });
afterEach(() => { stopGtcOrderSync(); vi.useRealTimers(); });
it("synchronizes only durable confirmed result and acknowledges only that version", async () => {
  startGtcOrderSync("owner"); await flushGtcResults();
  expect(mock.post).toHaveBeenCalledExactlyOnceWith("Pm_GtcSyncResult", { result: entry.result }, "", { errorTip: false });
  expect(mock.finish).toHaveBeenCalledExactlyOnceWith(entry);
  expect(mock.refresh).toHaveBeenCalledExactlyOnceWith(mock.date, { sideEffects: false, isCurrent: expect.any(Function) });
});
it("failed synchronization retains a durable retry; future-due entries send nothing", async () => {
  mock.post.mockRejectedValue(new Error("RDS offline")); startGtcOrderSync("owner"); await flushGtcResults();
  expect(mock.finish).toHaveBeenCalledExactlyOnceWith(entry, true);
  expect(mock.refresh).not.toHaveBeenCalled();
  mock.pending.mockResolvedValue([{ ...entry, at: Date.now() + 60000 }]);
  await flushGtcResults(); expect(mock.post).toHaveBeenCalledOnce();
});
it("an unconfirmed server acknowledgement retains the pending result", async () => {
  mock.post.mockResolvedValue({ success: 1, info: false });
  startGtcOrderSync("owner"); await flushGtcResults();
  expect(mock.finish).toHaveBeenCalledExactlyOnceWith(entry, true);
});
it.each(["logout", "session"])("late responses after %s cannot acknowledge a pending result", async stage => {
  let finish!: (response: unknown) => void; mock.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  startGtcOrderSync("owner"); const task = flushGtcResults(); await Promise.resolve(); await Promise.resolve();
  if (stage === "logout") stopGtcOrderSync(); else mock.session++;
  finish({ success: 1, info: true }); await task; expect(mock.finish).not.toHaveBeenCalled();
  expect(mock.refresh).not.toHaveBeenCalled();
});
it.each([false, "offline"])("retries a failed order-list read (%s) without uploading the acknowledged result again", async failure => {
  if (failure === false) mock.refresh.mockResolvedValueOnce(false);
  else mock.refresh.mockRejectedValueOnce(new Error("read offline"));
  startGtcOrderSync("owner"); await flushGtcResults();
  await flushGtcResults();
  expect(mock.refresh).toHaveBeenCalledTimes(2); expect(mock.post).toHaveBeenCalledOnce();
  expect(mock.finish).toHaveBeenCalledExactlyOnceWith(entry);
  await flushGtcResults(); expect(mock.refresh).toHaveBeenCalledTimes(2);
});
it("refreshes once for a batch of acknowledged results", async () => {
  mock.pending.mockResolvedValue([entry, { ...entry, key: "second", result: { ...entry.result, executionId: "second" } }]);
  startGtcOrderSync("owner"); await flushGtcResults();
  expect(mock.post).toHaveBeenCalledTimes(2); expect(mock.refresh).toHaveBeenCalledOnce();
});
it("reloads recovered native fills even if a previous page already acknowledged the upload", async () => {
  mock.pending.mockResolvedValue([]);
  mock.restored.mockResolvedValue([{ id: "id", owner: "owner", accountId: 1, submit: "accepted", orderId: "hash", plan: { orderHash: "hash" }, matched: "3" }]);
  startGtcOrderSync("owner"); await flushGtcResults();
  await vi.waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
  expect(mock.refresh).toHaveBeenCalledOnce(); expect(mock.post).not.toHaveBeenCalled();
});
it.each(["logout", "session", "date"])("invalidates an in-flight order-list refresh after %s", async stage => {
  startGtcOrderSync("owner"); await flushGtcResults();
  const options = mock.refresh.mock.calls[0]![1] as { isCurrent: () => boolean };
  expect(options.isCurrent()).toBe(true);
  if (stage === "logout") stopGtcOrderSync();
  else if (stage === "session") mock.session++;
  else mock.date = "2026-11-02";
  expect(options.isCurrent()).toBe(false);
});
