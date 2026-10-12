import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _rdsUpsertOrders as saveGtc } from "./orderModes/gtc/pm_gtc_orders_store.js";
import { fetchOrdersByExecutionPage } from "./orderModes/read.js";
import * as compat from "./orders_execution_compat.js";
import * as orders from "./orders_store.js";

const mock = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock("./common.js", () => ({ getPgPool: () => ({ query: mock.query, connect: mock.connect }), _jsonb: (v, fallback) => JSON.stringify(v ?? fallback) }));

beforeEach(() => {
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", "0");
  vi.clearAllMocks();
  mock.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mock.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mock.connect.mockResolvedValue({ query: mock.clientQuery, release: mock.release });
  orders.setOrdersInsertedHook(null);
});
afterEach(() => vi.unstubAllEnvs());

async function enable() {
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
  await compat.prepareOrdersExecutionCompatibility({ query: async () => ({ rows: [{ valid: true }] }) });
}

describe("explicit schema activation", () => {
  it("old schema never validates or creates any schema", async () => {
    const query = vi.fn();
    await compat.prepareOrdersExecutionCompatibility({ query });
    expect(query).not.toHaveBeenCalled();
    expect(compat.financialOrdersRelation()).toBe("orders");
    expect(compat.financialOrdersRelation("pm")).toBe("orders pm");
  });
  it.each([undefined, null, false, 1, "true"])("does not activate an invalid schema result: %s", async (valid) => {
    vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
    const query = vi.fn(async () => ({ rows: [{ valid }] }));
    await expect(compat.prepareOrdersExecutionCompatibility({ query })).rejects.toThrow("验证失败");
    expect(() => compat.financialOrdersRelation()).toThrow("启动验证");
    expect(query).toHaveBeenCalledExactlyOnceWith("SELECT public.validate_orders_execution_schema_v1() AS valid");
  });
  it("missing schema cannot silently fall back to old finance reads", async () => {
    vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
    await expect(compat.prepareOrdersExecutionCompatibility({ query: async () => { throw new Error("42883"); } })).rejects.toThrow("42883");
    expect(() => compat.financialOrdersRelation()).toThrow("启动验证");
  });
  it("validates a new pool before using it; a failed replacement disables compatibility", async () => {
    await enable();
    await expect(compat.prepareOrdersExecutionCompatibility({ query: async () => ({ rows: [] }) })).rejects.toThrow();
    expect(() => compat.financialOrdersRelation()).toThrow();
  });
  it("activation is idempotent for the validated pool", async () => {
    vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
    const query = vi.fn(async () => ({ rows: [{ valid: true }] }));
    const pool = { query };
    await compat.prepareOrdersExecutionCompatibility(pool);
    await compat.prepareOrdersExecutionCompatibility(pool);
    expect(query).toHaveBeenCalledOnce();
    expect(compat.financialOrdersRelation()).toBe("public.orders_financial AS orders");
  });
  it.each(["true", "yes", "2"])("rejects unknown activation mode %s", (mode) => {
    vi.stubEnv("ORDERS_EXECUTION_COMPAT", mode);
    expect(() => compat.financialOrdersRelation()).toThrow("只能是");
  });
  it("sQL aliases cannot inject a statement", () => {
    expect(() => compat.financialOrdersRelation("o; DELETE FROM orders")).toThrow("非法");
  });
});

