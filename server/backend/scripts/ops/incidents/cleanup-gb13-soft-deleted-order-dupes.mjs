#!/usr/bin/env node
import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * GB13：删除已软删 player 上与活跃 player 重复的订单（同 user_id + provider + order_id）。
 *
 * Usage:
 *   node scripts/cleanup-gb13-soft-deleted-order-dupes.mjs --dry-run
 *   node scripts/cleanup-gb13-soft-deleted-order-dupes.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = process.argv.includes("--dry-run");
const USER_NAME = "GB13";
const BACKUP_TABLE = "orders_dup_backup_gb13_soft_deleted_20260712";

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

const preview = await pool.query(
  `SELECT o.id, o.order_id, o.provider, o.player_id, o.link, o.status, o.bet_money, o.match,
          pl.platform_name, pl.player_name,
          to_char(to_timestamp(o.create_at / 1000.0), 'YYYY-MM-DD HH24:MI:SS') AS create_at_local
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid
     AND pl.owner_user_id = $1::uuid
     AND pl.deleted_at IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM ${financialOrdersRelation("k")}
       JOIN players pk ON pk.id = k.player_id
       WHERE k.user_id = o.user_id
         AND k.order_id = o.order_id
         AND k.provider = o.provider
         AND pk.owner_user_id = $1::uuid
         AND pk.deleted_at IS NULL
     )
   ORDER BY o.provider, o.order_id, o.player_id`,
  [userId],
);

const byPlayer = await pool.query(
  `SELECT o.player_id, pl.platform_name, pl.player_name, COUNT(*)::int AS n
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid
     AND pl.owner_user_id = $1::uuid
     AND pl.deleted_at IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM ${financialOrdersRelation("k")}
       JOIN players pk ON pk.id = k.player_id
       WHERE k.user_id = o.user_id
         AND k.order_id = o.order_id
         AND k.provider = o.provider
         AND pk.owner_user_id = $1::uuid
         AND pk.deleted_at IS NULL
     )
   GROUP BY o.player_id, pl.platform_name, pl.player_name
   ORDER BY n DESC, o.player_id`,
  [userId],
);

console.log(`user=${users[0].user_name} (${userId})`);
console.log(`will delete ${preview.rows.length} rows on soft-deleted players (dup with active)`);
console.log("\n按废弃 player:");
for (const r of byPlayer.rows) {
  console.log(`  player ${r.player_id} ${r.platform_name}/${r.player_name}: ${r.n} 行`);
}

for (const row of preview.rows) {
  console.log(
    `  id=${row.id} player=${row.player_id}(${row.platform_name}/${row.player_name}) ${row.provider} order_id=${row.order_id} link=${row.link ?? "-"} status=${row.status}`,
  );
}

if (!preview.rows.length) {
  console.log("nothing to delete");
  await pool.end();
  process.exit(0);
}

if (dryRun) {
  console.log("[dry-run] no changes");
  await pool.end();
  process.exit(0);
}

const ids = preview.rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  const backup = await client.query(
    `CREATE TABLE ${BACKUP_TABLE} AS SELECT * FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  const del = await client.query(`DELETE FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`, [ids]);
  await client.query("COMMIT");
  console.log(`backup table: ${BACKUP_TABLE} (${backup.rowCount ?? ids.length} rows)`);
  console.log(`deleted ${del.rowCount ?? 0} rows`);
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
