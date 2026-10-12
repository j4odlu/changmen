import { afterEach, expect, it, vi } from "vitest";
import * as compat from "../../../db/rds/orders_execution_compat.js";
import { listDuplicateOrderIds, listSharedVenueAccounts } from "./admin_maintenance.js";

const mock = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@changmen/db", async () => {
  const actual = await import("../../../db/rds/orders_execution_compat.js");
  return { ensurePgPoolReady: async () => undefined, getPgPool: () => ({ query: mock.query }), financialOrdersRelation: actual.financialOrdersRelation };
});
afterEach(() => vi.unstubAllEnvs());
it.each([["shared venue finance count", listSharedVenueAccounts], ["duplicate finance orders", listDuplicateOrderIds]])("admin %s excludes controls without changing diagnostics", async (_, read) => {
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", "0");
  mock.query.mockClear();
  const old = await read();
  const queries = structuredClone(mock.query.mock.calls);
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
  await compat.prepareOrdersExecutionCompatibility({ query: async () => ({ rows: [{ valid: true }] }) });
  mock.query.mockClear();
  const current = await read();
  // generatedAt is display metadata; empty diagnostic results and all SQL qualifiers stay equal.
  expect({ ...current, generatedAt: 0 }).toEqual({ ...old, generatedAt: 0 });
  expect(mock.query.mock.calls.length).toBe(queries.length);
  for (const [index, [sql, ...params]] of mock.query.mock.calls.entries()) {
    expect(sql).toContain("public.orders_financial o");
    expect(sql.replaceAll("public.orders_financial", "orders")).toBe(queries[index][0]);
    expect(params).toEqual(queries[index].slice(1));
  }
});
