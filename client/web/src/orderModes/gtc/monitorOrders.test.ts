import { beforeEach, expect, it, vi } from "vitest";
import { loadGtcMonitorOrders } from "./ordersApi";
import { createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
const mock = vi.hoisted(() => ({ post: vi.fn(), list: vi.fn(), pending: vi.fn(), current: true }));
vi.mock("./api", () => ({ listGtc: mock.list }));
vi.mock("./localStore", () => ({ pendingGtcResults: mock.pending }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => mock.current,
  unwrap: (response: { success: number; msg?: string; info: unknown }) => { if (response.success !== 1) throw new Error(response.msg); return response.info; } }));
const id = "11111111-1111-1111-1111-111111111111";
beforeEach(() => { vi.clearAllMocks(); mock.current = true; mock.pending.mockResolvedValue([]); mock.list.mockResolvedValue([{ id, plan: { playerId: 1, orderHash: "buy" }, other: {} }]); });
function confirmedRecord() {
  const row = createGtcExecution(id, "owner", "wallet", "maker", { playerId: 1, orderHash: "buy", shares: "10" } as Parameters<typeof createGtcExecution>[4], 1);
  return mergeGtcFacts({ ...row, orderId: "buy" }, { order: null, fills: [{ key: "one", tradeId: "one", bucket: "maker", role: "MAKER", shares: "3", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 2 }], complete: true, observedAt: 2 });
}
it("allows a missing original while its confirmed result is durably queued", async () => {
  mock.list.mockResolvedValue([confirmedRecord()]); mock.pending.mockResolvedValue([{ result: { executionId: id } }]);
  mock.post.mockResolvedValue({ success: 1, info: [] });
  expect(await loadGtcMonitorOrders([id])).toEqual([]);
  expect(mock.pending).toHaveBeenCalledWith("owner");
});
it("rejects a missing confirmed original after synchronization acknowledged it", async () => {
  mock.list.mockResolvedValue([confirmedRecord()]); mock.post.mockResolvedValue({ success: 1, info: [] });
  await expect(loadGtcMonitorOrders([id])).rejects.toThrow("已确认原单财务记录缺失");
  expect(mock.post).toHaveBeenCalledOnce();
});
it("captures the pending state before an acknowledgement can race the ledger read", async () => {
  mock.list.mockResolvedValue([confirmedRecord()]); mock.pending.mockResolvedValue([{ result: { executionId: id } }]);
  mock.post.mockImplementation(async () => { mock.pending.mockResolvedValue([]); return { success: 1, info: [] }; });
  expect(await loadGtcMonitorOrders([id])).toEqual([]);
  expect(mock.pending.mock.invocationCallOrder[0]).toBeLessThan(mock.post.mock.invocationCallOrder[0]!);
});
it("requires no result read for fills that have not been confirmed", async () => {
  const row = confirmedRecord(); row.fills.one!.status = "MINED";
  mock.list.mockResolvedValue([row]); mock.post.mockResolvedValue({ success: 1, info: [] });
  expect(await loadGtcMonitorOrders([id])).toEqual([]);
  expect(mock.pending).not.toHaveBeenCalled();
});
it("stops when the session changes during the pending-result read", async () => {
  mock.list.mockResolvedValue([confirmedRecord()]); mock.pending.mockImplementation(async () => { mock.current = false; return []; });
  await expect(loadGtcMonitorOrders([id])).rejects.toThrow("登录状态已变更"); expect(mock.post).not.toHaveBeenCalled();
});
it("reads exact identities in bounded batches without old list/date queries", async () => {
  mock.post.mockResolvedValue({ success: 1, info: [] });
  const ids = Array.from({ length: 1001 }, (_, n) => `${n.toString(16).padStart(8, "0")}-1111-1111-1111-111111111111`);
  mock.list.mockResolvedValue(ids.map(id => ({ id, plan: { playerId: 1, orderHash: "buy" }, other: {} })));
  expect(await loadGtcMonitorOrders(ids)).toEqual([]);
  expect(mock.post.mock.calls.map(call => [call[0], call[1].anchors.length])).toEqual([["Pm_GtcReadResults", 1000], ["Pm_GtcReadResults", 1]]);
});
it.each([
  { success: 0, msg: "未知预测市场 action: Pm_GtcMonitorOrders" },
  { success: 0, msg: "请先登录" }, { success: 0, msg: "数据库不可用" },
  { success: 1, info: null }, { success: 1, info: {} },
])("propagates unsupported, failed and malformed responses without fallback %o", async response => {
  mock.post.mockResolvedValue(response);
  await expect(loadGtcMonitorOrders([id])).rejects.toThrow();
  expect(mock.post).toHaveBeenCalledOnce();
  expect(mock.post.mock.calls[0]![0]).toBe("Pm_GtcReadResults");
});
it("preserves settled and rebound original results without changing them", async () => {
  const rows = [{ PlayerID: 1, Type: "Polymarket", OrderID: "buy", Status: "Win", PmGtcExecutionId: id, Link: -1 }];
  mock.post.mockResolvedValue({ success: 1, info: rows });
  expect(await loadGtcMonitorOrders([id])).toEqual(rows);
});
it("propagates a network error and sends no replacement query", async () => {
  mock.post.mockRejectedValue(new Error("timeout"));
  await expect(loadGtcMonitorOrders([id])).rejects.toThrow("timeout");
  expect(mock.post).toHaveBeenCalledOnce();
});
it.each(["before", "during", "generation"])("stops after login or generation changes at %s", async stage => {
  let current = stage !== "generation";
  mock.current = stage !== "before";
  mock.post.mockImplementation(async () => { mock.current = false; return { success: 1, info: [] }; });
  await expect(loadGtcMonitorOrders([id], () => current)).rejects.toThrow("登录状态已变更");
  expect(mock.post).toHaveBeenCalledTimes(stage === "during" ? 1 : 0);
});
it("empty or invalid identities send no requests", async () => {
  expect(await loadGtcMonitorOrders([])).toEqual([]);
  for (const ids of [["not-id"], ["------------------------------------"], [id + " "]])
    await expect(loadGtcMonitorOrders(ids)).rejects.toThrow("ID 无效");
  expect(mock.post).not.toHaveBeenCalled();
});
