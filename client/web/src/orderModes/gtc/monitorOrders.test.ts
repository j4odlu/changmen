import { beforeEach, expect, it, vi } from "vitest";
import { loadGtcMonitorOrders } from "./ordersApi";
const mock = vi.hoisted(() => ({ post: vi.fn(), current: true }));
vi.mock("@/api/client", () => ({ post: mock.post, getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => mock.current,
  unwrap: (response: { success: number; msg?: string; info: unknown }) => { if (response.success !== 1) throw new Error(response.msg); return response.info; } }));
const id = "11111111-1111-1111-1111-111111111111";
beforeEach(() => { vi.clearAllMocks(); mock.current = true; });
it("reads exact identities in bounded batches without old list/date queries", async () => {
  mock.post.mockResolvedValue({ success: 1, info: [] });
  expect(await loadGtcMonitorOrders(Array(1001).fill(id))).toEqual([]);
  expect(mock.post.mock.calls.map(call => [call[0], call[1].ids.length])).toEqual([["Pm_GtcMonitorOrders", 1000], ["Pm_GtcMonitorOrders", 1]]);
});
it.each([
  { success: 0, msg: "未知预测市场 action: Pm_GtcMonitorOrders" },
  { success: 0, msg: "请先登录" }, { success: 0, msg: "数据库不可用" },
  { success: 1, info: null }, { success: 1, info: {} },
])("propagates unsupported, failed and malformed responses without fallback %o", async response => {
  mock.post.mockResolvedValue(response);
  await expect(loadGtcMonitorOrders([id])).rejects.toThrow();
  expect(mock.post).toHaveBeenCalledOnce();
  expect(mock.post.mock.calls[0]![0]).toBe("Pm_GtcMonitorOrders");
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
