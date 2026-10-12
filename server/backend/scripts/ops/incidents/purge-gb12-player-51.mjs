#!/usr/bin/env node
import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * GB12：硬删软删 player 51 及其 orders。
 *
 *   node scripts/purge-gb12-player-51.mjs --dry-run
 *   node scripts/purge-gb12-player-51.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = !process.argv.includes("--execute");
const USER_NAME = "GB12";
const PLAYER_ID = 51;
const BACKUP_PLAYERS = "players_purge_backup_gb12_51_20260712";
const BACKUP_ORDERS = "orders_purge_backup_gb12_51_20260712";

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

const { rows: player } = await pool.query(
  `SELECT id, platform_name, player_name, provider, deleted_at, owner_user_id
   FROM players WHERE id = $1`,
  [PLAYER_ID],
);
if (!player.length) {
  console.error(`player ${PLAYER_ID} 不存在`);
  process.exit(1);
}
const p = player[0];
if (String(p.owner_user_id) !== String(userId)) {
  console.error(`player ${PLAYER_ID} 不属于 ${USER_NAME}`);
  process.exit(1);
}
if (!p.deleted_at) {
  console.error(`player ${PLAYER_ID} 未软删`);
  process.exit(1);
}

const { rows: orders } = await pool.query(
  `SELECT id, order_id, provider, link, match, bet_money
   FROM ${financialOrdersRelation()} WHERE user_id = $1::uuid AND player_id = $2
   ORDER BY id`,
  [userId, PLAYER_ID],
);

console.log(`user=${users[0].user_name} mode=${dryRun ? "dry-run" : "execute"}`);
console.log(`player ${PLAYER_ID} ${p.platform_name}/${p.player_name} orders=${orders.length}`);
for (const o of orders) {
  console.log(`  order id=${o.id} order_id=${o.order_id} ${o.provider} link=${o.link ?? "-"} ${o.match?.slice(0, 40) ?? "-"}`);
}

if (dryRun) {
  console.log("\n[dry-run] 无变更");
  console.log("执行: node scripts/purge-gb12-player-51.mjs --execute");
  await pool.end();
  process.exit(0);
}

const orderIds = orders.map(o => Number(o.id));
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`DROP TABLE IF EXISTS ${BACKUP_PLAYERS}`);
  await client.query(
    `CREATE TABLE ${BACKUP_PLAYERS} AS SELECT * FROM players WHERE id = $1`,
    [PLAYER_ID],
  );
  if (orderIds.length) {
    await client.query(`DROP TABLE IF EXISTS ${BACKUP_ORDERS}`);
    await client.query(
      `CREATE TABLE ${BACKUP_ORDERS} AS SELECT * FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
      [orderIds],
    );
    await client.query(`DELETE FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`, [orderIds]);
  }
  await client.query(`DELETE FROM money_logs WHERE user_id = $1::uuid AND player_id = $2`, [userId, PLAYER_ID]);
  const del = await client.query(
    `DELETE FROM players WHERE id = $1 AND owner_user_id = $2::uuid AND deleted_at IS NOT NULL`,
    [PLAYER_ID, userId],
  );
  await client.query("COMMIT");
  console.log(`\nbackup players: ${BACKUP_PLAYERS}`);
  if (orderIds.length)
    console.log(`backup orders: ${BACKUP_ORDERS}`);
  console.log(`deleted orders: ${orderIds.length}`);
  console.log(`deleted players: ${del.rowCount ?? 0}`);
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
