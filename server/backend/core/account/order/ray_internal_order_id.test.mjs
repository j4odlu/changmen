import { beforeEach, expect, it, vi } from "vitest";
import { saveOrder, rowToOrder, toClientOrder } from "../order_store.js";

const mock = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), patch: vi.fn() }));
vi.mock("@changmen/db", async importOriginal => ({ ...await importOriginal(),
  fetchOrdersByPlayerOrderIdsStrict: mock.read, upsertOrders: mock.write, patchRayMonitorOrders: mock.patch,
}));
const original = Object.freeze({ provider: "RAY", orderId: "R-1", rayInternalOrderId: "394004085",
  link: 1_794_268_150_516, createAt: 1_794_268_151_000, status: "none", betMoney: 91, odds: 2.21, money: 0 });
let stored;
beforeEach(() => {
  vi.clearAllMocks(); stored = undefined;
  mock.read.mockImplementation(async () => stored ? [stored] : []);
  mock.write.mockImplementation(async rows => { stored = JSON.parse(JSON.stringify(rows[0])); return true; });
  mock.patch.mockResolvedValue(true);
});
const save = order => saveOrder(2, [JSON.parse(JSON.stringify(order))], "owner", "RAY");

it("persists the internal id in raw and returns it through both account and client read projections", async () => {
  expect(await save(original)).toBe(true);
  expect(stored).toMatchObject({ user_id: "owner", player_id: 2, provider: "RAY", order_id: "R-1",
    link: original.link, create_at: original.createAt, status: "None", bet_money: 91, odds: 2.21, money: 0,
    raw: { orderId: "R-1", rayInternalOrderId: "394004085" } });
  expect(rowToOrder(stored)).toMatchObject({ OrderID: "R-1", RayInternalOrderId: "394004085", Link: original.link });
  expect(toClientOrder(stored)).toMatchObject({ OrderID: "R-1", RayInternalOrderId: "394004085", Status: "None", BetMoney: 91 });
  expect(original.rayInternalOrderId).toBe("394004085");
});

it.each([undefined, null, ""])("keeps the stored native id when a later ordinary save has id=%s", async rayInternalOrderId => {
  await save(original);
  expect(await save({ ...original, rayInternalOrderId, createAt: original.createAt + 9000 })).toBe(true);
  expect(stored).toMatchObject({ order_id: "R-1", link: original.link, create_at: original.createAt,
    status: "None", bet_money: 91, odds: 2.21, money: 0, raw: { rayInternalOrderId: "394004085" } });
});

it("fills a legacy order's missing id on ordinary resync without changing its identity or financial facts", async () => {
  const { rayInternalOrderId, ...legacy } = original;
  await save(legacy);
  const before = structuredClone(stored);
  expect(toClientOrder(stored)).not.toHaveProperty("RayInternalOrderId");
  await save(original);
  expect(stored).toEqual({ ...before, raw: { ...before.raw, rayInternalOrderId } });
});

it("retains the id when the existing guarded monitor-save path receives a partial legacy payload", async () => {
  await save(original);
  const { rayInternalOrderId: _id, ...legacy } = original;
  expect(await saveOrder(2, [legacy], "owner", "RAY", { rayMonitorOnly: true })).toBe(true);
  expect(mock.patch).toHaveBeenCalledWith([expect.objectContaining({ order_id: "R-1", link: original.link,
    create_at: original.createAt, raw: expect.objectContaining({ rayInternalOrderId: "394004085" }) })]);
});

it("does not invent a native id from the CHANGMEN primary key, and does not expose it on other providers", () => {
  expect(rowToOrder({ id: 394004085, provider: "RAY", order_id: "R-1", raw: {} })).not.toHaveProperty("RayInternalOrderId");
  for (const provider of ["OB", "Polymarket", "PredictFun"])
    expect(toClientOrder({ provider, order_id: "other", raw: { rayInternalOrderId: "394004085" } })).not.toHaveProperty("RayInternalOrderId");
});
