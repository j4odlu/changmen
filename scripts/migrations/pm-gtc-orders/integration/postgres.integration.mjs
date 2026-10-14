import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { historicalCompatibility, loadHistoricalOrderStorage } from "../../../verification/historical-order-storage.mjs";
const { _rdsUpsertOrders: saveGtc } = loadHistoricalOrderStorage("server/db/rds/orderModes/gtc/pm_gtc_orders_store.js");
const { listPmGtc, listPmGtcByIds, mutatePmGtc } = loadHistoricalOrderStorage("server/db/rds/orderModes/gtc/pm_gtc_store.js");
const { fetchOrdersByExecutionPage } = loadHistoricalOrderStorage("server/db/rds/orderModes/read.js");
const { DELETE_FINANCIAL_ORDERS_SQL, prepareOrdersExecutionCompatibility } = historicalCompatibility;
const orders = loadHistoricalOrderStorage("server/db/rds/orders_store.js");
import { accepted, EXECUTION, facts, financialRow, HASH, OWNER, seedControl } from "./fixtures.mjs";
import { isolatedConnection, verifyIsolatedDatabase } from "./guard.mjs";
import { backfillPendingControl } from "../backfill-pending.mjs";
import { jsonHash, planGtcOrdersMerge } from "../plan.mjs";

// [changmen 扩展] 唯一替换连接池入口；固定 Git 历史 writer 使用真实 pg.query，不进入当前应用。
const state = vi.hoisted(() => ({ pool: null, beforeQuery: null, afterQuery: null, trace: [] }));
vi.mock("../../../../server/db/rds/common.js", () => ({
  getPgPool: () => state.pool,
  _jsonb: (value, fallback) => JSON.stringify(value ?? fallback),
}));

// 默认测试发现不会包含本文件；即使直接指定 config，也必须通过专用执行令牌。
const connection = isolatedConnection(process.env.PM_GTC_TEST_DATABASE_URL, process.env.PM_GTC_TEST_EXECUTION_TOKEN);
const evidenceRoot = fs.realpathSync(fileURLToPath(new URL("../../../../output/pm-gtc-phase2-postgres-integration/", import.meta.url)));
const evidenceDir = fs.realpathSync(process.env.PM_GTC_TEST_EVIDENCE_DIR ?? "");
const evidenceRelative = path.relative(evidenceRoot, evidenceDir);
if (!evidenceRelative || evidenceRelative.startsWith("..") || path.isAbsolute(evidenceRelative))
  throw new Error("数据库测试证据目录必须由专用入口在 output 内创建");
