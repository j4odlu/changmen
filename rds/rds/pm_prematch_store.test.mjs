import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./common.js", () => ({ getPgPool: () => ({ query: mocks.query }) }));
import { ensurePmPrematchSchema, fetchPmPrematchPrices, writePmPrematchPrices } from "./pm_prematch_store.js";
beforeEach(() => { mocks.query.mockReset(); });

it("keeps schedule revisions separate and refuses out-of-order writes", async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  const records = [{ tokenId: "a", marketId: "m", cutoff: 100, checkedAt: 200, status: "ready", price: .4 }];
  await writePmPrematchPrices(records);
  const [sql, params] = mocks.query.mock.calls[0];
  expect(sql).toContain("ON CONFLICT (token_id, cutoff)");
  expect(sql).toContain("pm_prematch_prices.checked_at <= EXCLUDED.checked_at");
  expect(params).toEqual([JSON.stringify(records)]);
});

it("reads newest stored schedule in a single parameterized query", async () => {
  mocks.query.mockResolvedValue({ rows: [{ token_id: "a", snapshot: { status: "pending", cutoff: 200 } }] });
  expect(await fetchPmPrematchPrices(["a", "a"])).toEqual({ a: { status: "pending", cutoff: 200 } });
  expect(mocks.query.mock.calls[0][1]).toEqual([["a"]]);
  expect(mocks.query.mock.calls[0][0]).toContain("checked_at DESC");
});

it("creates only the dedicated history table and supports rollout before it exists", async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  await ensurePmPrematchSchema();
  expect(mocks.query.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS pm_prematch_prices");
  mocks.query.mockRejectedValue(Object.assign(new Error("no table"), { code: "42P01" }));
  expect(await fetchPmPrematchPrices(["a"])).toEqual({});
});
