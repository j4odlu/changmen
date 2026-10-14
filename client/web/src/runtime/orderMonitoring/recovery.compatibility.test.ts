import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGtcSettlementEvidence } from "@/orderModes/gtc/settlementEvidence";
import { recoverMonitorRecords, resetMonitorRecovery } from "./recovery";

const mock = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn(), list: vi.fn(), session: true, records: [] as GtcExecution[], error: "", evidence: undefined as ReturnType<typeof createGtcSettlementEvidence> | undefined }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => "owner", isAuthSessionCurrent: () => mock.session, unwrap: (response: { success: number; msg?: string; info: unknown }) => {
  if (response.success !== 1)
    throw new Error(response.msg); return response.info;
} }));
vi.mock("@/orderModes/gtc/executionState", () => ({ captureGtcSession: () => () => mock.session, knownGtcRevisions: () => ({}), applyRecoveredGtcRecords: () => 0, financialOrders: () => mock.evidence!.rows([]), gtcProgress: mock, settlement: { rows: (...args: Parameters<ReturnType<typeof createGtcSettlementEvidence>["rows"]>) => mock.evidence!.rows(...args) } }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ fetchOrders: mock.refresh, orderDate: "2026-10-11" }) }));
const id = "11111111-1111-1111-1111-111111111111"; const at = Date.UTC(2026, 9, 8, 23, 59);
const original = { PlayerID: 1, Type: "Polymarket", OrderID: "buy", Status: "Win" as const, PmGtcExecutionId: id };
beforeEach(() => {
  vi.useFakeTimers();
  resetMonitorRecovery(); vi.clearAllMocks(); mock.session = true; mock.error = ""; mock.evidence = createGtcSettlementEvidence();
  mock.records = [createGtcExecution(id, "owner", "wallet", "maker", { playerId: 1, orderHash: "buy", linkId: at } as GtcPlan, at)];
  Object.assign(mock.records[0]!, { pmAuthorized: true, submit: "accepted", orderId: "buy" });
  mock.list.mockResolvedValue(undefined); mock.refresh.mockResolvedValue(undefined);
  mock.post.mockImplementation(async (action, body) => {
    if (action === "Pm_GtcRecover")
      return { success: 0, msg: "未知预测市场 action: Pm_GtcRecover" };
    if (action === "Pm_GtcMonitorOrders")
      return { success: 0, msg: "未知预测市场 action: Pm_GtcMonitorOrders" };
    if (action === "Pm_GtcList")
      return { success: 1, info: mock.records };
    if (action !== "Pm_GtcOrders")
      throw new Error("unexpected mutation/shared order call");
    return { success: 1, info: { list: body.pageIndex === 1 ? [original] : [], pageIndex: body.pageIndex, pageSize: body.pageSize } };
  });
});
afterEach(() => vi.useRealTimers());
it("restores cross-date financial terminal evidence on old backend and retains selected ordinary date", async () => {
  const first = recoverMonitorRecords(); const duplicate = recoverMonitorRecords(); expect(duplicate).toBe(first);
  await first; await vi.dynamicImportSettled();
  expect(mock.evidence!.rows([])).toEqual([original]); expect(mock.error).toBe("");
  expect(mock.refresh).not.toHaveBeenCalled();
  const count = mock.post.mock.calls.length; await recoverMonitorRecords(); expect(mock.post).toHaveBeenCalledTimes(count);
});
it("does not publish partial terminal evidence or mark successful recovery after a late read failure", async () => {
  const normal = mock.post.getMockImplementation()!;
  mock.post.mockImplementation(async (action, body) => action === "Pm_GtcOrders" && body.pageIndex === 2
    ? { success: 0, msg: "database unavailable" }
    : normal(action, body));
  await expect(recoverMonitorRecords()).rejects.toThrow("database unavailable");
  expect(mock.evidence!.rows([])).toEqual([]); expect(mock.refresh).not.toHaveBeenCalled();
  mock.post.mockImplementation(normal); await vi.advanceTimersByTimeAsync(5000); await recoverMonitorRecords(); expect(mock.evidence!.rows([])).toEqual([original]);
});
it("session changes discard old owner evidence and prevent common-list refresh", async () => {
  const normal = mock.post.getMockImplementation()!;
  mock.post.mockImplementation(async (action, body) => {
    const response = await normal(action, body); if (action === "Pm_GtcOrders")
      mock.session = false; return response;
  });
  await expect(recoverMonitorRecords()).rejects.toThrow("登录状态已变更");
  expect(mock.evidence!.rows([])).toEqual([]); expect(mock.refresh).not.toHaveBeenCalled(); expect(mock.error).toBe("");
});
it("reset invalidates an in-flight recovery before settlement state is written", async () => {
  const normal = mock.post.getMockImplementation()!;
  mock.post.mockImplementation(async (action, body) => {
    const response = await normal(action, body); if (action === "Pm_GtcOrders" && body.pageIndex === 1)
      resetMonitorRecovery(); return response;
  });
  await expect(recoverMonitorRecords()).rejects.toThrow("登录状态已变更");
  expect(mock.evidence!.rows([])).toEqual([]); expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.post).toHaveBeenCalledTimes(5);
});
it("missing a persistently filled original never marks recovery complete or refreshes the common list", async () => {
  mock.records[0]!.financialOrder = { pmShares: 10, pmFillPrice: 0.5, pmStakeUsdc: 5, pmFeeUsdc: 0, odds: 2, betMoney: 5 };
  const normal = mock.post.getMockImplementation()!;
  mock.post.mockImplementation(async (action, body) => action === "Pm_GtcOrders" ? { success: 1, info: { list: [], pageIndex: body.pageIndex, pageSize: body.pageSize } } : normal(action, body));
  await expect(recoverMonitorRecords()).rejects.toThrow("跨日期改绑");
  expect(mock.evidence!.rows([])).toEqual([]); expect(mock.refresh).not.toHaveBeenCalled(); expect(mock.error).toContain("读取失败");
  mock.post.mockImplementation(normal); await vi.advanceTimersByTimeAsync(5000); await recoverMonitorRecords(); expect(mock.evidence!.rows([])).toEqual([original]);
});

