#!/usr/bin/env node
import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * River：硬删除全部软删 player（含其 orders 备份后删除）。
 *
 *   node scripts/purge-river-soft-players.mjs --dry-run
 *   node scripts/purge-river-soft-players.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = !process.argv.includes("--execute");
const USER_NAME = "River";
const BACKUP_PLAYERS = "players_purge_backup_river_soft_all_20260712";
const BACKUP_ORDERS = "orders_purge_backup_river_soft_all_20260712";

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

const { rows: softPlayers } = await pool.query(
  `SELECT pl.id, pl.platform_name, pl.player_name, pl.provider, pl.deleted_at,
          (SELECT COUNT(*)::int FROM ${financialOrdersRelation("o")} WHERE o.user_id = $1::uuid AND o.player_id = pl.id) AS orders,
          (SELECT COUNT(*)::int FROM money_logs m WHERE m.user_id = $1::uuid AND m.player_id = pl.id) AS money_logs
   FROM players pl
   WHERE pl.owner_user_id = $1::uuid AND pl.deleted_at IS NOT NULL
   ORDER BY pl.id`,
  [userId],
);

if (!softPlayers.length) {
  console.log(`${USER_NAME} 无软删 player`);
  await pool.end();
  process.exit(0);
}

const playerIds = softPlayers.map(p => Number(p.id));
const orderCount = softPlayers.reduce((s, p) => s + Number(p.orders), 0);
const logCount = softPlayers.reduce((s, p) => s + Number(p.money_logs), 0);

console.log(`user=${users[0].user_name} (${userId}) mode=${dryRun ? "dry-run" : "execute"}`);
console.log(`soft players=${softPlayers.length} orders=${orderCount} money_logs=${logCount}`);
for (const p of softPlayers) {
  console.log(
    `  ${p.id}\t${p.platform_name}/${p.player_name}\tprovider=${p.provider || "-"}\torders=${p.orders}`,
  );
}

if (dryRun) {
  console.log("\n[dry-run] 将备份并删除上述 orders + 硬删 players");
  console.log("执行: node scripts/purge-river-soft-players.mjs --execute");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();

try {
  await client.query("BEGIN");

  await client.query(`DROP TABLE IF EXISTS ${BACKUP_PLAYERS}`);
  await client.query(
    `CREATE TABLE ${BACKUP_PLAYERS} AS
     SELECT * FROM players WHERE id = ANY($1::bigint[]) AND owner_user_id = $2::uuid`,
    [playerIds, userId],
  );

  await client.query(`DROP TABLE IF EXISTS ${BACKUP_ORDERS}`);
  await client.query(
    `CREATE TABLE ${BACKUP_ORDERS} AS
     SELECT * FROM ${financialOrdersRelation()} WHERE user_id = $1::uuid AND player_id = ANY($2::bigint[])`,
    [userId, playerIds],
  );

  const delOrders = await client.query(
    `DELETE FROM ${financialOrdersRelation()} WHERE user_id = $1::uuid AND player_id = ANY($2::bigint[])`,
    [userId, playerIds],
  );

  const delLogs = await client.query(
    `DELETE FROM money_logs WHERE user_id = $1::uuid AND player_id = ANY($2::bigint[])`,
    [userId, playerIds],
  );

  const delPlayers = await client.query(
    `DELETE FROM players WHERE id = ANY($1::bigint[]) AND owner_user_id = $2::uuid AND deleted_at IS NOT NULL`,
    [playerIds, userId],
  );

  await client.query("COMMIT");
  console.log(`\nbackup players: ${BACKUP_PLAYERS}`);
  console.log(`backup orders: ${BACKUP_ORDERS}`);
  console.log(`deleted orders: ${delOrders.rowCount ?? 0}`);
  console.log(`deleted money_logs: ${delLogs.rowCount ?? 0}`);
  console.log(`deleted players: ${delPlayers.rowCount ?? 0}`);
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
