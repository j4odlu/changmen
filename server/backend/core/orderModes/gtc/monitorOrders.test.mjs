import { beforeEach, expect, it, vi } from "vitest";
import { getGtcMonitorOrders } from "./orders.js";

const mocks = vi.hoisted(() => ({ records: vi.fn(), orders: vi.fn() }));
vi.mock("@changmen/db", () => ({ listPmGtcByIds: mocks.records, fetchOrdersByPlayerOrderIdsStrict: mocks.orders }));
vi.mock("../../account/order/dto.js", () => ({ toClientOrder: row => ({ OrderID: row.order_id, Type: row.provider, PlayerID: row.player_id, Status: row.status, ...(row.raw?.pmGtcExecutionId ? { PmGtcExecutionId: String(row.raw.pmGtcExecutionId) } : {}) }) }));
vi.mock("../../account/order_store.js", () => ({ attachPlayerDisplayToClientOrders: vi.fn() }));
const id = "11111111-2222-3333-4444-555555555555";
beforeEach(() => {
  vi.clearAllMocks(); mocks.records.mockResolvedValue([{ id, owner: "owner", plan: { playerId: 1, otherPlayerId: 2, otherProvider: "RAY", orderHash: "pm-original" }, orderId: "pm-original", other: { orderId: "ray-original" } }]);
  mocks.orders.mockImplementation(async player => player === 1 ? [{ user_id: "owner", player_id: 1, provider: "Polymarket", order_id: "pm-original", status: "Win" }] : [{ user_id: "owner", player_id: 2, provider: "RAY", order_id: "ray-original", status: "Lose" }, { user_id: "owner", player_id: 2, provider: "RAY", order_id: "unrelated-fok", status: "Win" }]);
});
it("restores exact financial terminals across dates using only authenticated owner and durable account identities", async () => {
  const result = await getGtcMonitorOrders({ ids: [id, id], owner: "forged", playerId: 999, date: "1900-01-01" }, "owner");
  expect(mocks.records).toHaveBeenCalledExactlyOnceWith("owner", [id]);
  expect(mocks.orders.mock.calls).toEqual([[1, "owner", ["pm-original"]], [2, "owner", ["ray-original"]]]);
  expect(result.map(row => [row.OrderID, row.Status, row.PmGtcExecutionId])).toEqual([["pm-original", "Win", id], ["ray-original", "Lose", id]]);
});
it("foreign or missing execution IDs cannot expose financial orders", async () => {
  mocks.records.mockResolvedValue([]);
  expect(await getGtcMonitorOrders({ ids: [id] }, "other-owner")).toEqual([]);
  expect(mocks.orders).not.toHaveBeenCalled();
});
it("accepts the JSON array serialized by the frontend form transport", async () => {
  const result = await getGtcMonitorOrders({ ids: JSON.stringify([id, id]) }, "owner");
  expect(mocks.records).toHaveBeenCalledExactlyOnceWith("owner", [id]);
  expect(result.map(row => [row.OrderID, row.Status])).toEqual([["pm-original", "Win"], ["ray-original", "Lose"]]);
});
it.each([{}, { ids: ["invalid"] }, { ids: Array.from({ length: 1001 }).fill(id) }, { ids: "[" }, { ids: JSON.stringify({ id }) }, { ids: JSON.stringify(["invalid"]) }])("rejects malformed monitor identity lists before database reads: %o", async (body) => {
  await expect(getGtcMonitorOrders(body, "owner")).rejects.toThrow("身份无效"); expect(mocks.records).not.toHaveBeenCalled();
});

// [changmen 扩展] 恢复只读；冲突事实不得成为另一执行的结算证据。
const otherId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
it("rejects a durable execution identity belonging to another execution", async () => {
  mocks.orders.mockResolvedValue([{ user_id: "owner", player_id: 1, provider: "Polymarket", order_id: "pm-original", status: "Win", raw: { pmGtcExecutionId: otherId } }]);
  await expect(getGtcMonitorOrders({ ids: [id] }, "owner")).rejects.toThrow("执行身份冲突");
});
it("rejects an identity-free original matched by multiple executions instead of choosing the first", async () => {
  const [record] = await mocks.records();
  mocks.records.mockResolvedValue([record, { ...record, id: otherId }]);
  await expect(getGtcMonitorOrders({ ids: [id, otherId] }, "owner")).rejects.toThrow("执行身份冲突");
});
it("preserves a trusted identity even when another requested execution also has the same anchor", async () => {
  const [record] = await mocks.records();
  mocks.records.mockResolvedValue([record, { ...record, id: otherId }]);
  const stored = { user_id: "owner", player_id: 1, provider: "Polymarket", order_id: "pm-original", status: "Win", raw: { pmGtcExecutionId: otherId, pmStakeUsdc: 12 } };
  mocks.orders.mockImplementation(async player => player === 1 ? [stored] : []);
  expect(await getGtcMonitorOrders({ ids: [id, otherId] }, "owner")).toEqual([{ OrderID: "pm-original", Type: "Polymarket", PlayerID: 1, Status: "Win", PmGtcExecutionId: otherId }]);
  expect(stored.raw).toEqual({ pmGtcExecutionId: otherId, pmStakeUsdc: 12 });
});
it("duplicates of the same execution do not make a unique legacy identity ambiguous", async () => {
  const [record] = await mocks.records();
  mocks.records.mockResolvedValue([record, record]);
  const result = await getGtcMonitorOrders({ ids: [id] }, "owner");
  expect(result.map(row => row.PmGtcExecutionId)).toEqual([id, id]);
});
it("does not recover a same-Link row from another venue or order ID", async () => {
  mocks.orders.mockImplementation(async player => player === 1 ? [{ user_id: "owner", player_id: 1, provider: "OB", order_id: "pm-original", status: "Win", link: 3 }, { user_id: "owner", player_id: 1, provider: "Polymarket", order_id: "unrelated", status: "Win", link: 3 }] : []);
  expect(await getGtcMonitorOrders({ ids: [id] }, "owner")).toEqual([]);
});

