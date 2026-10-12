#!/usr/bin/env node
import { financialOrdersRelation, prepareOrdersExecutionCompatibility } from "@changmen/db";
/**
 * GB13 OB：删除 player 83 上与 player 79 重复、且 link 可证实归属 79 的 4 组订单。
 *
 * Usage:
 *   node scripts/cleanup-gb13-ob-79-83-dupes.mjs --dry-run
 *   node scripts/cleanup-gb13-ob-79-83-dupes.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = process.argv.includes("--dry-run");
const USER_NAME = "GB13";
const KEEP_PLAYER = 79;
const DROP_PLAYER = 83;
const PROVIDER = "OB";
const BACKUP_TABLE = "orders_dup_backup_gb13_ob79_83_20260712";

/** link 对腿已证实归属 79 的 order_id */
const CONFIRMED_ORDER_IDS = [
  "1734918103032071704",
  "1735167223987408005",
  "1783161511364467749",
  "1790182649714368328",
];

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
  `SELECT o.id, o.order_id, o.player_id, o.link, o.status, o.bet_money, o.match
   FROM ${financialOrdersRelation("o")}
   WHERE o.user_id = $1::uuid
     AND o.provider = $2
     AND o.player_id = $3
     AND o.order_id = ANY($4::text[])
     AND EXISTS (
       SELECT 1 FROM ${financialOrdersRelation("k")}
       WHERE k.user_id = o.user_id
         AND k.player_id = $5
         AND k.order_id = o.order_id
         AND k.provider = o.provider
     )
   ORDER BY o.order_id`,
  [userId, PROVIDER, DROP_PLAYER, CONFIRMED_ORDER_IDS, KEEP_PLAYER],
);

console.log(`user=${users[0].user_name} (${userId})`);
console.log(`will delete ${preview.rows.length} rows on player ${DROP_PLAYER} (keep ${KEEP_PLAYER})`);

for (const row of preview.rows) {
  const { rows: keep } = await pool.query(
    `SELECT link FROM ${financialOrdersRelation()} WHERE user_id=$1::uuid AND player_id=$2 AND provider=$3 AND order_id=$4`,
    [userId, KEEP_PLAYER, PROVIDER, row.order_id],
  );
  console.log(
    `  id=${row.id} order_id=${row.order_id} drop_link=${row.link ?? "-"} keep_link=${keep[0]?.link ?? "-"} match=${row.match ?? "-"}`,
  );
}

if (preview.rows.length !== CONFIRMED_ORDER_IDS.length) {
  console.warn(
    `warn: expected ${CONFIRMED_ORDER_IDS.length} rows, found ${preview.rows.length}`,
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
