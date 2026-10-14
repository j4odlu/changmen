import { beforeEach, expect, it, vi } from "vitest";
import { listRayMonitorOrders } from "./ray_monitor_orders.js";
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@changmen/db", () => ({ fetchOrdersByPlayerStrict: mock.read, placeholderLinkFromCreateAt: (at) => at,
  minimalClientOrder: (_row, dto) => dto }));
beforeEach(() => { vi.clearAllMocks(); mock.read.mockResolvedValue([]); });
it("restores cross-date RAY originals through the strict owner/account read without exposing credentials", async () => {
  mock.read.mockResolvedValue([{ order_id: "old", player_id: 2, provider: "RAY", status: "None", create_at: 1, raw: { token: "secret", pmGtcExecutionId: "gtc" } }]);
  const rows = await listRayMonitorOrders(2, "owner", ["original"]);
  expect(mock.read).toHaveBeenCalledWith(2, "owner", { rayMonitorOrderIds: ["original"] });
  expect(rows[0]).toMatchObject({ OrderID: "old", PlayerID: 2, Type: "RAY", PmGtcExecutionId: "gtc" });
  expect(JSON.stringify(rows)).not.toContain("secret");
});
it.each([null, [""], [12], Array(1001).fill("order")])("rejects invalid or oversized original lists before querying", async (ids) => {
  await expect(listRayMonitorOrders(2, "owner", ids)).rejects.toThrow("原单号列表无效");
  expect(mock.read).not.toHaveBeenCalled();
});
it("database failure is not converted to a successful empty recovery", async () => {
  mock.read.mockRejectedValue(new Error("database down"));
  await expect(listRayMonitorOrders(2, "owner", [])).rejects.toThrow("database down");
});
