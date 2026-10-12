#!/usr/bin/env node
import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * GB13：order_id=1721979623053562828
 * - 删除误挂在 RAY 86 / PB 87 上的 OB 副本
 * - 从备份恢复 1 行到活跃 OB player 111（星空 / luzihao1）
 *
 * Usage:
 *   node scripts/restore-gb13-ob-order-111.mjs --dry-run
 *   node scripts/restore-gb13-ob-order-111.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = process.argv.includes("--dry-run");
const USER_NAME = "GB13";
const ORDER_ID = "1721979623053562828";
const DROP_PLAYERS = [86, 87];
const TO_PLAYER = 111;
const BACKUP_SOURCE_TABLE = "orders_dup_backup_gb13_soft_deleted_20260712";
const BACKUP_FROM_PLAYER = 80;
const BACKUP_TABLE = "orders_restore_backup_gb13_ob111_20260712";

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

const { rows: targetPlayer } = await pool.query(
  `SELECT id, platform_name, player_name, deleted_at FROM players
   WHERE id = $1 AND owner_user_id = $2::uuid`,
  [TO_PLAYER, userId],
);
if (!targetPlayer.length || targetPlayer[0].deleted_at) {
  console.error(`player ${TO_PLAYER} 不可用`);
  process.exit(1);
}

const toDelete = await pool.query(
  `SELECT id, player_id, provider, link, bet_money, match FROM ${financialOrdersRelation()}
   WHERE user_id = $1::uuid AND order_id = $2 AND player_id = ANY($3::bigint[])
   ORDER BY player_id`,
  [userId, ORDER_ID, DROP_PLAYERS],
);

const existing111 = await pool.query(
  `SELECT id FROM ${financialOrdersRelation()} WHERE user_id = $1::uuid AND order_id = $2 AND player_id = $3`,
  [userId, ORDER_ID, TO_PLAYER],
);

const source = await pool.query(
  `SELECT * FROM ${BACKUP_SOURCE_TABLE}
   WHERE order_id = $1 AND player_id = $2
   LIMIT 1`,
  [ORDER_ID, BACKUP_FROM_PLAYER],
);

console.log(`user=${users[0].user_name} (${userId})`);
console.log(`order_id=${ORDER_ID} -> player ${TO_PLAYER} (${targetPlayer[0].platform_name}/${targetPlayer[0].player_name})`);
console.log(`delete ${toDelete.rows.length} rows on players ${DROP_PLAYERS.join(",")}`);
for (const r of toDelete.rows) {
  console.log(`  del id=${r.id} player=${r.player_id} ${r.provider} link=${r.link ?? "-"} match=${r.match ?? "-"}`);
}

if (existing111.rows.length) {
  console.error(`player ${TO_PLAYER} 已有 order_id=${ORDER_ID}，中止`);
  process.exit(1);
}

if (!source.rows.length) {
  console.error(`备份表 ${BACKUP_SOURCE_TABLE} 无 player ${BACKUP_FROM_PLAYER} 行`);
  process.exit(1);
}

const src = source.rows[0];
console.log(`restore from backup player ${BACKUP_FROM_PLAYER}: link=${src.link ?? "-"} bet_money=${src.bet_money} status=${src.status}`);

if (toDelete.rows.length !== DROP_PLAYERS.length) {
  console.warn(`warn: expected ${DROP_PLAYERS.length} delete rows, found ${toDelete.rows.length}`);
}

if (dryRun) {
  console.log("[dry-run] no changes");
  await pool.end();
  process.exit(0);
}

const deleteIds = toDelete.rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
const client = await pool.connect();

try {
  await client.query("BEGIN");

  await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  if (deleteIds.length) {
    await client.query(
      `CREATE TABLE ${BACKUP_TABLE} AS SELECT * FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
      [deleteIds],
    );
  }

  if (deleteIds.length) {
    await client.query(`DELETE FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`, [deleteIds]);
  }

  const ins = await client.query(
    `INSERT INTO orders (
       user_id, player_id, order_id, link, provider, match, bet, item,
       odds, bet_money, money, status, create_at, raw
     )
     SELECT
       user_id, $1::bigint, order_id, link, provider, match, bet, item,
       odds, bet_money, money, status, create_at, raw
     FROM ${BACKUP_SOURCE_TABLE}
     WHERE order_id = $2 AND player_id = $3
     RETURNING id, player_id, order_id, link, status`,
    [TO_PLAYER, ORDER_ID, BACKUP_FROM_PLAYER],
  );

  await client.query("COMMIT");
  console.log(`deleted ${deleteIds.length} rows`);
  console.log(`backup deleted: ${BACKUP_TABLE}`);
  console.log("inserted:", ins.rows[0]);
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