it("rejects missing authentication before reading any durable identity", async () => {
  await expect(getGtcMonitorOrders({ ids: [id] }, "")).rejects.toThrow("登录");
  expect(mocks.records).not.toHaveBeenCalled(); expect(mocks.orders).not.toHaveBeenCalled();
});
it.each(["-".repeat(36), "1".repeat(36)])("rejects a length-correct but malformed UUID %s", async (invalid) => {
  await expect(getGtcMonitorOrders({ ids: [invalid] }, "owner")).rejects.toThrow("身份无效");
  expect(mocks.records).not.toHaveBeenCalled();
});
it("normalizes case and deduplicates execution UUIDs before owned lookup", async () => {
  const [record] = await mocks.records(); mocks.records.mockResolvedValue([{ ...record, id: otherId }]);
  await getGtcMonitorOrders({ ids: [otherId.toUpperCase(), otherId] }, "owner");
  expect(mocks.records).toHaveBeenLastCalledWith("owner", [otherId]);
});
it.each([{ owner: "foreign" }, { id: otherId }])("rejects a returned execution outside the authenticated request: %o", async (change) => {
  const [record] = await mocks.records(); mocks.records.mockResolvedValue([{ ...record, ...change }]);
  await expect(getGtcMonitorOrders({ ids: [id] }, "owner")).rejects.toThrow("执行归属无效");
  expect(mocks.orders).not.toHaveBeenCalled();
});
it.each([{ user_id: "foreign" }, { player_id: 99 }])("never attaches a terminal from another owner/account: %o", async (change) => {
  mocks.orders.mockResolvedValue([{ user_id: "owner", player_id: 1, provider: "Polymarket", order_id: "pm-original", status: "Win", ...change }]);
  await expect(getGtcMonitorOrders({ ids: [id] }, "owner")).rejects.toThrow("账号归属无效");
});
it("looks up both the venue original ID and signed hash without reading Link or dates", async () => {
  const [record] = await mocks.records();
  mocks.records.mockResolvedValue([{ ...record, orderId: "venue-id", financialOrder: { pmShares: 10 } }]);
  const result = await getGtcMonitorOrders({ ids: [id] }, "owner");
  expect(mocks.orders).toHaveBeenCalledWith(1, "owner", ["venue-id", "pm-original"]);
  expect(result[0]).toMatchObject({ OrderID: "pm-original", Status: "Win", PmGtcExecutionId: id });
});
it("fails rather than publishing counterpart-only evidence when a durably filled PM original is missing", async () => {
  const [record] = await mocks.records(); mocks.records.mockResolvedValue([{ ...record, financialOrder: { pmShares: 10 } }]);
  mocks.orders.mockImplementation(async player => player === 1 ? [] : [{ user_id: "owner", player_id: 2, provider: "RAY", order_id: "ray-original", status: "Lose" }]);
  await expect(getGtcMonitorOrders({ ids: [id] }, "owner")).rejects.toThrow("财务记录缺失");
});
it("unfilled originals legitimately have no financial evidence", async () => {
  mocks.orders.mockResolvedValue([]);
  expect(await getGtcMonitorOrders({ ids: [id] }, "owner")).toEqual([]);
});
it("database failures propagate instead of returning successful empty recovery", async () => {
  mocks.orders.mockRejectedValue(new Error("ledger unavailable"));
  await expect(getGtcMonitorOrders({ ids: [id] }, "owner")).rejects.toThrow("ledger unavailable");
});
it("a sell row cannot stand in for the committed original buy even with the same anchor identity", async () => {
  const [record] = await mocks.records(); mocks.records.mockResolvedValue([{ ...record, financialOrder: { pmShares: 10 } }]);
  mocks.orders.mockImplementation(async player => player === 1 ? [{ user_id: "owner", player_id: 1, provider: "Polymarket", order_id: "pm-original", status: "Win", raw: { pmSide: "sell", pmGtcExecutionId: id } }] : []);
  await expect(getGtcMonitorOrders({ ids: [id] }, "owner")).rejects.toThrow("财务记录缺失");
});
