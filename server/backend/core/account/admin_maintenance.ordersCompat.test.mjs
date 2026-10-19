import { afterEach, expect, it, vi } from "vitest";
import { listDuplicateOrderIds, listSharedVenueAccounts } from "./admin_maintenance.js";

const mock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("../../../db/pg_pool.js", () => ({ ensurePgPoolReady: async () => undefined, getPgPool: () => ({ query: mock.query }) }));
afterEach(() => vi.unstubAllEnvs());
it.each([["shared venue finance count", listSharedVenueAccounts], ["duplicate finance orders", listDuplicateOrderIds]])("admin %s uses native orders independently of retired flags", async (_, read) => {
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", "0");
  mock.query.mockClear();
  const old = await read();
  const queries = structuredClone(mock.query.mock.calls);
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
  vi.stubEnv("PM_ORDERS_MINIMAL", "invalid");
  mock.query.mockClear();
  const current = await read();
  // generatedAt is display metadata; empty diagnostic results and all SQL qualifiers stay equal.
  expect({ ...current, generatedAt: 0 }).toEqual({ ...old, generatedAt: 0 });
  expect(mock.query.mock.calls.length).toBe(queries.length);
  for (const [index, [sql, ...params]] of mock.query.mock.calls.entries()) {
    expect(sql).toContain("orders o");
    expect(sql).toBe(queries[index][0]);
    expect(params).toEqual(queries[index].slice(1));
  }
});
