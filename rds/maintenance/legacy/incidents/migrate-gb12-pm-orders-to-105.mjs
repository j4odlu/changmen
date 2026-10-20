#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * GB12 PM：将 player 76/102 订单归属到 105。
 * - 同一 order_id 只保留一行（优先 link 与 OB 等套利腿一致的行）
 * - 仅 UPDATE player_id，不修改 link 及其他字段
 *
 * Usage:
 *   node scripts/migrate-gb12-pm-orders-to-105.mjs --dry-run
 *   node scripts/migrate-gb12-pm-orders-to-105.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = process.argv.includes("--dry-run");
const USER_NAME = "GB12";
const FROM_PLAYERS = [76, 102];
const TO_PLAYER = 105;
const PROVIDER = "Polymarket";
const BACKUP_TABLE = "orders_migrate_backup_gb12_pm_76_102_20260712";

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

const plan = await pool.query(
  `
  WITH candidates AS (
    SELECT o.id, o.user_id, o.player_id, o.order_id, o.link, o.status, o.create_at
    FROM ${financialOrdersRelation("o")}
    WHERE o.user_id = $1::uuid
      AND o.provider = $2
      AND o.player_id = ANY($3::bigint[])
  ),
  on105 AS (
    SELECT order_id FROM ${financialOrdersRelation()}
    WHERE user_id = $1::uuid AND provider = $2 AND player_id = $4
  ),
  arb_links AS (
    SELECT DISTINCT link
    FROM ${financialOrdersRelation()}
    WHERE user_id = $1::uuid
      AND provider <> $2
      AND link IS NOT NULL
      AND ABS(link) >= 1000000000000
  ),
  ranked AS (
    SELECT
      c.*,
      EXISTS (SELECT 1 FROM on105 t WHERE t.order_id = c.order_id) AS already_on_105,
      EXISTS (SELECT 1 FROM arb_links a WHERE a.link = c.link) AS link_has_arb_partner,
      ROW_NUMBER() OVER (
        PARTITION BY c.order_id
        ORDER BY
          CASE WHEN EXISTS (SELECT 1 FROM arb_links a WHERE a.link = c.link) THEN 0 ELSE 1 END,
          CASE WHEN c.player_id = 76 THEN 0 WHEN c.player_id = 102 THEN 1 ELSE 2 END,
          c.id
      ) AS rn,
      COUNT(*) OVER (PARTITION BY c.order_id)::int AS dup_cnt
    FROM candidates c
  )
  SELECT *
  FROM ranked
  ORDER BY order_id, rn
  `,
  [userId, PROVIDER, FROM_PLAYERS, TO_PLAYER],
);

const keepRows = plan.rows.filter(r => Number(r.rn) === 1);
const deleteRows = plan.rows.filter(r => Number(r.rn) > 1);
const migrateRows = keepRows.filter(r => !r.already_on_105);
const skipDeleteKeepers = keepRows.filter(r => r.already_on_105);

console.log(`user=${users[0].user_name} (${userId})`);
console.log(`source players: ${FROM_PLAYERS.join(", ")} -> ${TO_PLAYER}`);
console.log(`distinct order_id: ${keepRows.length}`);
console.log(`migrate (UPDATE player_id): ${migrateRows.length}`);
console.log(`delete duplicates: ${deleteRows.length + skipDeleteKeepers.length}`);

for (const row of plan.rows) {
  const action = Number(row.rn) > 1
    ? "DELETE"
    : row.already_on_105
      ? "DELETE (105 exists)"
      : "MIGRATE";
  console.log(
    `  [${action}] id=${row.id} player=${row.player_id} order=${String(row.order_id).slice(0, 18)}... link=${row.link} arb=${row.link_has_arb_partner}`,
  );
}

if (!plan.rows.length) {
  console.log("nothing to do");
  await pool.end();
  process.exit(0);
}

if (dryRun) {
  console.log("[dry-run] no changes");
  await pool.end();
  process.exit(0);
}

const deleteIds = [
  ...deleteRows.map(r => Number(r.id)),
  ...skipDeleteKeepers.map(r => Number(r.id)),
].filter(n => Number.isFinite(n) && n > 0);
const migrateIds = migrateRows.map(r => Number(r.id)).filter(n => Number.isFinite(n) && n > 0);
const backupIds = [...new Set([...deleteIds, ...migrateIds])];

const client = await pool.connect();

try {
  await client.query("BEGIN");

  await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  await client.query(
    `CREATE TABLE ${BACKUP_TABLE} AS
     SELECT * FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
    [backupIds],
  );

  if (deleteIds.length) {
    await client.query(`DELETE FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`, [deleteIds]);
  }

  if (migrateIds.length) {
    const upd = await client.query(
      `UPDATE ${financialOrdersRelation()} SET player_id = $1
       WHERE id = ANY($2::bigint[]) AND user_id = $3::uuid`,
      [TO_PLAYER, migrateIds, userId],
    );
    if ((upd.rowCount ?? 0) !== migrateIds.length)
      throw new Error(`migrate rowCount mismatch: expected ${migrateIds.length}, got ${upd.rowCount}`);
  }

  await client.query("COMMIT");
  console.log(`backup: ${BACKUP_TABLE} (${backupIds.length} rows)`);
  console.log(`deleted ${deleteIds.length}, migrated ${migrateIds.length}`);
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