const readers = [
  ["date", () => orders.fetchOrdersByDate("2026-10-11", "owner")],
  ["date page", () => orders.fetchOrdersByDatePage("2026-10-11", "owner", 2, 3)],
  ["player", () => orders.fetchOrdersByPlayerStrict(1, "owner")],
  ["open position", () => orders.fetchOrdersByPlayerStrict(1, "owner", { sinceCreateAt: 123 })],
  ["all player", () => orders.fetchOrdersByPlayerAll(1, "owner")],
  ["player ids", () => orders.fetchOrdersByPlayerOrderIdsStrict(1, "owner", ["HASH"])],
  ["link", () => orders.fetchOrdersByLink("owner", 123)],
  ["links", () => orders.fetchOrdersByLinks("owner", [123])],
  ["user ids", () => orders.fetchOrdersByUserOrderIds("owner", ["HASH"])],
  ["sell parents", () => orders.fetchPredictionSellsByBuyOrderIds("owner", ["HASH"])],
  ["single order", () => orders.fetchOrderByOrderId("owner", "HASH")],
  ["admin stats", () => orders.fetchOrdersAdminStats("2026-10-11")],
  ["admin page", () => orders.fetchOrdersAdminPage({ dateKey: "2026-10-11", pageIndex: 2, pageSize: 3 })],
  ["football admin", () => orders.fetchUnifiedFootballOrdersAdmin({ dateKey: "2026-10-11" })],
  ["admin all", () => orders.fetchOrdersAdminAll({ dateKey: "2026-10-11" })],
  ["month financial", () => orders.fetchOrdersForMonthAggregate("2026-10", "owner")],
  ["profit financial", () => orders.fetchOrdersForProfitAggregate("2026-10-11")],
  ["platform", () => orders.fetchPlatformAnalytics(1, 1000)],
  ["arb pair", () => orders.fetchArbPairAnalytics(1, 1000)],
  ["games", () => orders.fetchGameAnalytics(1, 1000)],
  ["hourly", () => orders.fetchHourlyAnalytics(1, 1000)],
  ["value bets", () => orders.fetchValueBetOrderAnalytics(1, 1000)],
  ["arb odds", () => orders.fetchArbOddsAnalytics(1, 1000)],
  ["PM analytics", () => orders.fetchPolymarketOrderAnalytics(1, 1000)],
  ["PM stats", () => orders.fetchPolymarketOrderStatsInRange(1, 1000)],
  ["PM range", () => orders.fetchPolymarketOrdersInRange(1, 1000)],
  ["account", () => orders.fetchAccountAnalytics(1, 1000)],
  ["FOK page", () => fetchOrdersByExecutionPage("2026-10-11", "owner", "FOK", [], 2, 3)],
  ["GTC finance page", () => fetchOrdersByExecutionPage("2026-10-11", "owner", "GTC", [], 2, 3)],
];

describe("all financial reads filter before aggregation, joins and pagination", () => {
  it.each(readers)("%s preserves original SQL/params when disabled and changes only relations when enabled", async (_, read) => {
    await read();
    const original = structuredClone(mock.query.mock.calls);
    expect(original.length).toBeGreaterThan(0);
    await enable();
    mock.query.mockClear();
    await read();
    const current = mock.query.mock.calls;
    expect(current.length).toBe(original.length);
    for (const [index, [sql, params]] of current.entries()) {
      expect(sql).toContain("public.orders_financial");
      expect(sql).not.toMatch(/\b(?:FROM|JOIN) orders\b/i);
      expect(sql.replaceAll("public.orders_financial AS orders", "orders").replaceAll("public.orders_financial", "orders")).toBe(original[index][0]);
      expect(params).toEqual(original[index][1]);
    }
  });
});

