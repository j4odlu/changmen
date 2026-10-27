#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 硬删除全库无 orders / money_logs 的软删 player 空壳。
 *
 *   node scripts/purge-soft-empty-players.mjs --dry-run
 *   node scripts/purge-soft-empty-players.mjs --execute
 *   node scripts/purge-soft-empty-players.mjs --user GB15 --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";

const dryRun = !process.argv.includes("--execute");
const userFilter = process.argv.find(a => a.startsWith("--user="))?.slice(7) || "";
const BACKUP_TABLE = "players_purge_backup_soft_empty_20260712";

loadChangmenEnv();
const { initDatabaseUrl, getPgPool } = await import("@changmen/db");
await initDatabaseUrl();
const pool = getPgPool();

if (!pool) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

const params = [];
let userClause = "";
if (userFilter) {
  params.push(userFilter);
  userClause = ` AND u.user_name ILIKE $${params.length}`;
}

const { rows: targets } = await pool.query(
  `SELECT pl.id, u.user_name, pl.platform_name, pl.player_name, pl.provider, pl.owner_user_id
   FROM players pl
   JOIN users u ON u.id = pl.owner_user_id
   WHERE pl.deleted_at IS NOT NULL
     ${userClause}
     AND NOT EXISTS (
       SELECT 1 FROM ${financialOrdersRelation("o")}
       WHERE o.user_id = pl.owner_user_id AND o.player_id = pl.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM money_logs m
       WHERE m.user_id = pl.owner_user_id AND m.player_id = pl.id
     )
   ORDER BY u.user_name, pl.id`,
  params,
);

if (!targets.length) {
  console.log("无符合条件的软删空壳");
  await pool.end();
  process.exit(0);
}

const byUser = new Map();
for (const t of targets) {
  const list = byUser.get(t.user_name) ?? [];
  list.push(t);
  byUser.set(t.user_name, list);
}

console.log(`mode=${dryRun ? "dry-run" : "execute"} 空壳=${targets.length}`);
for (const [user, list] of byUser) {
  console.log(`\n${user} (${list.length})`);
  for (const p of list) {
    console.log(`  ${p.id}\t${p.platform_name}/${p.player_name}\t${p.provider || "-"}`);
  }
}

if (dryRun) {
  console.log("\n[dry-run] 无变更");
  console.log("执行: node scripts/purge-soft-empty-players.mjs --execute");
  await pool.end();
  process.exit(0);
}

const playerIds = targets.map(t => Number(t.id));
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  await client.query(
    `CREATE TABLE ${BACKUP_TABLE} AS SELECT * FROM players WHERE id = ANY($1::bigint[])`,
    [playerIds],
  );
  const del = await client.query(
    `DELETE FROM players WHERE id = ANY($1::bigint[]) AND deleted_at IS NOT NULL`,
    [playerIds],
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
