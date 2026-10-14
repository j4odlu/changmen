#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * GB12 OB：删除 player 23/37 上与 player 13 重复的订单副本（保留 13 + RAY link）。
 *
 * Usage:
 *   node scripts/cleanup-gb12-ob-player23-dupes.mjs --dry-run
 *   node scripts/cleanup-gb12-ob-player23-dupes.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = process.argv.includes("--dry-run");
const USER_NAME = "GB12";
const KEEP_PLAYER = 13;
const DROP_PLAYERS = [23, 37];
const PROVIDER = "OB";
const BACKUP_TABLE = "orders_dup_backup_gb12_ob23_37_20260712";

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

const preview = await pool.query(
  `SELECT o.id, o.order_id, o.player_id, o.link, o.status, o.bet_money, o.match,
          to_char(to_timestamp(o.create_at / 1000.0), 'YYYY-MM-DD HH24:MI:SS') AS create_at_local
   FROM ${financialOrdersRelation("o")}
   WHERE o.user_id = $1::uuid
     AND o.provider = $2
     AND o.player_id = ANY($3::bigint[])
     AND EXISTS (
       SELECT 1 FROM ${financialOrdersRelation("k")}
       WHERE k.user_id = o.user_id
         AND k.player_id = $4
         AND k.order_id = o.order_id
         AND k.provider = o.provider
     )
   ORDER BY o.order_id, o.player_id`,
  [userId, PROVIDER, DROP_PLAYERS, KEEP_PLAYER],
);

const byPlayer = Object.fromEntries(DROP_PLAYERS.map((p) => [p, 0]));
for (const row of preview.rows) byPlayer[row.player_id] = (byPlayer[row.player_id] ?? 0) + 1;

console.log(`user=${users[0].user_name} (${userId})`);
console.log(`will delete ${preview.rows.length} duplicate rows (keep player ${KEEP_PLAYER})`);
for (const p of DROP_PLAYERS) console.log(`  player ${p}: ${byPlayer[p] ?? 0} rows`);

for (const row of preview.rows) {
  console.log(
    `  id=${row.id} order_id=${row.order_id} player=${row.player_id} link=${row.link ?? "-"} status=${row.status} match=${row.match ?? "-"}`,
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
