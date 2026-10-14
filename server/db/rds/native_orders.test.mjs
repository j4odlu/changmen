import { afterEach, expect, it, vi } from "vitest";
import { financialOrdersHookRow, financialOrdersRelation } from "./native_orders.js";
import * as current from "./orders_store.js";
import { historicalCompatibility, loadHistoricalOrderStorage } from "../../../scripts/verification/historical-order-storage.mjs";
const mocks = vi.hoisted(() => ({ calls: [], query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock("./common.js", () => ({ getPgPool: () => ({ query: mocks.query, connect: mocks.connect }), _jsonb: (v, fallback) => JSON.stringify(v ?? fallback) }));
const previous = loadHistoricalOrderStorage("server/db/rds/orders_store.js");
const flags = value => { for (const name of ["ORDERS_EXECUTION_COMPAT", "PM_ORDERS_MINIMAL", "PM_ORDERS_MINIMAL_PROJECTION_WRITE"]) vi.stubEnv(name, value); };
afterEach(() => vi.unstubAllEnvs());
it("native queries and hook output preserve the original default behavior, including legacy stored fields", () => {
  flags("0");
  for (const alias of ["", "o", "pm"]) expect(financialOrdersRelation(alias)).toBe(historicalCompatibility.financialOrdersRelation(alias));
  const row = { id: "7", raw: { fact: 1 }, money: 11, bet_money: 5, pm_order_mode: null, pm_order_snapshot: null,
    execution_kind: "GTC", execution_id: "old", execution_wallet_key: "private", execution_active: false, execution_record: { control: 1 }, execution_updated_at: "2", financial_ready: true };
  expect(financialOrdersHookRow(row)).toEqual(historicalCompatibility.financialOrdersHookRow(row));
  expect(financialOrdersHookRow(row)).toEqual({ id: "7", raw: { fact: 1 }, money: 11, bet_money: 5 });
  expect(() => financialOrdersRelation("o; DROP TABLE orders")).toThrow("非法");
});
async function trace(store, operation, failure = false) {
  mocks.calls = []; mocks.query.mockReset(); mocks.release.mockReset();
  const row = { id: "7", user_id: "owner", player_id: "1", provider: "Polymarket", order_id: "fok", link: 1,
    status: "None", money: 0, bet_money: 10, raw: { pmSide: "buy" }, execution_record: { control: true }, financial_ready: true };
  mocks.query.mockImplementation(async (sql, params) => {
    mocks.calls.push({ sql, params });
    if (failure && sql.includes("INSERT INTO orders")) throw Error("native writer unavailable");
    return { rows: sql.includes("INSERT INTO orders") ? [{ ...row, was_inserted: true }] : [], rowCount: 2 };
  });
  mocks.connect.mockResolvedValue({ query: mocks.query, release: () => mocks.calls.push({ release: true }) });
  store.setOrdersInsertedHook(rows => mocks.calls.push({ hook: rows }));
  const result = operation === "save" ? await store.upsertOrders([row])
    : operation === "read" ? await store.fetchOrdersByPlayerStrict(1, "owner") : await store.deleteOrdersByIds(["7", 8]);
  store.setOrdersInsertedHook(null);
  return structuredClone({ result, calls: mocks.calls });
}
it.each(["1", "invalid"])("deprecated flag values=%s cannot alter native FOK read/write/delete or hook/rollback behavior", async value => {
  for (const operation of ["save", "read", "delete"]) {
    flags("0"); const old = await trace(previous, operation);
    flags(value); expect(await trace(current, operation)).toEqual(old);
  }
  flags("0"); const old = await trace(previous, "save", true);
  flags(value); expect(await trace(current, "save", true)).toEqual(old);
});
