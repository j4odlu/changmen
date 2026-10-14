#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * River PM：删除 player_id=45 上与 player_id=47 重复的订单副本。
 * Usage:
 *   node scripts/cleanup-river-pm-player45-dupes.mjs --dry-run
 *   node scripts/cleanup-river-pm-player45-dupes.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = process.argv.includes("--dry-run");
const RIVER_USER = "River";
const KEEP_PLAYER = 47;
const DROP_PLAYER = 45;
const PROVIDER = "Polymarket";
const BACKUP_TABLE = "orders_dup_backup_river_pm45_20260712";

loadChangmenEnv();
const { initDatabaseUrl, getPgPool } = await import("@changmen/db");
await initDatabaseUrl();
const pool = getPgPool();

if (!pool) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

const { rows: users } = await pool.query(
  `SELECT id, user_name FROM users WHERE user_name ILIKE $1 LIMIT 1`,
  [RIVER_USER],
);
const userId = users[0]?.id;
if (!userId) {
  console.error(`用户 ${RIVER_USER} 不存在`);
  process.exit(1);
}

const preview = await pool.query(
  `SELECT o.id, o.order_id, o.player_id, o.status, o.bet_money, o.money, o.create_at,
          to_char(to_timestamp(o.create_at / 1000.0), 'YYYY-MM-DD HH24:MI:SS') AS create_at_local
   FROM ${financialOrdersRelation("o")}
   WHERE o.user_id = $1::uuid
     AND o.player_id = $2
     AND o.provider = $3
     AND EXISTS (
       SELECT 1 FROM ${financialOrdersRelation("k")}
       WHERE k.user_id = o.user_id
         AND k.player_id = $4
         AND k.order_id = o.order_id
     )
   ORDER BY o.create_at DESC, o.order_id`,
  [userId, DROP_PLAYER, PROVIDER, KEEP_PLAYER],
);

const orphan45 = await pool.query(
  `SELECT COUNT(*)::int AS n
   FROM ${financialOrdersRelation("o")}
   WHERE o.user_id = $1::uuid
     AND o.player_id = $2
     AND o.provider = $3
     AND NOT EXISTS (
       SELECT 1 FROM ${financialOrdersRelation("k")}
       WHERE k.user_id = o.user_id
         AND k.player_id = $4
         AND k.order_id = o.order_id
     )`,
  [userId, DROP_PLAYER, PROVIDER, KEEP_PLAYER],
);

console.log(`user=${users[0].user_name} (${userId})`);
console.log(`will delete ${preview.rows.length} duplicate rows (player ${DROP_PLAYER}, keep ${KEEP_PLAYER})`);
console.log(`player ${DROP_PLAYER} PM orders without player ${KEEP_PLAYER} counterpart: ${orphan45.rows[0].n}`);

for (const row of preview.rows.slice(0, 15))
  console.log(`  id=${row.id} order_id=${row.order_id} status=${row.status} at=${row.create_at_local}`);
if (preview.rows.length > 15)
  console.log(`  ... and ${preview.rows.length - 15} more`);

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

const ids = preview.rows.map(r => Number(r.id)).filter(n => Number.isFinite(n) && n > 0);
const client = await pool.connect();

try {
  await client.query("BEGIN");

  await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  const backup = await client.query(
    `CREATE TABLE ${BACKUP_TABLE} AS
     SELECT * FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
    [ids],
  );

  const del = await client.query(
    `DELETE FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
    [ids],
  );

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