describe("financial deletion retains execution control and BIGINT identity", () => {
  it("uses one sorted locking statement, returns financial deletions, and never deletes execution rows", async () => {
    await enable();
    mock.query.mockResolvedValue({ rows: [{ id: "9007199254740993" }, { id: "5" }], rowCount: 2 });
    expect(await orders.deleteOrdersByIds(["9007199254740993", "5", "5", -1, "invalid", 9007199254740992])).toBe(2);
    expect(mock.query).toHaveBeenCalledExactlyOnceWith(compat.DELETE_FINANCIAL_ORDERS_SQL, [["9007199254740993", "5"]]);
    expect(compat.DELETE_FINANCIAL_ORDERS_SQL).toContain("ORDER BY id FOR UPDATE");
    expect(compat.DELETE_FINANCIAL_ORDERS_SQL).toContain("t.execution_id IS NULL AND o.financial_ready");
    expect(compat.DELETE_FINANCIAL_ORDERS_SQL).toContain("t.execution_id IS NOT NULL AND o.financial_ready");
    expect(compat.DELETE_FINANCIAL_ORDERS_SQL).not.toMatch(/SET[^;]*(execution_record|execution_id)=/);
  });
  it("a repeated or pending-only deletion reports zero", async () => {
    await enable();
    expect(await orders.deleteOrdersByIds(["7"])).toBe(0);
    expect(mock.query.mock.calls[0][0]).toContain("AND financial_ready");
  });
  it("disabled mode keeps original physical deletion and count", async () => {
    mock.query.mockResolvedValue({ rows: [], rowCount: 2 });
    expect(await orders.deleteOrdersByIds(["7", 8])).toBe(2);
    expect(mock.query).toHaveBeenCalledExactlyOnceWith("DELETE FROM orders WHERE id = ANY($1::bigint[])", [[7, 8]]);
  });
  it("failed deletion returns zero without fallback hard delete", async () => {
    await enable();
    mock.query.mockRejectedValue(new Error("locked"));
    expect(await orders.deleteOrdersByIds(["7"])).toBe(0);
    expect(mock.query).toHaveBeenCalledOnce();
  });
  it("sale deletion filters financial rows and preserves exact sale qualification and scope", async () => {
    await enable();
    await orders.deletePolymarketSellOrders({ userId: "owner", playerId: 7 });
    const [sql, params] = mock.query.mock.calls[0];
    expect(sql).toContain("DELETE FROM public.orders_financial AS orders");
    expect(sql).toContain("provider = 'Polymarket' AND raw->>'pmSide' = 'sell'");
    expect(params).toEqual(["owner", 7]);
  });
});

const row = { user_id: "owner", player_id: 1, order_id: "hash", provider: "Polymarket", create_at: 10, raw: {} };
describe("ordinary inserts, locks and first-insert hooks", () => {
  it.each([false, true])("mode=%s: fires only after COMMIT for inserted financial rows", async (enabled) => {
    if (enabled)
      await enable();
    const trace = [];
    mock.clientQuery.mockImplementation(async (sql) => {
      trace.push(sql);
      return { rows: sql.includes("INSERT INTO orders") ? [{ ...row, financial_ready: true, execution_id: null, execution_record: { pmAuthorized: true }, was_inserted: true }, { ...row, order_id: "updated", was_inserted: false }] : [] };
    });
    const hook = vi.fn((rows) => { expect(trace.at(-1)).toBe("COMMIT"); expect(rows).toEqual([row]); });
    orders.setOrdersInsertedHook(hook);
    expect(await orders.upsertOrders([row])).toBe(true);
    expect(hook).toHaveBeenCalledOnce();
    if (enabled) {
      expect(trace[1]).toContain("AND NOT pending.financial_ready");
      expect(trace[1]).toContain("WHERE orders.financial_ready");
      expect(trace[1]).not.toMatch(/SET[^;]*execution_record\s*=/);
    }
  });
  it("pending control has no returned financial insertion and no inserted hook", async () => {
    await enable();
    const hook = vi.fn();
    orders.setOrdersInsertedHook(hook);
    expect(await orders.upsertOrders([row])).toBe(true);
    expect(hook).not.toHaveBeenCalled();
    expect(mock.clientQuery.mock.calls[1][0]).toContain("lower(pending.order_id)=lower(t.order_id)");
  });
  it("cOMMIT failure rolls back, releases, and never fires the hook", async () => {
    await enable();
    const hook = vi.fn();
    orders.setOrdersInsertedHook(hook);
    mock.clientQuery.mockImplementation(async (sql) => {
      if (sql === "COMMIT")
        throw new Error("commit failed");
      return { rows: sql.includes("INSERT INTO orders") ? [{ ...row, was_inserted: true }] : [] };
    });
    expect(await orders.upsertOrders([row])).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect(mock.clientQuery.mock.calls.at(-1)[0]).toBe("ROLLBACK");
    expect(mock.release).toHaveBeenCalledOnce();
  });
  it("hook exceptions stay isolated after commit", async () => {
    await enable();
    mock.clientQuery.mockImplementation(async sql => ({ rows: sql.includes("INSERT INTO orders") ? [{ ...row, was_inserted: true }] : [] }));
    orders.setOrdersInsertedHook(() => { throw new Error("notify failed"); });
    expect(await orders.upsertOrders([row])).toBe(true);
    expect(mock.clientQuery.mock.calls.at(-1)[0]).toBe("COMMIT");
  });
  it("gTC locks execution ids in sorted order with UPDATE from the start", async () => {
    await enable();
    const execution = { plan: { playerId: 1, otherPlayerId: 2, otherProvider: "RAY" }, other: { state: "accepted", orderId: "ray" } };
    mock.clientQuery.mockImplementation(async sql => ({ rows: sql.startsWith("SELECT record") ? [{ record: execution }] : [] }));
    const other = id => ({ ...row, player_id: 2, provider: "RAY", order_id: "ray", raw: { pmGtcExecutionId: id } });
    await saveGtc({ connect: mock.connect }, [other("z"), { ...other("a"), order_id: "RAY" }]);
    const locks = mock.clientQuery.mock.calls.filter(([sql]) => sql.startsWith("SELECT record"));
    expect(locks.map(([, p]) => p[0])).toEqual(["a", "z"]);
    expect(locks.every(([sql]) => sql.endsWith("FOR UPDATE"))).toBe(true);
    expect(mock.clientQuery.mock.calls.at(-1)[0]).toBe("COMMIT");
  });
});

