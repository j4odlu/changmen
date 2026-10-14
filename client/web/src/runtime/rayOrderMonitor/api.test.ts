import { beforeEach, expect, it, vi } from "vitest";
import { loadRayMonitorOrders, saveRayMonitorOrders } from "./api";
const mock = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/api/client", () => ({ post: mock.post, unwrap: (response: { success: number; info: unknown; msg?: string }) => {
  if (response.success !== 1) throw new Error(response.msg);
  return response.info;
} }));
beforeEach(() => vi.clearAllMocks());
it("loads exact and unfinished original identities without dates, logs or a GTC endpoint", async () => {
  mock.post.mockResolvedValue({ success: 1, info: { orders: [] } });
  expect(await loadRayMonitorOrders(2, ["one"])).toEqual([]);
  expect(mock.post).toHaveBeenCalledExactlyOnceWith("Client_GetPlayerOrder", {
    playerId: 2, includeLogs: false, rayMonitorOnly: true, orderIds: ["one"],
  }, "", { errorTip: false });
});
it("chunks persisted original IDs to the server limit and deduplicates open rows", async () => {
  mock.post.mockResolvedValue({ success: 1, info: { orders: [{ OrderID: "same" }] } });
  expect(await loadRayMonitorOrders(2, Array.from({ length: 1001 }, (_, i) => String(i)))).toHaveLength(1);
  expect(mock.post.mock.calls.map(call => call[1].orderIds.length)).toEqual([1000, 1]);
});
it("invalid and failed recovery responses are not treated as a completed empty recovery", async () => {
  mock.post.mockResolvedValueOnce({ success: 0, msg: "unavailable" }).mockResolvedValueOnce({ success: 1, info: {} });
  await expect(loadRayMonitorOrders(2, [])).rejects.toThrow("unavailable");
  await expect(loadRayMonitorOrders(2, [])).rejects.toThrow("响应无效");
});
it("uses a guarded status update and propagates a failed save", async () => {
  mock.post.mockResolvedValue({ success: 0, msg: "save failed" });
  await expect(saveRayMonitorOrders(2, [])).rejects.toThrow("save failed");
  expect(mock.post).toHaveBeenCalledWith("Client_SaveOrder", { type: "RAY", playerId: 2, orders: "[]", rayMonitorOnly: true }, "", { errorTip: false });
});
