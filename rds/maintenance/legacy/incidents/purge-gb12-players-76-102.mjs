#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 硬删除 GB12 已废弃 PM 操盘账号 player 76 / 102。
 * 前置：订单已迁到 105，且无 orders/money_logs 引用。
 *
 * Usage:
 *   node scripts/purge-gb12-players-76-102.mjs --dry-run
 *   node scripts/purge-gb12-players-76-102.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";

const dryRun = process.argv.includes("--dry-run");
const USER_NAME = "GB12";
const PLAYER_IDS = [76, 102];
const BACKUP_TABLE = "players_purge_backup_gb12_76_102_20260712";

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

const { rows: players } = await pool.query(
  `SELECT id, player_name, provider, venue_member_id, owner_user_id, deleted_at
   FROM players WHERE id = ANY($1::bigint[])`,
  [PLAYER_IDS],
);

if (players.length !== PLAYER_IDS.length) {
  console.error("player 行不完整:", players.map(p => p.id));
  process.exit(1);
}

for (const p of players) {
  if (String(p.owner_user_id) !== String(userId)) {
    console.error(`player ${p.id} 不属于 ${USER_NAME}`);
    process.exit(1);
  }
}

const { rows: refs } = await pool.query(
  `SELECT 'orders' AS src, COUNT(*)::int AS n FROM ${financialOrdersRelation()} WHERE player_id = ANY($1::bigint[])
   UNION ALL
   SELECT 'money_logs', COUNT(*)::int FROM money_logs WHERE player_id = ANY($1::bigint[])`,
  [PLAYER_IDS],
);
const blocked = refs.filter(r => Number(r.n) > 0);
if (blocked.length) {
  console.error("仍有引用，拒绝删除:", blocked);
  process.exit(1);
}

console.log(`user=${users[0].user_name} (${userId})`);
for (const p of players) {
  console.log(
    `  purge player ${p.id} name=${p.player_name} provider=${p.provider || "(empty)"} deleted_at=${p.deleted_at ?? "null"}`,
  );
}

if (dryRun) {
  console.log("[dry-run] no changes");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  await client.query(
    `CREATE TABLE ${BACKUP_TABLE} AS
     SELECT * FROM players WHERE id = ANY($1::bigint[]) AND owner_user_id = $2::uuid`,
    [PLAYER_IDS, userId],
  );
  const del = await client.query(
    `DELETE FROM players WHERE id = ANY($1::bigint[]) AND owner_user_id = $2::uuid`,
    [PLAYER_IDS, userId],
  );
  await client.query("COMMIT");
  console.log(`backup: ${BACKUP_TABLE}`);
  console.log(`deleted ${del.rowCount ?? 0} player rows`);
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
