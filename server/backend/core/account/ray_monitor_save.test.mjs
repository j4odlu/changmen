import { beforeEach, expect, it, vi } from "vitest";
import { saveOrder } from "./order_store.js";
const mock = vi.hoisted(() => ({ read: vi.fn(), patch: vi.fn(), ordinary: vi.fn(), gtc: vi.fn() }));
vi.mock("@changmen/db", async importOriginal => ({ ...await importOriginal(),
  fetchOrdersByPlayerOrderIdsStrict: mock.read, patchRayMonitorOrders: mock.patch,
  upsertOrders: mock.ordinary, upsertPmGtcOrders: mock.gtc,
}));
const incoming = { provider: "RAY", orderId: "order", status: "win", betMoney: 100, odds: 2, createAt: 1000 };
const previous = { provider: "RAY", order_id: "order", status: "None", create_at: 900, link: 12, raw: { domain: "esport", pmGtcExecutionId: "gtc" } };
const save = (order = incoming) => saveOrder(2, [order], "owner", "RAY", { rayMonitorOnly: true });
beforeEach(() => { vi.clearAllMocks(); mock.read.mockResolvedValue([previous]); mock.patch.mockResolvedValue(true); });
it("saves an existing GTC RAY original through the guarded update and preserves its identity", async () => {
  expect(await save()).toBe(true);
  expect(mock.patch.mock.calls[0][0][0]).toMatchObject({ user_id: "owner", player_id: 2, order_id: "order", link: 12, create_at: 900, raw: { pmGtcExecutionId: "gtc" } });
  expect(mock.ordinary).not.toHaveBeenCalled(); expect(mock.gtc).not.toHaveBeenCalled();
});
it.each([{ rows: [] }, { rows: [{ ...previous, provider: "OB" }] }])("cannot create a missing original or write to another provider", async ({ rows }) => {
  mock.read.mockResolvedValue(rows); expect(await save()).toBe(false); expect(mock.patch).not.toHaveBeenCalled();
});
it("cannot downgrade a known terminal order", async () => {
  mock.read.mockResolvedValue([{ ...previous, status: "Win" }]); expect(await save({ ...incoming, status: "none" })).toBe(true);
  expect(mock.patch).toHaveBeenCalledWith([]);
});
it("a failed patch remains a failed save for the monitor to retry", async () => {
  mock.patch.mockResolvedValue(false); expect(await save()).toBe(false);
});
