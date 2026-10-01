import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  unified: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@changmen/db", () => ({
  fetchFootballOrdersAdmin: mocks.admin,
  fetchUnifiedFootballOrdersAdmin: mocks.unified,
}));
vi.mock("../../../db/rds/common.js", () => ({
  getPgPool: () => ({ query: mocks.query }),
}));

import { listAdminFootballOrders } from "./football_order_service.js";
import { fetchFootballOrdersAdmin, fetchFootballOrdersForMonthAggregate } from "../../../db/rds/football_orders_store.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
});

it("lists and totals only OB orders without querying unified venue orders", async () => {
  mocks.admin.mockResolvedValue([
    { id: 1, venue: "OB", placed_at: 1, stake: 100, profit: 80, status: "Win" },
    { id: 2, venue: " ob ", placed_at: 2, stake: 50, profit: 999, status: "Pending" },
    { id: 3, venue: "Polymarket", placed_at: 3, stake: 500, profit: 400, status: "Win" },
    { id: 4, venue: "IM", placed_at: 4, stake: 300, profit: -300, status: "Lose" },
  ]);
  const result = await listAdminFootballOrders({ date: "2026-10-01", userId: "user-1" });
  expect(result.list.map(row => row.rdsId)).toEqual([2, 1]);
  expect(result).toMatchObject({ total: 2, todayStake: 150, todayProfit: 80 });
  expect(mocks.admin).toHaveBeenCalledWith({ date: "2026-10-01", userId: "user-1", limit: 2000 });
  expect(mocks.unified).not.toHaveBeenCalled();
});

it("filters OB before the admin query limit while retaining date and user scope", async () => {
  await fetchFootballOrdersAdmin({ date: "2026-10-01", userId: "user-1", limit: 2000 });
  const [sql, params] = mocks.query.mock.calls.find(([sql]) => sql.includes("SELECT"));
  expect(sql).toContain("UPPER(TRIM(o.venue)) = 'OB'");
  expect(sql).toContain("o.placed_at >= $1 AND o.placed_at < $2");
  expect(sql).toContain("o.user_id = $3::uuid");
  expect(params.slice(2)).toEqual(["user-1", 2000]);
});

it("filters OB for monthly queries with individual and team scopes", async () => {
  await fetchFootballOrdersForMonthAggregate("2026-10", "user-1");
  await fetchFootballOrdersForMonthAggregate("2026-10", undefined, ["user-1", "user-2"]);
  const selects = mocks.query.mock.calls.filter(([sql]) => sql.includes("SELECT"));
  expect(selects).toHaveLength(2);
  for (const [sql] of selects)
    expect(sql).toContain("UPPER(TRIM(venue)) = 'OB'");
  expect(selects[0][0]).toContain("user_id = $3::uuid");
  expect(selects[1][0]).toContain("user_id = ANY($3::uuid[])");
});
