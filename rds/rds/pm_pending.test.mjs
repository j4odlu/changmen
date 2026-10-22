import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchOrdersByDate, fetchOrdersByPlayerStrict, upsertOrders,
  fetchOrdersAdminStats, fetchOrdersForMonthAggregate, fetchOrdersForProfitAggregate,
  fetchPlatformAnalytics, fetchArbPairAnalytics, fetchGameAnalytics, fetchHourlyAnalytics,
  fetchValueBetOrderAnalytics, fetchArbOddsAnalytics, fetchPolymarketOrderAnalytics,
  fetchPolymarketOrderStatsInRange, fetchAccountAnalytics,
} from "./orders_store.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), write: vi.fn() }));
vi.mock("./common.js", () => ({ getPgPool: () => ({ query: mocks.query,
  connect: async () => ({ query: mocks.write, release: vi.fn() }) }),
  _jsonb: value => JSON.stringify(value ?? {}),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue({ rows: [] }); mocks.write.mockResolvedValue({ rows: [] }); });

it("retains Pending in display queries and scopes recovery by both owner and account", async () => {
  await fetchOrdersByDate("2026-10-23", "owner");
  expect(mocks.query.mock.calls[0][0]).not.toContain("status IS DISTINCT FROM 'Pending'");
  await fetchOrdersByPlayerStrict(292, "owner", { pmPendingOnly: true });
  const [sql, values] = mocks.query.mock.calls[1];
  expect(sql).toContain("user_id = $1 AND player_id = $2");
  expect(sql).toContain("provider = 'Polymarket' AND status = 'Pending'");
  expect(values).toEqual(["owner", 292]);
});

it("rejects out-of-order Pending updates at the database write boundary", async () => {
  await upsertOrders([{ user_id: "owner", player_id: 292, order_id: "same-order", provider: "Polymarket",
    status: "Pending", create_at: 1792686326358, raw: {} }]);
  const [sql] = mocks.write.mock.calls.find(([query]) => query.includes("ON CONFLICT"));
  expect(sql).toContain("EXCLUDED.status = 'Pending' AND orders.status IS DISTINCT FROM 'Pending'");
  expect(sql).toContain("EXCLUDED.status IN ('Reject', 'Return') AND orders.raw ? 'pmSubmission'");
  expect(sql).toContain("orders.raw->'pmShares'");
});

it.each([
  [fetchOrdersAdminStats, ["2026-10-23"]],
  [fetchOrdersForMonthAggregate, ["2026-10", "owner"]],
  [fetchOrdersForProfitAggregate, ["2026-10-23"]],
  ...[fetchPlatformAnalytics, fetchArbPairAnalytics, fetchGameAnalytics, fetchHourlyAnalytics,
    fetchValueBetOrderAnalytics, fetchArbOddsAnalytics, fetchPolymarketOrderAnalytics,
    fetchPolymarketOrderStatsInRange, fetchAccountAnalytics].map(fn => [fn, [1792680000000, 1792766400000, ["owner"]]]),
])("excludes PM Pending from %s without changing other venue statuses", async (read, args) => {
  await read(...args);
  expect(mocks.query).toHaveBeenCalled();
  for (const [sql] of mocks.query.mock.calls)
    expect(sql).toContain("WHERE provider IS DISTINCT FROM 'Polymarket' OR status IS DISTINCT FROM 'Pending'");
});
