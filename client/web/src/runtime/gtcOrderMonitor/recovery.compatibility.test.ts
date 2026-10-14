import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGtcSettlementEvidence } from "@/orderModes/gtc/settlementEvidence";
import { recoverMonitorRecords, resetMonitorRecovery } from "./recovery";
const mock = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn(), session: true, records: [] as GtcExecution[], error: "", evidence: undefined as ReturnType<typeof createGtcSettlementEvidence> | undefined }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => "owner", isAuthSessionCurrent: () => mock.session,
  unwrap: (response: { success: number; msg?: string; info: unknown }) => { if (response.success !== 1) throw new Error(response.msg); return response.info; } }));
vi.mock("@/orderModes/gtc/executionState", () => ({ captureGtcSession: () => () => mock.session, knownGtcRevisions: () => ({}), applyRecoveredGtcRecords: () => 0,
  financialOrders: () => mock.evidence!.rows([]), gtcProgress: mock, settlement: { rows: (...args: Parameters<ReturnType<typeof createGtcSettlementEvidence>["rows"]>) => mock.evidence!.rows(...args) } }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ fetchOrders: mock.refresh, orderDate: "2026-10-14" }) }));
const id = "11111111-1111-1111-1111-111111111111", at = Date.UTC(2026, 9, 8, 23, 59);
const original = { PlayerID: 1, Type: "Polymarket", OrderID: "buy", Status: "Win" as const, PmGtcExecutionId: id, Link: at - 30 * 86400000 };
const result = () => ({ executions: { ok: true, rows: mock.records }, orders: [{ ok: true, ids: [id], unchangedIds: [], rows: [original] }] });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); resetMonitorRecovery(); vi.clearAllMocks(); mock.session = true; mock.error = ""; mock.evidence = createGtcSettlementEvidence();
  mock.records = [createGtcExecution(id, "owner", "wallet", "maker", { playerId: 1, orderHash: "buy", linkId: at } as GtcPlan, at)];
  Object.assign(mock.records[0]!, { pmAuthorized: true, submit: "accepted", orderId: "buy" });
  mock.post.mockResolvedValue({ success: 1, info: result() });
});
afterEach(() => vi.useRealTimers());
it("GTC restores terminal manually rebound evidence with one unified request and retains the ordinary selected date", async () => {
  const first = recoverMonitorRecords(); expect(recoverMonitorRecords()).toBe(first); await first;
  expect(mock.evidence!.rows([])).toEqual([original]); expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.post).toHaveBeenCalledOnce(); expect(mock.post.mock.calls[0]![0]).toBe("Pm_GtcRecover");
  await recoverMonitorRecords(); expect(mock.post).toHaveBeenCalledOnce();
});
it("unsupported old backend fails and backs off without legacy list/date calls", async () => {
  mock.post.mockResolvedValue({ success: 0, msg: "未知预测市场 action: Pm_GtcRecover" });
  await expect(recoverMonitorRecords()).rejects.toThrow("Pm_GtcRecover");
  expect(mock.evidence!.rows([])).toEqual([]); await recoverMonitorRecords(); expect(mock.post).toHaveBeenCalledOnce();
  mock.post.mockResolvedValue({ success: 1, info: result() }); await vi.advanceTimersByTimeAsync(5000); await recoverMonitorRecords();
  expect(mock.evidence!.rows([])).toEqual([original]); expect(mock.post.mock.calls.every(call => call[0] === "Pm_GtcRecover")).toBe(true);
});
it("financial read failures publish no terminal evidence and retry independently", async () => {
  mock.post.mockResolvedValue({ success: 1, info: { ...result(), orders: [{ ok: false, message: "original missing", ids: [id], unchangedIds: [] }] } });
  await expect(recoverMonitorRecords()).rejects.toThrow("original missing"); expect(mock.evidence!.rows([])).toEqual([]); expect(mock.refresh).not.toHaveBeenCalled();
  mock.post.mockResolvedValue({ success: 1, info: result() }); await vi.advanceTimersByTimeAsync(5000); await recoverMonitorRecords();
  expect(mock.evidence!.rows([])).toEqual([original]);
});
it.each(["session", "reset"])("discards an in-flight %s before settlement is written", async stage => {
  mock.post.mockImplementation(async () => { if (stage === "session") mock.session = false; else resetMonitorRecovery(); return { success: 1, info: result() }; });
  await expect(recoverMonitorRecords()).rejects.toThrow("登录状态已变更");
  expect(mock.evidence!.rows([])).toEqual([]); expect(mock.refresh).not.toHaveBeenCalled(); expect(mock.post).toHaveBeenCalledOnce();
});
