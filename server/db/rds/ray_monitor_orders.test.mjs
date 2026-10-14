import { beforeEach, expect, it, vi } from "vitest";
import { fetchOrdersByPlayerStrict, patchRayMonitorOrders } from "./orders_store.js";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./common.js", () => ({ getPgPool: () => ({ query: mock.query }), _jsonb: JSON.stringify }));
beforeEach(() => { vi.clearAllMocks(); mock.query.mockResolvedValue({ rows: [] }); });
it("scopes pending and exact terminal recovery to both owner and RAY account across all dates", async () => {
  await fetchOrdersByPlayerStrict(2, "owner", { rayMonitorOrderIds: [" ORDER ", "order"] });
  const [sql, params] = mock.query.mock.calls[0];
  expect(sql).toContain("user_id = $1 AND player_id = $2 AND provider = 'RAY'");
  expect(sql).toContain("NOT IN ('win', 'lose', 'lost', 'return', 'reject')");
  expect(sql).toContain("OR lower(order_id) = ANY($3::text[])");
  expect(sql).not.toContain("create_at >=");
  expect(params).toEqual(["owner", 2, ["order"]]);
});
it("the existing ordinary account read retains its original query", async () => {
  await fetchOrdersByPlayerStrict(2, "owner");
  const [sql, params] = mock.query.mock.calls[0];
  expect(sql).not.toContain("provider = 'RAY'"); expect(params).toEqual(["owner", 2]);
});
it("monitor recovery propagates database failures", async () => {
  mock.query.mockRejectedValue(new Error("database down"));
  await expect(fetchOrdersByPlayerStrict(2, "owner", { rayMonitorOrderIds: [] })).rejects.toThrow("database down");
});
it("writes only existing RAY rows with an atomic terminal guard and keeps Link, creation time and execution identity", async () => {
  expect(await patchRayMonitorOrders([{ user_id: "owner", player_id: 2, order_id: "order", provider: "RAY", status: "None", create_at: 1, raw: { status: "none" } }])).toBe(true);
  const [sql, params] = mock.query.mock.calls[0];
  expect(sql).toContain("UPDATE orders AS o SET"); expect(sql).not.toContain("INSERT");
  expect(sql).toContain("o.user_id=t.user_id AND o.player_id=t.player_id AND o.order_id=t.order_id");
  expect(sql).toContain("o.provider='RAY' AND t.provider='RAY'");
  expect(sql).toContain("lower(coalesce(o.status,'none')) NOT IN");
  expect(sql).toContain("'pmGtcExecutionId'"); expect(sql).not.toContain("link=t.link"); expect(sql).not.toContain("create_at=t.create_at");
  expect(params[0]).toEqual(["owner"]); expect(params[1]).toEqual([2]); expect(params[2]).toEqual(["order"]);
});
