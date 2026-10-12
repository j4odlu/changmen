#!/usr/bin/env node
import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * GB13 OB 重复：场馆 506 时用主账号规则删副本（仅重复 order_id 组）。
 * - 79(5-OD) > 83(OD-好博)
 * - 111(星空) > 119(星空-好博)
 *
 *   node scripts/cleanup-gb13-ob-dupes-by-primary.mjs --dry-run
 *   node scripts/cleanup-gb13-ob-dupes-by-primary.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = !process.argv.includes("--execute");
const USER_NAME = "GB13";
const BACKUP_TABLE = "orders_dup_backup_gb13_ob_primary_20260712";

/** order_id -> keep player_id */
const KEEP_OWNER = new Map([
  ["1735298294147299082", 79],
  ["1791314984364202907", 111],
  ["1792532397322475707", 111],
]);

loadChangmenEnv();
const { initDatabaseUrl, getPgPool } = await import("@changmen/db");
await initDatabaseUrl();
const pool = getPgPool();
if (process.env.ORDERS_EXECUTION_COMPAT === "1") await prepareOrdersExecutionCompatibility(pool);
if (!pool) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

const { rows: users } = await pool.query(
  `SELECT id, user_name FROM users WHERE user_name ILIKE $1 LIMIT 1`,
  [USER_NAME],
);
const userId = users[0]?.id;
if (!userId) {
  console.error(`用户 ${USER_NAME} 不存在`);
  process.exit(1);
}

const orderIds = [...KEEP_OWNER.keys()];
const { rows: dupRows } = await pool.query(
  `SELECT o.id, o.order_id, o.player_id, pl.platform_name, pl.player_name
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid AND o.provider = 'OB' AND o.order_id = ANY($2::text[])
   ORDER BY o.order_id, o.player_id`,
  [userId, orderIds],
);

const byOrder = new Map();
for (const r of dupRows) {
  const list = byOrder.get(r.order_id) ?? [];
  list.push(r);
  byOrder.set(r.order_id, list);
}

const toDelete = [];
for (const [orderId, keepPid] of KEEP_OWNER) {
  const rows = byOrder.get(orderId) ?? [];
  if (rows.length < 2) {
    console.error(`order_id=${orderId} 非重复组(rows=${rows.length})，中止`);
    process.exit(1);
  }
  const keep = rows.find(r => Number(r.player_id) === keepPid);
  if (!keep) {
    console.error(`order_id=${orderId} 无 keep player ${keepPid}`);
    process.exit(1);
  }
  for (const r of rows) {
    if (Number(r.player_id) !== keepPid) {
      toDelete.push({
        id: Number(r.id),
        order_id: orderId,
        player_id: Number(r.player_id),
        label: `${r.platform_name}/${r.player_name}`,
        keep: keepPid,
      });
    }
  }
}

console.log(`user=${users[0].user_name} mode=${dryRun ? "dry-run" : "execute"}`);
console.log(`删除 ${toDelete.length} 条（仅重复组副本）`);
for (const d of toDelete) {
  console.log(`  DELETE id=${d.id} player=${d.player_id}(${d.label}) order=${d.order_id} keep=${d.keep}`);
}

const nonDup = await pool.query(
  `SELECT COUNT(*)::int AS n
     FROM ${financialOrdersRelation("o")}
     WHERE o.user_id = $1::uuid AND o.provider = 'OB'
       AND (o.user_id, o.provider, o.order_id) NOT IN (
         SELECT user_id, provider, order_id FROM ${financialOrdersRelation()}
         WHERE user_id = $1::uuid AND provider = 'OB'
         GROUP BY user_id, provider, order_id HAVING COUNT(*) > 1
       )`,
  [userId],
);
console.log(`非重复 OB 订单: ${nonDup.rows[0].n} 条（不删）`);

if (dryRun) {
  console.log("\n[dry-run] 无变更");
  console.log("执行: node scripts/cleanup-gb13-ob-dupes-by-primary.mjs --execute");
  await pool.end();
  process.exit(0);
}

const deleteIds = toDelete.map(d => d.id);
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  await client.query(
    `CREATE TABLE ${BACKUP_TABLE} AS SELECT * FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
    [deleteIds],
  );
  const del = await client.query(`DELETE FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`, [deleteIds]);
  await client.query("COMMIT");
  console.log(`\n已删 ${del.rowCount ?? 0} 条，备份 ${BACKUP_TABLE}`);
}
catch (err) {
  await client.query("ROLLBACK");
  console.error("rollback:", err.message);
  process.exit(1);
}
finally {
  client.release();
  await pool.end();
}
