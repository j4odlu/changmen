#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * GB12 PB：删除 player 32（旧平博）上与 player 53 重复的订单副本。
 *
 * Usage:
 *   node scripts/cleanup-gb12-pb-player32-dupes.mjs --dry-run
 *   node scripts/cleanup-gb12-pb-player32-dupes.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";

const dryRun = process.argv.includes("--dry-run");
const USER_NAME = "GB12";
const KEEP_PLAYER = 53;
const DROP_PLAYER = 32;
const PROVIDER = "PB";
const BACKUP_TABLE = "orders_dup_backup_gb12_pb32_20260712";

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
     AND o.player_id = $3
     AND EXISTS (
       SELECT 1 FROM ${financialOrdersRelation("k")}
       WHERE k.user_id = o.user_id
         AND k.player_id = $4
         AND k.order_id = o.order_id
         AND k.provider = o.provider
     )
   ORDER BY o.order_id`,
  [userId, PROVIDER, DROP_PLAYER, KEEP_PLAYER],
);

const orphan32 = await pool.query(
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
console.log(`player ${DROP_PLAYER} PB orders without player ${KEEP_PLAYER} counterpart: ${orphan32.rows[0].n}`);

for (const row of preview.rows) {
  console.log(
    `  id=${row.id} order_id=${row.order_id} status=${row.status} bet_money=${row.bet_money} match=${row.match ?? "-"}`,
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
