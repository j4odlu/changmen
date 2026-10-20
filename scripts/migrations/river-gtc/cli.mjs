// [changmen 扩展] 显式 RIVER 计划/应用入口；默认只读，输出不包含账号凭证。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { getResolvedDatabaseUrl, buildPgClientConfig } from "../../../rds/resolve_database_url.js";
import { planResultCopies, applyResultCopyBatch, digest } from "./result-copies.mjs";
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(env|out|apply|confirm)=(.+)$/.exec(arg); assert(match, "explicit --env/--out/--apply/--confirm options only"); return [match[1], match[2]];
}));
assert(args.env && args.out, "explicit environment path and new output path required");
assert.equal(Boolean(args.apply), Boolean(args.confirm), "apply requires the reviewed plan digest");
const output = path.resolve(args.out); assert(!fs.existsSync(output), "new output directory required");
fs.mkdirSync(output, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600, flush: true });
dotenv.config({ path: path.resolve(args.env), quiet: true });
const url = getResolvedDatabaseUrl(); assert(url, "configured database required");
const client = new pg.Client({ ...buildPgClientConfig(url, 10000), application_name: "changmen-river-gtc-result-copy-migration", statement_timeout: 15000, query_timeout: 20000 });
try {
  await client.connect();
  const identity = (await client.query("SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS address,inet_server_port() AS port")).rows[0];
  const configured = new URL(url);
  assert.equal(identity?.database, decodeURIComponent(configured.pathname.slice(1)), "connected database identity");
  assert.equal(identity?.role, decodeURIComponent(configured.username), "connected database role");
  // 本地 PG 网关到数据库的连接可使用 Unix socket，此时 inet_server_* 为空；同时固定配置入口及真实库/角色。
  const target = { ...identity, transportHost: configured.hostname, transportPort: Number(configured.port || 5432) };
  const users = (await client.query("SELECT id FROM public.users WHERE lower(user_name)='river' ORDER BY id")).rows;
  assert.equal(users.length, 1, "unique RIVER identity required");
  const owner = users[0].id;
  if (!args.apply) {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const executions = (await client.query("SELECT * FROM public.pm_gtc_executions WHERE owner=$1 ORDER BY id", [owner])).rows;
      const orders = (await client.query("SELECT * FROM public.orders WHERE user_id=$1 AND raw->>'pmGtcExecutionId' IS NOT NULL ORDER BY id", [owner])).rows;
      const body = { version: 1, target, ...planResultCopies(owner, executions, orders), executionHashes: executions.map(row => ({ id: row.id, hash: digest(row) })) };
      const plan = { ...body, digest: digest(body) }; write("plan.json", plan);
      console.log(JSON.stringify({ mode: "read-only-plan", checkedExecutions: plan.checkedExecutions, checkedOrders: plan.checkedOrders, updates: plan.operations.length, unchanged: plan.unchanged.length, digest: plan.digest, output }));
    } finally { await client.query("ROLLBACK"); }
  } else {
    const plan = JSON.parse(fs.readFileSync(args.apply, "utf8")), { digest: expected, ...body } = plan;
    assert.equal(digest(body), expected, "plan bytes changed"); assert.equal(args.confirm, expected, "explicit plan digest mismatch");
    assert.equal(plan.version, 1); assert.equal(plan.owner, owner); assert.deepEqual(plan.target, target, "database target changed");
    write("reviewed-plan.json", plan);
    for (let offset = 0; offset < plan.operations.length; offset += 25) {
      const batch = { owner, operations: plan.operations.slice(offset, offset + 25) }, number = offset / 25;
      const receipt = await applyResultCopyBatch(client, batch, async value => write(`batch-${number}.prepared.json`, { ...value, digest: digest(value) }));
      write(`batch-${number}.committed.json`, { digest: digest(receipt), updated: receipt.operations.length });
    }
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const executions = (await client.query("SELECT * FROM public.pm_gtc_executions WHERE owner=$1 ORDER BY id", [owner])).rows;
      const orders = (await client.query("SELECT * FROM public.orders WHERE user_id=$1 AND raw->>'pmGtcExecutionId' IS NOT NULL ORDER BY id", [owner])).rows;
      assert.deepEqual(executions.map(row => ({ id: row.id, hash: digest(row) })), plan.executionHashes, "all execution records remain unchanged");
      const verified = planResultCopies(owner, executions, orders); assert.equal(verified.operations.length, 0, "all eligible copies migrated");
      for (const op of plan.operations) {
        const after = structuredClone(orders.find(row => row.id === op.id)); assert(after); delete after.raw.pmGtcOrderSnapshot;
        assert.equal(digest(after), op.beforeHash, "all original order fields remain unchanged");
      }
      const result = { checkedExecutions: verified.checkedExecutions, checkedOrders: verified.checkedOrders, updated: plan.operations.length, eligibleCopiesRemaining: 0, executionRecordsUnchanged: true, financialFieldsUnchanged: true, tablesPreserved: true };
      write("verified.json", result); console.log(JSON.stringify({ mode: "applied-and-verified", ...result, output }));
    } finally { await client.query("ROLLBACK"); }
  }
} catch (error) {
  // COMMIT 结果不确定时先按 prepared receipt 核对，不自动重复写入。
  console.error(JSON.stringify({ failed: true, code: error.code ?? "MIGRATION_FAILED", commitOutcomeRequiresReconciliation: Boolean(error.commitOutcomeRequiresReconciliation), output }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