describe("gTC promotion is part of the original single financial write", () => {
  const source = fs.readFileSync("server/db/rds/orderModes/gtc/pm_gtc_store.js", "utf8");
  const sql = source.match(/gtcFinancialUpsertSql\(`(INSERT[\s\S]*?)`\)/)[1];
  it("disabled mode keeps the whole original SQL and adds no await or lock", () => {
    expect(compat.gtcFinancialUpsertSql(sql)).toBe(sql);
    expect(mock.clientQuery).not.toHaveBeenCalled();
  });
  it("preserves stored hash spelling, validates control identity, and does not rewrite primary or control fields", async () => {
    await enable();
    const current = compat.gtcFinancialUpsertSql(sql);
    expect(current).toContain("WITH gtc_financial_target AS MATERIALIZED");
    expect(current).toContain("execution_id=($11::jsonb->>'pmGtcExecutionId')::uuid");
    expect(current).toContain("OR (execution_id IS NULL AND financial_ready) THEN order_id ELSE NULL");
    expect(current).toContain("FROM gtc_financial_target)\n    ELSE $3 END");
    expect(current.split("INSERT INTO orders")).toHaveLength(2);
    expect(current.split("DO UPDATE SET")[1]).not.toMatch(/(?:execution_record|execution_id|order_id|user_id|player_id)\s*=/);
    expect(mock.clientQuery).not.toHaveBeenCalled();
  });
  it("known finance retains ledger fields; deleted finance uses original fresh INSERT defaults without new hooks", async () => {
    await enable();
    const current = compat.gtcFinancialUpsertSql(sql);
    for (const column of ["link", "provider", "match", "bet", "item", "money", "status", "create_at", "changmen_bet"])
      expect(current).toContain(`${column}=CASE WHEN orders.financial_ready THEN orders.${column} ELSE EXCLUDED.${column} END`);
    expect(current.split("CASE WHEN orders.financial_ready THEN orders.raw ELSE '{}'::jsonb END").length).toBe(4);
    expect(current).toContain("financial_ready=true");
    expect(current).not.toContain("was_inserted");
  });
  it.each([
    ["missing values", "VALUES($1,$2,$3", "VALUES($1,$2,$99"],
    ["missing conflict", "ON CONFLICT(user_id,order_id,player_id)", "ON CONFLICT(order_id)"],
    ["extra ledger reference", "orders.raw", "orders.raw || orders.raw"],
  ])("rejects %s without a broad rewrite", async (_, before, after) => {
    await enable();
    expect(() => compat.gtcFinancialUpsertSql(sql.replace(before, after))).toThrow("原写入边界");
  });
});