const read = name => fs.readFileSync(new URL(name, import.meta.url), "utf8");
let pool;
const clients = new Set();
const gates = new Set();
const tasks = new Set();
let initialized = false;
function track(promise) {
  tasks.add(promise);
  promise.catch(() => {}); // 失败仍由用例 await 断言，避免等待锁信号时出现未处理拒绝。
  return promise;
}
function gate() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  gates.add(resolve);
  return { promise, resolve };
}
async function client() {
  const value = await pool.connect();
  clients.add(value);
  return value;
}
async function blockedBy(waiter, blocker) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const found = await pool.query("SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked", [waiter, blocker]);
    if (found.rows[0].blocked)
      return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error("预期 PostgreSQL 锁等待未出现；不能凭固定 sleep 宣称并发覆盖");
}
function facade() {
  return {
    query: (...args) => pool.query(...args),
    connect: async () => {
      const value = await client();
      return { release: () => {
        if (clients.delete(value))
          value.release();
      }, query: async (sql, params) => {
        await state.beforeQuery?.(sql, value, params);
        const result = await value.query(sql, params);
        state.trace.push({ sql, pid: value.processID });
        await state.afterQuery?.(sql, value, params);
        return result;
      } };
    },
  };
}
async function stored() {
  return (await pool.query("SELECT * FROM orders WHERE execution_id=$1", [EXECUTION])).rows[0];
}
async function missingSource(row = accepted()) {
  await pool.query(`INSERT INTO pm_gtc_executions(id,owner,wallet_key,active,record,updated_at)
    VALUES($1,$2,$3,$4,$5,$6)`, [row.id, row.owner, row.walletKey, !row.released, row, row.createdAt]);
  const reader = await pool.connect(); let snapshot;
  try {
    await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    snapshot = { schemaVersion: 1, complete: true,
      snapshot: { isolation: 'repeatable-read', token: (await reader.query('SELECT pg_current_snapshot()::text AS token')).rows[0].token,
        tables: ['orders', 'pm_gtc_executions', 'profiles'] },
      profiles: (await reader.query('SELECT id FROM profiles')).rows,
      executions: (await reader.query('SELECT * FROM pm_gtc_executions')).rows,
      orders: (await reader.query('SELECT * FROM orders')).rows };
    await reader.query('COMMIT');
  } catch (error) { await reader.query('ROLLBACK'); throw error; }
  finally { reader.release(); }
  const plan = planGtcOrdersMerge(snapshot);
  expect(plan.preflightPassed).toBe(true);
  return { row, snapshot, operation: plan.operations.find(value => value.executionId === row.id) };
}
async function migrate(operation, options = { consumersCompatible: true }) {
  const value = await state.pool.connect();
  try { return await backfillPendingControl(value, operation, options); }
  finally { value.release(); }
}
function runLocalBackfill(snapshot, name) {
  const input = path.join(evidenceDir, `${name}-fixture.json`);
  const output = path.join(evidenceDir, `${name}-result.json`);
  fs.writeFileSync(input, JSON.stringify(snapshot));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/DATABASE|^PG[A-Z_]|^ORDERS_EXECUTION_COMPAT$/.test(key)));
  env.PM_GTC_TEST_DATABASE_URL = process.env.PM_GTC_TEST_DATABASE_URL;
  const result = spawnSync(process.execPath, ['scripts/migrations/pm-gtc-orders/backfill.mjs', '--input', input, '--output', output, '--execute-isolated'],
    { env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return { result, report: JSON.parse(fs.readFileSync(output, 'utf8')),
    journal: fs.readFileSync(output + '.journal.jsonl', 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
}
function control(row) {
  return Object.fromEntries(["id", "order_id", "execution_kind", "execution_id", "execution_wallet_key", "execution_active", "execution_record", "execution_updated_at"].map(key => [key, row[key]]));
}
async function fault({ target = "orders", operation = "UPDATE", deferred = false } = {}) {
  // 测试专用触发器，在真实服务端执行错误；deferred=true 在 COMMIT 才抛错。
  await pool.query(`CREATE OR REPLACE FUNCTION public.phase2_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'phase2 injected fault' USING ERRCODE='23514'; END $$`);
  await pool.query(`CREATE ${deferred ? "CONSTRAINT " : ""}TRIGGER phase2_test_fault
    ${deferred ? "AFTER" : "BEFORE"} ${operation} ON public.${target}
    ${deferred ? "DEFERRABLE INITIALLY DEFERRED" : ""} FOR EACH ROW EXECUTE FUNCTION public.phase2_test_fault()`);
}

describe("isolated real PostgreSQL orders phase2 acceptance", () => {
  beforeAll(async () => {
    const { Pool } = await import("pg");
    pool = new Pool(connection);
    const server = await verifyIsolatedDatabase(pool); // 所有 DDL/DML 之前验证真实服务端。
    fs.writeFileSync(path.join(evidenceDir, "server.json"), JSON.stringify({ ...server, databaseConnected: true, schemaApplied: false }, null, 2));
    await pool.query(read("bootstrap.sql"));
    await pool.query(read("../phase2-schema.sql"));
    await pool.query("ALTER TABLE profiles ADD COLUMN user_name text; CREATE TABLE client_matches(title text,game text)");
    fs.writeFileSync(path.join(evidenceDir, "server.json"), JSON.stringify({ ...server, databaseConnected: true, schemaApplied: true }, null, 2));
    initialized = true;
    vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
    state.pool = facade();
    await prepareOrdersExecutionCompatibility(state.pool);
  });
  beforeEach(async () => {
    state.trace = [];
    state.beforeQuery = state.afterQuery = null;
    orders.setOrdersInsertedHook(null);
    vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
    await pool.query(read("reset-fixtures.sql"));
    await pool.query("INSERT INTO profiles(id) VALUES($1)", [OWNER]);
  });
  afterEach(async () => {
    state.beforeQuery = state.afterQuery = null;
    orders.setOrdersInsertedHook(null);
    for (const release of gates) release();
    gates.clear();
    // 先取消悬挂语句再释放，失败的并发用例不能污染下一项。
    for (const value of [...clients]) {
      if (!clients.has(value))
        continue;
      await pool.query("SELECT pg_cancel_backend($1)", [value.processID]);
    }
    await Promise.allSettled([...tasks]);
    tasks.clear();
    for (const value of [...clients]) {
      try { await value.query("ROLLBACK"); }
      finally {
        if (clients.delete(value))
          value.release(true);
      }
    }
    clients.clear();
    if (initialized) {
      await pool.query("DROP TRIGGER IF EXISTS phase2_test_fault ON orders; DROP TRIGGER IF EXISTS phase2_test_fault ON pm_gtc_executions");
      await pool.query("DROP FUNCTION IF EXISTS public.phase2_test_fault()");
    }
  });
  afterAll(async () => { state.pool = null; await pool?.end(); vi.unstubAllEnvs(); });

  it("PG-01 validates the actual catalog, preserves old defaults and financial view columns", async () => {
    expect((await pool.query("SELECT validate_orders_execution_schema_v1() AS valid")).rows[0].valid).toBe(true);
    expect(await orders.upsertOrders([financialRow()])).toBe(true);
    const row = (await pool.query("SELECT * FROM orders")).rows[0];
    expect(row.financial_ready).toBe(true);
    expect(row.execution_id).toBeNull();
    const financial = (await pool.query("SELECT * FROM orders_financial")).rows[0];
    expect(Object.keys(financial)).toHaveLength(16);
    expect(financial).not.toHaveProperty("execution_record");
    await pool.query("UPDATE orders_financial SET money=7 WHERE id=$1", [row.id]);
    expect((await pool.query("SELECT money FROM orders")).rows[0].money).toBe(7);
    // [changmen 扩展] Catalog formatting support must still reject a changed financial predicate.
    const validation = await client();
    try {
      await validation.query("BEGIN");
      await validation.query(`CREATE OR REPLACE VIEW public.orders_financial AS
        SELECT id,user_id,player_id,order_id,link,provider,match,bet,item,odds,bet_money,money,status,create_at,raw,changmen_bet
        FROM public.orders WHERE true WITH LOCAL CHECK OPTION`);
      expect((await validation.query("SELECT validate_orders_execution_schema_v1() AS valid")).rows[0].valid).toBe(false);
      await expect(prepareOrdersExecutionCompatibility(validation)).rejects.toThrow("验证失败");
    }
    finally { await validation.query("ROLLBACK"); }
    state.pool = facade();
    await prepareOrdersExecutionCompatibility(state.pool);
  });
  it.each(["ready without control", "owner", "hash", "missing flag", "released", "duplicate execution"])("PG-02 rejects invalid control: %s", async (scenario) => {
    const seed = await seedControl(pool);
    let sql; let params;
    if (scenario === "ready without control") {
      sql = "INSERT INTO orders(user_id,player_id,order_id,create_at,financial_ready) VALUES($1,1,'invalid',1,false)";
      params = [OWNER];
    }
    else if (scenario === "duplicate execution") {
      sql = "INSERT INTO orders(user_id,player_id,order_id,provider,create_at,execution_kind,execution_id,execution_wallet_key,execution_active,execution_record,execution_updated_at) SELECT user_id,player_id,order_id,provider,create_at,execution_kind,execution_id,execution_wallet_key,execution_active,execution_record,execution_updated_at FROM orders";
    }
    else {
      const record = structuredClone(seed.execution);
      if (scenario === "owner")
        record.owner = "00000000-0000-4000-8000-000000000002";
      if (scenario === "hash")
        record.plan.orderHash = `0x${"b".repeat(64)}`;
      if (scenario === "missing flag")
        delete record.pmAuthorized;
      if (scenario === "released")
        record.released = true;
      sql = "UPDATE orders SET execution_record=$1 WHERE id=$2"; params = [record, seed.order.id];
    }
    await expect(pool.query(sql, params)).rejects.toMatchObject({ code: scenario === "duplicate execution" ? "23505" : "23514" });
    expect(control(await stored())).toEqual(control(seed.order));
  });
  it("PG-03 excludes pending control from financial statistics and list writes, including hash casing", async () => {
    const seed = await seedControl(pool, { orderId: HASH.toUpperCase() });
    expect(await orders.upsertOrders([financialRow("ordinary-financial")])).toBe(true);
    const rows = await orders.fetchOrdersByPlayerAll(1, OWNER);
    expect(rows.map(row => row.order_id)).toEqual(["ordinary-financial"]);
    expect((await pool.query("SELECT count(*)::int AS count,sum(bet_money) AS bet FROM orders_financial")).rows[0]).toEqual({ count: 1, bet: 16.75 });
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    expect(await orders.upsertOrders([financialRow(HASH)])).toBe(true);
    expect(hook).not.toHaveBeenCalled();
    expect((await pool.query("SELECT count(*)::int AS count FROM orders")).rows[0].count).toBe(2);
    expect(control(await stored())).toEqual(control(seed.order));
  });
  it("PG-04 promotes only through the real qualified GTC mutation, retaining identity/control and no hook", async () => {
    const seed = await seedControl(pool, { orderId: HASH.toUpperCase() });
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    const updated = await mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts());
    expect(updated.matched).toBe("5");
    const row = await stored();
    expect(row).toMatchObject({ financial_ready: true, bet_money: 16.75, raw: { pmShares: 5 } });
    expect(control(row)).toEqual(control(seed.order));
    expect(hook).not.toHaveBeenCalled();
    expect(state.trace.filter(event => event.sql.includes("INSERT INTO orders"))).toHaveLength(1);
    expect(await listPmGtcByIds(OWNER, [EXECUTION])).toEqual([updated]);
  });
  it.each(["zero accepted", "unknown fee", "missing helper", "invalid helper"])("PG-05 preserves original non-promotion gate: %s", async (scenario) => {
    const seed = await seedControl(pool);
    const command = scenario === "zero accepted" ? { kind: "ack", state: "accepted", orderId: HASH } : facts();
    if (scenario === "unknown fee") { command.facts.fills[0].fee = null; delete command.financialOrder; }
    if (scenario === "missing helper")
      delete command.financialOrder;
    if (scenario === "invalid helper")
      command.financialOrder.betMoney += 1;
    const before = (await pool.query("SELECT record FROM pm_gtc_executions")).rows[0].record;
    if (scenario === "invalid helper") {
      await expect(mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, command)).rejects.toThrow("不一致");
      expect((await pool.query("SELECT record FROM pm_gtc_executions")).rows[0].record).toEqual(before);
    }
    else {
      await mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, command);
    }
    expect((await stored()).financial_ready).toBe(false);
    expect(state.trace.some(event => event.sql.includes("INSERT INTO orders"))).toBe(false);
  });
  it("PG-06 hides control financials once, retains BIGINT identity, and rejects hard delete/cascade", async () => {
    await pool.query("ALTER SEQUENCE orders_id_seq RESTART WITH 9007199254740993");
    const seed = await seedControl(pool, { ready: true });
    expect(seed.order.id).toBe("9007199254740993");
    expect(await orders.deleteOrdersByIds([seed.order.id, seed.order.id])).toBe(1);
    expect(await orders.deleteOrdersByIds([seed.order.id])).toBe(0);
    expect(control(await stored())).toEqual(control(seed.order));
    await expect(pool.query("DELETE FROM orders WHERE id=$1", [seed.order.id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("DELETE FROM profiles WHERE id=$1", [OWNER])).rejects.toMatchObject({ code: "23514" });
    expect((await pool.query("SELECT count(*)::int AS count FROM profiles")).rows[0].count).toBe(1);
  });
  it("PG-07 deleted financial ledger reinitializes only on a qualified mutation", async () => {
    const seed = await seedControl(pool, { ready: true, raw: { oldField: true, pmSellProceeds: 99, pmRealizedPnlUsdc: 9 } });
    await pool.query("UPDATE orders SET money=99,status='Win',changmen_bet=true WHERE id=$1", [seed.order.id]);
    expect(await orders.deleteOrdersByIds([seed.order.id])).toBe(1);
    await mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts());
    const row = await stored();
    expect(row).toMatchObject({ financial_ready: true, money: 0, status: "None", changmen_bet: false, raw: { pmStakeUsdc: 2.5 } });
    expect(row.raw).not.toHaveProperty("oldField");
    expect(row.raw).not.toHaveProperty("pmSellProceeds");
    expect(control(row)).toEqual(control(seed.order));
  });
  it("PG-08 promotion holds the row lock; a later delete hides the committed financial row", async () => {
    const seed = await seedControl(pool, { ready: true });
    const reached = gate(); const release = gate();
    let promotionPid;
    state.afterQuery = async (sql, value) => {
      if (sql.includes("INSERT INTO orders")) { promotionPid = value.processID; reached.resolve(); await release.promise; }
    };
    const promotion = track(mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts()));
    await reached.promise;
    const deletion = await client();
    const deleting = track(deletion.query(DELETE_FINANCIAL_ORDERS_SQL, [[seed.order.id]]));
    await blockedBy(deletion.processID, promotionPid);
    release.resolve();
    await promotion;
    expect((await deleting).rowCount).toBe(1);
    expect((await stored()).financial_ready).toBe(false);
    expect(control(await stored())).toEqual(control(seed.order));
  });
  it("PG-09 deletion holds the row lock; a later qualified promotion reopens financials after commit", async () => {
    const seed = await seedControl(pool, { ready: true, raw: { deletedLedger: true } });
    const deletion = await client();
    await deletion.query("BEGIN");
    await deletion.query(DELETE_FINANCIAL_ORDERS_SQL, [[seed.order.id]]);
    const reached = gate(); let promotionPid;
    state.beforeQuery = async (sql, value) => { if (sql.includes("INSERT INTO orders")) { promotionPid = value.processID; reached.resolve(); } };
    const promotion = track(mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts()));
    await reached.promise;
    await blockedBy(promotionPid, deletion.processID);
    await deletion.query("COMMIT");
    await promotion;
    expect((await stored()).financial_ready).toBe(true);
    expect((await stored()).raw).not.toHaveProperty("deletedLedger");
    expect(control(await stored())).toEqual(control(seed.order));
  });
  it("PG-10 simultaneous deletes count the financial row once and keep the control record", async () => {
    const seed = await seedControl(pool, { ready: true });
    const counts = await Promise.all([orders.deleteOrdersByIds([seed.order.id]), orders.deleteOrdersByIds([seed.order.id])]);
    expect(counts.sort()).toEqual([0, 1]);
    expect(control(await stored())).toEqual(control(seed.order));
  });
  it("PG-25 deletion cannot remove a pending financial row before its first promotion commits", async () => {
    const seed = await seedControl(pool);
    const reached = gate(); const release = gate();
    state.afterQuery = async (sql) => {
      if (sql.includes("INSERT INTO orders")) { reached.resolve(); await release.promise; }
    };
    const promotion = track(mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts()));
    await reached.promise;
    // 其他连接的 READ COMMITTED 快照仍看见 FALSE，不能删除尚未提交的财务资格。
    expect(await orders.deleteOrdersByIds([seed.order.id])).toBe(0);
    release.resolve(); await promotion;
    expect((await stored()).financial_ready).toBe(true);
    expect(control(await stored())).toEqual(control(seed.order));
  });
  it("PG-11 a lock timeout rolls back financial and old-source mutation without hook", async () => {
    const seed = await seedControl(pool);
    const blocker = await client(); await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [seed.order.id]);
    const reached = gate(); let pid;
    state.beforeQuery = async (sql, value) => { if (sql.includes("INSERT INTO orders")) { pid = value.processID; reached.resolve(); } };
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    const result = track(mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts()).catch(error => error));
    await reached.promise; await blockedBy(pid, blocker.processID);
    expect(await result).toMatchObject({ code: "55P03" });
    await blocker.query("ROLLBACK");
    expect(await stored()).toEqual(seed.order);
    expect((await pool.query("SELECT record FROM pm_gtc_executions")).rows[0].record).toEqual(seed.execution);
    expect(hook).not.toHaveBeenCalled();
  });
  it("PG-12 native GTC save locks the old control with UPDATE on first read", async () => {
    const seed = await seedControl(pool, { ready: true, raw: { pmGtcExecutionId: EXECUTION } });
    const blocker = await client(); await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM pm_gtc_executions WHERE id=$1 FOR UPDATE", [EXECUTION]);
    const reached = gate(); let pid;
    state.beforeQuery = async (sql, value) => {
      if (sql.startsWith("SELECT record")) { expect(sql).toContain("FOR UPDATE"); pid = value.processID; reached.resolve(); }
    };
    const saving = track(saveGtc(state.pool, [financialRow(HASH, { pmGtcExecutionId: EXECUTION })]));
    await reached.promise; await blockedBy(pid, blocker.processID);
    await blocker.query("COMMIT"); await saving;
    expect(control(await stored())).toEqual(control(seed.order));
  });
  it.each(["financial write", "old source update", "commit"])("PG-13 real server failure at %s rolls back both stores", async (point) => {
    const seed = await seedControl(pool);
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    await fault({ target: point === "old source update" ? "pm_gtc_executions" : "orders", operation: "UPDATE", deferred: point === "commit" });
    await expect(mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts())).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(seed.order);
    expect((await pool.query("SELECT record FROM pm_gtc_executions")).rows[0].record).toEqual(seed.execution);
    expect(hook).not.toHaveBeenCalled();
  });
  it.each(["0", "1"])("PG-14 first ordinary INSERT hook runs after commit with legacy row shape, mode %s", async (mode) => {
    vi.stubEnv("ORDERS_EXECUTION_COMPAT", mode);
    let observed;
    const hook = vi.fn((rows) => {
      expect(state.trace.at(-1).sql).toBe("COMMIT");
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0])).toHaveLength(16);
      expect(rows[0]).not.toHaveProperty("financial_ready");
      expect(rows[0]).not.toHaveProperty("execution_record");
      observed = pool.query("SELECT count(*)::int AS count FROM orders WHERE order_id='hook-first'");
    });
    orders.setOrdersInsertedHook(hook);
    expect(await orders.upsertOrders([financialRow("hook-first")])).toBe(true);
    expect((await observed).rows[0].count).toBe(1);
    expect(await orders.upsertOrders([financialRow("hook-first")])).toBe(true);
    expect(hook).toHaveBeenCalledOnce();
  });
  it("PG-15 concurrent first inserts produce one committed financial row and one hook", async () => {
    const reached = gate(); const release = gate(); let first = true; let firstPid;
    state.afterQuery = async (sql, value) => {
      if (sql.includes("INSERT INTO orders") && first) { first = false; firstPid = value.processID; reached.resolve(); await release.promise; }
    };
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    const one = track(orders.upsertOrders([financialRow("concurrent-first")]));
    await reached.promise;
    const waiting = gate(); let secondPid;
    state.beforeQuery = async (sql, value) => { if (sql.includes("INSERT INTO orders")) { secondPid = value.processID; waiting.resolve(); } };
    const two = track(orders.upsertOrders([financialRow("concurrent-first")]));
    await waiting.promise; await blockedBy(secondPid, firstPid);
    expect(hook).not.toHaveBeenCalled();
    release.resolve();
    expect(await Promise.all([one, two])).toEqual([true, true]);
    expect(hook).toHaveBeenCalledOnce();
    expect((await pool.query("SELECT count(*)::int AS count FROM orders")).rows[0].count).toBe(1);
  });
  it.each([false, true])("PG-16 ordinary INSERT failure deferred=%s has no committed row or hook", async (deferred) => {
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    await fault({ operation: "INSERT", deferred });
    expect(await orders.upsertOrders([financialRow("failed-first")])).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect((await pool.query("SELECT count(*)::int AS count FROM orders")).rows[0].count).toBe(0);
  });
  it("PG-17 hook exception stays isolated after a successful commit", async () => {
    orders.setOrdersInsertedHook(() => { throw new Error("notification fault"); });
    expect(await orders.upsertOrders([financialRow("isolated-hook")])).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS count FROM orders")).rows[0].count).toBe(1);
  });
  it("PG-20 FAILED evidence retains original zero-financial eligibility and cannot revive fills", async () => {
    const seed = await seedControl(pool);
    const filled = await mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts());
    const failed = facts();
    failed.facts.order.matched = "0"; failed.facts.order.status = "CANCELED";
    failed.facts.fills[0].status = "FAILED";
    failed.financialOrder = { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 };
    const updated = await mutatePmGtc(OWNER, EXECUTION, filled.revision, failed);
    expect((await stored()).raw.pmShares).toBe(0);
    expect((await stored()).bet_money).toBe(0);
    const replay = await mutatePmGtc(OWNER, EXECUTION, updated.revision, { ...facts(), financialOrder: undefined });
    expect(replay.fills["test-fill:maker"].status).toBe("FAILED");
    expect((await stored()).raw.pmShares).toBe(0);
    expect(control(await stored())).toEqual(control(seed.order));
  });
  it("PG-21 native multi-execution save sorts UPDATE locks and reverse batches do not deadlock", async () => {
    const one = await seedControl(pool, { ready: true, raw: { pmGtcExecutionId: EXECUTION } });
    const secondId = "00000000-0000-4000-8000-000000000012";
    const secondHash = `0x${"b".repeat(64)}`;
    const two = await seedControl(pool, { row: accepted(secondId, secondHash), ready: true, raw: { pmGtcExecutionId: secondId } });
    const a = financialRow(HASH, { pmGtcExecutionId: EXECUTION });
    const b = financialRow(secondHash, { pmGtcExecutionId: secondId });
    const sequences = new Map();
    state.beforeQuery = async (sql, value, params) => {
      if (sql.startsWith("SELECT record")) {
        expect(sql).toContain("FOR UPDATE");
        const sequence = sequences.get(value.processID) ?? [];
        sequence.push(params[0]); sequences.set(value.processID, sequence);
      }
    };
    await Promise.all([track(saveGtc(state.pool, [a, b])), track(saveGtc(state.pool, [b, a]))]);
    expect([...sequences.values()]).toEqual([[EXECUTION, secondId], [EXECUTION, secondId]]);
    const rows = (await pool.query("SELECT * FROM orders ORDER BY execution_id")).rows;
    expect(rows.map(control)).toEqual([control(one.order), control(two.order)]);
  });
  it("PG-22 failing financial deletion rolls back hiding and preserves its count semantics", async () => {
    const seed = await seedControl(pool, { ready: true });
    await fault();
    expect(await orders.deleteOrdersByIds([seed.order.id])).toBe(0);
    expect(await stored()).toEqual(seed.order);
  });
  it("PG-23 wrong execution identity fails promotion and rolls back the old source", async () => {
    const alien = accepted("00000000-0000-4000-8000-000000000012");
    const seed = await seedControl(pool, { row: alien });
    const original = accepted();
    await pool.query("INSERT INTO pm_gtc_executions(id,owner,wallet_key,record,updated_at) VALUES($1,$2,$3,$4,$5)", [original.id, original.owner, original.walletKey, original, original.createdAt]);
    await expect(mutatePmGtc(OWNER, EXECUTION, original.revision, facts())).rejects.toMatchObject({ code: "23502" });
    const storedAlien = (await pool.query("SELECT * FROM orders WHERE id=$1", [seed.order.id])).rows[0];
    expect(storedAlien).toEqual(seed.order);
    expect((await pool.query("SELECT record FROM pm_gtc_executions WHERE id=$1", [EXECUTION])).rows[0].record).toEqual(original);
  });
  it("PG-24 legacy case-duplicate targets fail cardinality checks without partial mutation", async () => {
    const seed = await seedControl(pool);
    await pool.query("INSERT INTO orders(user_id,player_id,order_id,create_at) VALUES($1,1,$2,1)", [OWNER, HASH.toUpperCase()]);
    await expect(mutatePmGtc(OWNER, EXECUTION, seed.execution.revision, facts())).rejects.toMatchObject({ code: "21000" });
    expect(await stored()).toEqual(seed.order);
    expect((await pool.query("SELECT record FROM pm_gtc_executions")).rows[0].record).toEqual(seed.execution);
  });
  it.each([
    "ALTER TABLE orders DISABLE TRIGGER orders_execution_delete_v1",
    "ALTER TABLE orders DROP CONSTRAINT orders_execution_record_v1",
    "DROP INDEX orders_execution_wallet_active_v1",
    "ALTER TABLE orders ALTER COLUMN financial_ready SET DEFAULT false",
  ])("PG-19 modified catalog cannot activate compatibility: %s", async (sql) => {
    const value = await client();
    await value.query("BEGIN");
    await value.query(sql);
    expect((await value.query("SELECT validate_orders_execution_schema_v1() AS valid")).rows[0].valid).toBe(false);
    await expect(prepareOrdersExecutionCompatibility(value)).rejects.toThrow("验证失败");
    await value.query("ROLLBACK");
    state.pool = facade();
    await prepareOrdersExecutionCompatibility(state.pool);
  });
  it("PG-18 rollback template refuses nonempty control, and only empty extension can roll back/reapply", async () => {
    const seed = await seedControl(pool);
    const value = await client();
    await expect(value.query(read("../phase2-rollback.sql"))).rejects.toThrow("rollback forbidden");
    await value.query("ROLLBACK");
    expect(control(await stored())).toEqual(control(seed.order));
    expect((await pool.query("SELECT validate_orders_execution_schema_v1() AS valid")).rows[0].valid).toBe(true);
    await pool.query(read("reset-fixtures.sql"));
    await pool.query(read("../phase2-rollback.sql"));
    expect((await pool.query("SELECT to_regclass('public.orders_financial') AS view")).rows[0].view).toBeNull();
    // 故意预占索引名，真实 DDL 末尾验证失败必须回滚全部新增结构。
    await pool.query("CREATE INDEX orders_execution_id_v1 ON orders(order_id)");
    await expect(value.query(read("../phase2-schema.sql"))).rejects.toThrow("validation failed");
    await value.query("ROLLBACK");
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_attribute WHERE attrelid='orders'::regclass AND attname='financial_ready' AND NOT attisdropped")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT to_regclass('public.orders_financial') AS view")).rows[0].view).toBeNull();
    await pool.query("DROP INDEX orders_execution_id_v1");
    await pool.query(read("../phase2-schema.sql"));
    expect((await pool.query("SELECT validate_orders_execution_schema_v1() AS valid")).rows[0].valid).toBe(true);
  });

  it("PG-26 real missing-order copier preserves the complete source, is restartable and fires no hook", async () => {
    const seed = await missingSource();
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    const before = (await pool.query('SELECT * FROM pm_gtc_executions')).rows;
    const receipt = await migrate(seed.operation);
    expect(receipt).toMatchObject({ action: 'insert-pending', financialReady: false, executionId: EXECUTION });
    const pending = await stored();
    expect(pending).toMatchObject({ financial_ready: false, odds: 0, bet_money: 0, money: 0,
      raw: {}, execution_record: seed.row, execution_updated_at: String(seed.row.createdAt) });
    expect((await pool.query('SELECT * FROM pm_gtc_executions')).rows).toEqual(before);
    expect(await listPmGtcByIds(OWNER, [EXECUTION])).toEqual([seed.row]);
    expect(await listPmGtc(OWNER)).toEqual([seed.row]);
    expect(await migrate(seed.operation)).toMatchObject({ action: 'noop', targetId: receipt.targetId });
    expect(await stored()).toEqual(pending);
    expect(hook).not.toHaveBeenCalled();
  });
  it("PG-27 all real financial readers, joins, statistics and pagination ignore the copied pending row", async () => {
    const seed = await missingSource();
    await orders.upsertOrders([financialRow('finance-a'), { ...financialRow('finance-b'), player_id: 2, provider: 'RAY', money: 2, status: 'Win' }]);
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const start = seed.row.createdAt - 86400000; const end = seed.row.createdAt + 86400000;
    const readers = [
      () => orders.fetchOrdersByDate(date, OWNER),
      () => orders.fetchOrdersByDatePage(date, OWNER, 1, 1),
      () => orders.fetchOrdersByPlayerStrict(1, OWNER),
      () => orders.fetchOrdersByPlayerAll(1, OWNER),
      () => orders.fetchOrdersByPlayerOrderIdsStrict(1, OWNER, [HASH, 'finance-a']),
      () => orders.fetchOrdersByLink(OWNER, 123),
      () => orders.fetchOrdersByLinks(OWNER, [123]),
      () => orders.fetchOrdersByUserOrderIds(OWNER, [HASH, 'finance-a']),
      () => orders.fetchPredictionSellsByBuyOrderIds(OWNER, [HASH]),
      () => orders.fetchOrderByOrderId(OWNER, HASH),
      () => orders.fetchOrdersAdminStats(date),
      () => orders.fetchOrdersAdminPage({ dateKey: date, userId: OWNER, pageIndex: 1, pageSize: 1 }),
      () => orders.fetchOrdersAdminAll({ dateKey: date }),
      () => orders.fetchUnifiedFootballOrdersAdmin({ dateKey: date }),
      () => orders.fetchOrdersForMonthAggregate(date.slice(0, 7), OWNER),
      () => orders.fetchOrdersForProfitAggregate(date),
      () => fetchOrdersByExecutionPage(date, OWNER, 'FOK', [], 1, 1),
      () => fetchOrdersByExecutionPage(date, OWNER, 'GTC', [{ player_id: 1, provider: 'Polymarket', order_id: HASH }], 1, 1),
      ...['fetchPlatformAnalytics', 'fetchArbPairAnalytics', 'fetchGameAnalytics', 'fetchHourlyAnalytics',
        'fetchValueBetOrderAnalytics', 'fetchAccountAnalytics', 'fetchPolymarketOrderAnalytics',
        'fetchPolymarketOrderStatsInRange', 'fetchPolymarketOrdersInRange', 'fetchArbOddsAnalytics'].map(name => () => orders[name](start, end)),
    ];
    const warnings = vi.spyOn(console, 'warn');
    const before = await Promise.all(readers.map(read => read()));
    await migrate(seed.operation);
    expect(await Promise.all(readers.map(read => read()))).toEqual(before);
    expect(warnings).not.toHaveBeenCalled(); warnings.mockRestore();
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(3);
    // Negative control: the actual disabled consumer DOES see the extra row.
    vi.stubEnv('ORDERS_EXECUTION_COMPAT', '0');
    expect((await orders.fetchOrdersByDatePage(date, OWNER, 1, 10)).total).toBe(3);
    expect((await orders.fetchOrdersAdminStats(date)).count).toBe(3);
  });
  it("PG-28 pending deletion is a no-op, ordinary deletion works, and promoted control remains recoverable", async () => {
    const seed = await missingSource(); const receipt = await migrate(seed.operation);
    const pending = await stored();
    await orders.upsertOrders([financialRow('ordinary-delete')]);
    const ordinary = (await pool.query("SELECT id FROM orders WHERE order_id='ordinary-delete'")).rows[0];
    expect(await orders.deleteOrdersByIds([receipt.targetId])).toBe(0);
    expect(await orders.deleteOrdersByIds([receipt.targetId, ordinary.id])).toBe(1);
    expect(await stored()).toEqual(pending);
    await expect(pool.query('DELETE FROM orders WHERE id=$1', [receipt.targetId])).rejects.toMatchObject({ code: '23514' });
    const updated = await mutatePmGtc(OWNER, EXECUTION, seed.row.revision, facts());
    expect(await orders.deleteOrdersByIds([receipt.targetId])).toBe(1);
    expect(await orders.deleteOrdersByIds([receipt.targetId])).toBe(0);
    expect(control(await stored())).toEqual(control(pending));
    expect(await listPmGtcByIds(OWNER, [EXECUTION])).toEqual([updated]);
  });
  it("PG-29 a genuine financial row arriving after the plan is attached without changing financials or repeating its hook", async () => {
    const seed = await missingSource(); const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    await orders.upsertOrders([{ ...financialRow(HASH.toUpperCase(), { historical: 'keep' }), money: 8, status: 'Win', changmen_bet: true }]);
    const before = (await pool.query('SELECT * FROM orders')).rows[0];
    expect(hook).toHaveBeenCalledOnce();
    const result = await migrate(seed.operation);
    expect(result).toMatchObject({ action: 'attach-arrived', targetId: before.id, financialReady: true });
    const after = await stored();
    const strip = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('execution_')));
    expect(strip(after)).toEqual(strip(before));
    expect(result.oldFieldsHash).toBe(jsonHash(strip(before)));
    expect(hook).toHaveBeenCalledOnce();
  });
  it("PG-30 copier holds the original execution lock; concurrent qualified financial mutation waits and promotes once", async () => {
    const seed = await missingSource(); const reached = gate(); const release = gate(); let copyPid; let mutationPid;
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    state.afterQuery = async (sql, value) => {
      if (sql.startsWith('INSERT INTO public.orders')) { copyPid = value.processID; reached.resolve(); await release.promise; }
    };
    const copying = track(migrate(seed.operation)); await reached.promise;
    const mutatingReached = gate();
    state.beforeQuery = async (sql, value) => { if (sql.includes('SELECT pg_advisory_xact_lock')) { mutationPid = value.processID; mutatingReached.resolve(); } };
    const mutation = track(mutatePmGtc(OWNER, EXECUTION, seed.row.revision, facts()));
    await mutatingReached.promise; await blockedBy(mutationPid, copyPid);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
    release.resolve(); const receipt = await copying; const updated = await mutation;
    expect(await stored()).toMatchObject({ id: receipt.targetId, financial_ready: true, bet_money: 16.75, raw: { pmShares: 5 } });
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(1);
    expect(await listPmGtcByIds(OWNER, [EXECUTION])).toEqual([updated]);
    expect((await stored()).execution_record).toEqual(seed.row);
    expect(hook).not.toHaveBeenCalled(); // Original GTC mutation has no ordinary inserted hook.
  });
  it("PG-31 qualified financial mutation wins first; copier exits busy and then refuses the stale source", async () => {
    const seed = await missingSource(); const reached = gate(); const release = gate();
    state.afterQuery = async sql => { if (sql.includes('INSERT INTO orders(')) { reached.resolve(); await release.promise; } };
    const mutation = track(mutatePmGtc(OWNER, EXECUTION, seed.row.revision, facts())); await reached.promise;
    await expect(migrate(seed.operation)).rejects.toMatchObject({ code: 'EXECUTION_BUSY' });
    release.resolve(); await mutation;
    const before = (await pool.query('SELECT * FROM orders')).rows;
    await expect(migrate(seed.operation)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect((await pool.query('SELECT * FROM orders')).rows).toEqual(before);
  });
  it("PG-32 in-flight ordinary financial INSERT makes the gap lock fail immediately; retry attaches after its commit", async () => {
    const seed = await missingSource(); const reached = gate(); const release = gate();
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    state.afterQuery = async sql => { if (sql.includes('INSERT INTO orders (')) { reached.resolve(); await release.promise; } };
    const saving = track(orders.upsertOrders([financialRow(HASH.toUpperCase())])); await reached.promise;
    await expect(migrate(seed.operation)).rejects.toMatchObject({ code: '55P03' });
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
    release.resolve(); expect(await saving).toBe(true);
    expect(await migrate(seed.operation)).toMatchObject({ action: 'attach-arrived', financialReady: true });
    expect(hook).toHaveBeenCalledOnce();
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(1);
  });
  it.each([HASH, HASH.toUpperCase()])("PG-33 ordinary writer starting during pending insertion cannot create a case variant or prematurely notify: %s", async hash => {
    const seed = await missingSource(); const reached = gate(); const release = gate(); let copyPid; let savePid;
    const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    state.afterQuery = async (sql, value) => { if (sql.startsWith('INSERT INTO public.orders')) { copyPid = value.processID; reached.resolve(); await release.promise; } };
    const copying = track(migrate(seed.operation)); await reached.promise;
    const savingReached = gate();
    state.beforeQuery = async (sql, value) => { if (sql.includes('INSERT INTO orders (')) { savePid = value.processID; savingReached.resolve(); } };
    const saving = track(orders.upsertOrders([financialRow(hash)])); await savingReached.promise;
    await blockedBy(savePid, copyPid); release.resolve(); await copying;
    expect(await saving).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(1);
    expect((await stored()).financial_ready).toBe(false); expect(hook).not.toHaveBeenCalled();
  });
  it.each(['INSERT', 'COMMIT'])("PG-34 real server failure at pending %s leaves no shadow, source change or hook", async point => {
    const seed = await missingSource(); const hook = vi.fn(); orders.setOrdersInsertedHook(hook);
    const source = (await pool.query('SELECT * FROM pm_gtc_executions')).rows;
    await fault({ operation: 'INSERT', deferred: point === 'COMMIT' });
    await expect(migrate(seed.operation)).rejects.toMatchObject({ code: '23514' });
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT * FROM pm_gtc_executions')).rows).toEqual(source);
    expect(hook).not.toHaveBeenCalled();
  });
  it.each(['advisory', 'source row', 'orders write'])("PG-35 busy %s refuses migration without waiting or partial copy", async kind => {
    const seed = await missingSource(); const blocker = await client(); await blocker.query('BEGIN');
    if (kind === 'advisory') await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [EXECUTION]);
    if (kind === 'source row') await blocker.query('SELECT id FROM pm_gtc_executions WHERE id=$1 FOR UPDATE', [EXECUTION]);
    if (kind === 'orders write') await blocker.query('LOCK TABLE orders IN ROW EXCLUSIVE MODE');
    const started = Date.now();
    await expect(migrate(seed.operation)).rejects.toMatchObject({ code: kind === 'advisory' ? 'EXECUTION_BUSY' : '55P03' });
    expect(Date.now() - started).toBeLessThan(1500);
    await blocker.query('ROLLBACK');
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
    expect((await migrate(seed.operation)).action).toBe('insert-pending');
  });
  it.each(['source drift', 'payload drift', 'duplicate original', 'occupied control', 'missing owner', 'duplicate source'])("PG-36 negative pending copy rejects %s and leaves all rows unchanged", async kind => {
    const seed = await missingSource(); const operation = structuredClone(seed.operation);
    if (kind === 'source drift') await pool.query('UPDATE pm_gtc_executions SET updated_at=updated_at+1');
    if (kind === 'payload drift') operation.row.bet_money = 999;
    if (kind === 'duplicate original') await orders.upsertOrders([financialRow(HASH), financialRow(HASH.toUpperCase())]);
    if (kind === 'occupied control') { await migrate(operation); await pool.query("UPDATE orders SET execution_record=jsonb_set(execution_record,'{revision}',to_jsonb((execution_record->>'revision')::int+1))"); }
    if (kind === 'missing owner') await pool.query('DELETE FROM profiles WHERE id=$1', [OWNER]);
    if (kind === 'duplicate source') { const other = accepted('00000000-0000-4000-8000-000000000012'); await pool.query('INSERT INTO pm_gtc_executions(id,owner,wallet_key,record,updated_at) VALUES($1,$2,$3,$4,$5)', [other.id, other.owner, other.walletKey, other, other.createdAt]); }
    const before = { orders: (await pool.query('SELECT * FROM orders ORDER BY id')).rows, sources: (await pool.query('SELECT * FROM pm_gtc_executions ORDER BY id')).rows };
    const codes = { 'source drift': 'SOURCE_CHANGED', 'payload drift': 'PENDING_PAYLOAD_CHANGED',
      'duplicate original': 'AMBIGUOUS_CASE_FOLDED_ORIGINAL', 'occupied control': 'TARGET_CONTROL_CHANGED',
      'missing owner': 'INVALID_SOURCE', 'duplicate source': 'MULTIPLE_EXECUTIONS_FOR_ORIGINAL' };
    await expect(migrate(operation)).rejects.toMatchObject({ code: codes[kind] });
    expect({ orders: (await pool.query('SELECT * FROM orders ORDER BY id')).rows, sources: (await pool.query('SELECT * FROM pm_gtc_executions ORDER BY id')).rows }).toEqual(before);
  });
  it("PG-37 missing consumer or schema compatibility refuses pending insertion", async () => {
    const seed = await missingSource();
    await expect(migrate(seed.operation, {})).rejects.toMatchObject({ code: 'CONSUMERS_NOT_COMPATIBLE' });
    await pool.query('ALTER TABLE orders DISABLE TRIGGER orders_execution_delete_v1');
    try { await expect(migrate(seed.operation)).rejects.toMatchObject({ code: 'SCHEMA_NOT_COMPATIBLE' }); }
    finally { await pool.query('ALTER TABLE orders ENABLE TRIGGER orders_execution_delete_v1'); }
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
  });
  it("PG-38 copied pending row preserves ordinary first-hook commit timing, rollback and synchronous exception isolation", async () => {
    const seed = await missingSource(); await migrate(seed.operation);
    let observed; const hook = vi.fn(rows => {
      expect(state.trace.at(-1).sql).toBe('COMMIT');
      expect(Object.keys(rows[0])).toHaveLength(16);
      observed = pool.query('SELECT order_id FROM orders_financial');
      throw new Error('isolated synchronous notification failure');
    });
    orders.setOrdersInsertedHook(hook);
    expect(await orders.upsertOrders([financialRow('first-with-pending')])).toBe(true);
    expect((await observed).rows.map(row => row.order_id)).toEqual(['first-with-pending']);
    expect(await orders.upsertOrders([financialRow('first-with-pending')])).toBe(true);
    expect(hook).toHaveBeenCalledOnce();
    await fault({ operation: 'INSERT', deferred: true });
    expect(await orders.upsertOrders([financialRow('failed-first-with-pending')])).toBe(false);
    expect(hook).toHaveBeenCalledOnce();
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(2);
  });
  it("PG-39 isolated batch CLI commits only its fixed pending scope and can safely replay the original manifest", async () => {
    await missingSource();
    const second = await missingSource(accepted('00000000-0000-4000-8000-000000000012', `0x${'b'.repeat(64)}`));
    const first = runLocalBackfill(second.snapshot, 'pending-cli-first');
    expect(first.result.status, first.result.stderr).toBe(0);
    expect(first.report).toMatchObject({ completed: true, databaseConnected: true, productionDatabaseConnected: false });
    expect(first.report.receipts.map(receipt => receipt.action)).toEqual(['insert-pending', 'insert-pending']);
    expect(first.journal.filter(event => event.event === 'committed')).toHaveLength(2);
    const rows = (await pool.query('SELECT * FROM orders ORDER BY id')).rows;
    const replay = runLocalBackfill(second.snapshot, 'pending-cli-replay');
    expect(replay.result.status, replay.result.stderr).toBe(0);
    expect(replay.report.receipts.map(receipt => receipt.action)).toEqual(['noop', 'noop']);
    expect((await pool.query('SELECT * FROM orders ORDER BY id')).rows).toEqual(rows);
  });
  it("PG-40 failed batch retains its committed receipt, rolls back the failing row and resumes without duplicates", async () => {
    await missingSource();
    const secondHash = `0x${'b'.repeat(64)}`;
    const second = await missingSource(accepted('00000000-0000-4000-8000-000000000012', secondHash));
    await pool.query(`CREATE FUNCTION phase2_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.order_id='${secondHash}' THEN RAISE EXCEPTION 'isolated second-row failure' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER phase2_test_fault BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION phase2_test_fault()`);
    const failed = runLocalBackfill(second.snapshot, 'pending-cli-failed');
    expect(failed.result.status).toBe(1);
    expect(failed.report).toMatchObject({ completed: false, failureCode: '23514', failedExecutionId: second.row.id });
    expect(failed.report.receipts).toHaveLength(1);
    expect(failed.journal.filter(event => event.event === 'committed')).toHaveLength(1);
    expect(failed.journal.at(-1)).toMatchObject({ event: 'stopped', code: '23514' });
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(1);
    await pool.query('DROP TRIGGER phase2_test_fault ON orders; DROP FUNCTION phase2_test_fault()');
    const resumed = runLocalBackfill(second.snapshot, 'pending-cli-resumed');
    expect(resumed.result.status, resumed.result.stderr).toBe(0);
    expect(resumed.report.receipts.map(receipt => receipt.action)).toEqual(['noop', 'insert-pending']);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(2);
    expect((await pool.query('SELECT * FROM pm_gtc_executions ORDER BY id')).rows).toEqual(second.snapshot.executions);
  });
});
