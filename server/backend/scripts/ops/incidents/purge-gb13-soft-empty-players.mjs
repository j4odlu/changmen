#!/usr/bin/env node
import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * 硬删除 GB13 已无订单的软删 player 空壳（保留 77 米兰 6 条订单）。
 *
 *   node scripts/purge-gb13-soft-empty-players.mjs --dry-run
 *   node scripts/purge-gb13-soft-empty-players.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = !process.argv.includes("--execute");
const USER_NAME = "GB13";
const PLAYER_IDS = [78, 80, 84, 106, 107, 108, 109, 110, 112, 113, 114, 115, 116, 117];
const BACKUP_TABLE = "players_purge_backup_gb13_soft_empty_20260712";

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

const { rows: players } = await pool.query(
  `SELECT id, platform_name, player_name, provider, owner_user_id, deleted_at
   FROM players WHERE id = ANY($1::bigint[])
   ORDER BY id`,
  [PLAYER_IDS],
);

if (players.length !== PLAYER_IDS.length) {
  const found = new Set(players.map(p => Number(p.id)));
  const missing = PLAYER_IDS.filter(id => !found.has(id));
  console.error("player 行不完整, missing:", missing);
  process.exit(1);
}

for (const p of players) {
  if (String(p.owner_user_id) !== String(userId)) {
    console.error(`player ${p.id} 不属于 ${USER_NAME}`);
    process.exit(1);
  }
  if (!p.deleted_at) {
    console.error(`player ${p.id} 未软删，拒绝硬删`);
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

console.log(`user=${users[0].user_name} (${userId}) mode=${dryRun ? "dry-run" : "execute"}`);
console.log(`purge ${PLAYER_IDS.length} soft-deleted empty players (skip 77)`);
for (const p of players) {
  console.log(
    `  ${p.id}\t${p.platform_name}/${p.player_name}\tprovider=${p.provider || "(empty)"}`,
  );
}

if (dryRun) {
  console.log("\n[dry-run] 无变更");
  console.log("执行: node scripts/purge-gb13-soft-empty-players.mjs --execute");
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
  console.log(`\nbackup: ${BACKUP_TABLE}`);
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
