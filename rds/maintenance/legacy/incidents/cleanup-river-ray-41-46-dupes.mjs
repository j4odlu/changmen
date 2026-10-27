#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * River：删除软删 player 41 上与活跃 player 46 重复的 RAY 订单（5 组）。
 *
 *   node scripts/cleanup-river-ray-41-46-dupes.mjs --dry-run
 *   node scripts/cleanup-river-ray-41-46-dupes.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";

const dryRun = !process.argv.includes("--execute");
const USER_NAME = "River";
const FROM_PLAYER = 41;
const KEEP_PLAYER = 46;
const PROVIDER = "RAY";
const BACKUP_TABLE = "orders_dup_backup_river_ray41_46_20260712";

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
  [USER_NAME],
);
const userId = users[0]?.id;
if (!userId) {
  console.error(`用户 ${USER_NAME} 不存在`);
  process.exit(1);
}

const { rows: keepPlayer } = await pool.query(
  `SELECT id, deleted_at FROM players WHERE id = $1 AND owner_user_id = $2::uuid`,
  [KEEP_PLAYER, userId],
);
if (!keepPlayer.length || keepPlayer[0].deleted_at) {
  console.error(`player ${KEEP_PLAYER} 不可用`);
  process.exit(1);
}

const { rows: fromPlayer } = await pool.query(
  `SELECT id, deleted_at FROM players WHERE id = $1 AND owner_user_id = $2::uuid`,
  [FROM_PLAYER, userId],
);
if (!fromPlayer.length || !fromPlayer[0].deleted_at) {
  console.error(`player ${FROM_PLAYER} 非软删或不存在`);
  process.exit(1);
}

const toDelete = await pool.query(
  `SELECT o.id, o.order_id, o.player_id, o.link, o.match, o.bet_money
   FROM ${financialOrdersRelation("o")}
   WHERE o.user_id = $1::uuid
     AND o.provider = $2
     AND o.player_id = $3
     AND EXISTS (
       SELECT 1 FROM ${financialOrdersRelation("k")}
       JOIN players pk ON pk.id = k.player_id
       WHERE k.user_id = o.user_id
         AND k.order_id = o.order_id
         AND k.provider = o.provider
         AND k.player_id = $4
         AND pk.deleted_at IS NULL
     )
   ORDER BY o.order_id`,
  [userId, PROVIDER, FROM_PLAYER, KEEP_PLAYER],
);

console.log(`user=${users[0].user_name} mode=${dryRun ? "dry-run" : "execute"}`);
console.log(`delete ${toDelete.rows.length} rows on soft player ${FROM_PLAYER}, keep active ${KEEP_PLAYER}`);
for (const r of toDelete.rows) {
  console.log(`  id=${r.id} order=${r.order_id} link=${r.link ?? "-"} match=${r.match?.slice(0, 40) ?? "-"}`);
}

if (toDelete.rows.length !== 5) {
  console.warn(`warn: expected 5 rows, found ${toDelete.rows.length}`);
}

if (dryRun) {
  console.log("\n[dry-run] 无变更");
  console.log("执行: node scripts/cleanup-river-ray-41-46-dupes.mjs --execute");
  await pool.end();
  process.exit(0);
}

const deleteIds = toDelete.rows.map(r => Number(r.id));
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
