import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startGtcOrderSync, stopGtcOrderSync, flushGtcResults } from "./gtcOrderSync";
const mock = vi.hoisted(() => ({ pending: vi.fn(), finish: vi.fn(), post: vi.fn(), session: 1, issues: {} }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => mock.session,
  isAuthSessionCurrent: (session: number) => session === mock.session,
  unwrap: (response: { success: number; info: unknown; msg?: string }) => { if (response.success !== 1) throw new Error(response.msg); return response.info; } }));
vi.mock("@/orderModes/gtc/localStore", () => ({ listLocalGtc: async () => [], pendingGtcResults: mock.pending, finishGtcResult: mock.finish, localGtcChanges: { revision: 0 }, listenLocalGtcChanges: () => () => {} }));
vi.mock("@/orderModes/gtc/gtcProgressState", () => ({ gtcProgress: { saveIssues: mock.issues } }));
vi.mock("@/api/order", () => ({ registerOrderSyncProjection: () => () => {} }));
const entry = { key: "k", owner: "owner", at: 0, failures: 0, result: { executionId: "id", revision: 8, fills: [{ status: "CONFIRMED" }], financial: { pmShares: 3 } } };
beforeEach(() => { vi.useFakeTimers(); stopGtcOrderSync(); vi.clearAllMocks(); mock.session = 1;
  mock.pending.mockResolvedValue([entry]); mock.finish.mockResolvedValue(undefined); mock.post.mockResolvedValue({ success: 1, info: true }); });
afterEach(() => { stopGtcOrderSync(); vi.useRealTimers(); });
it("synchronizes only durable confirmed result and acknowledges only that version", async () => {
  startGtcOrderSync("owner"); await flushGtcResults();
  expect(mock.post).toHaveBeenCalledExactlyOnceWith("Pm_GtcSyncResult", { result: entry.result }, "", { errorTip: false });
  expect(mock.finish).toHaveBeenCalledExactlyOnceWith(entry);
});
it("failed synchronization retains a durable retry; future-due entries send nothing", async () => {
  mock.post.mockRejectedValue(new Error("RDS offline")); startGtcOrderSync("owner"); await flushGtcResults();
  expect(mock.finish).toHaveBeenCalledExactlyOnceWith(entry, true);
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
});