it("new exact API restores an already settled manually rebound GTC original without any legacy date scan", async () => {
  mock.records[0]!.financialOrder = { pmShares: 10, pmFillPrice: 0.5, pmStakeUsdc: 5, pmFeeUsdc: 0, odds: 2, betMoney: 5 };
  const rebound = { ...original, Link: at - 30 * 86400000 };
  mock.post.mockImplementation(async (action) => {
    if (action === "Pm_GtcRecover")
      return { success: 0, msg: "未知预测市场 action: Pm_GtcRecover" };
    if (action === "Pm_GtcList")
      return { success: 1, info: mock.records };
    if (action !== "Pm_GtcMonitorOrders")
      throw new Error("unexpected date scan or mutation");
    return { success: 1, info: [rebound] };
  });
  await recoverMonitorRecords(); await vi.dynamicImportSettled();
  expect(mock.evidence!.rows([])).toEqual([rebound]); expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.post).toHaveBeenCalledWith("Pm_GtcMonitorOrders", { ids: [id] }, "", { errorTip: false });
});
it("new API failure never publishes settled evidence, refreshes or marks recovery successful", async () => {
  mock.post.mockImplementation(async action => action === "Pm_GtcRecover"
    ? { success: 0, msg: "未知预测市场 action: Pm_GtcRecover" }
    : action === "Pm_GtcList" ? { success: 1, info: mock.records } : { success: 0, msg: "GTC original missing" });
  await expect(recoverMonitorRecords()).rejects.toThrow("original missing");
  expect(mock.evidence!.rows([])).toEqual([]); expect(mock.refresh).not.toHaveBeenCalled();
  mock.post.mockImplementation(async action => ({ success: 1, info: action === "Pm_GtcList" ? mock.records : [original] }));
  await vi.advanceTimersByTimeAsync(5000); await recoverMonitorRecords(); expect(mock.evidence!.rows([])).toEqual([original]);
});
