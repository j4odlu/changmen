#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 跨用户 order_id 重复（GB14 ↔ GB15）：归属 GB14，删除 GB15 侧副本。
 * 两侧整行各备份一张表后再删。
 *
 *   DATABASE_RDS_TARGET=public node server/backend/scripts/ops/incidents/cleanup-gb15-cross-dup-keep-gb14.mjs
 *   DATABASE_RDS_TARGET=public node server/backend/scripts/ops/incidents/cleanup-gb15-cross-dup-keep-gb14.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = !process.argv.includes("--execute");
const KEEP_USER = "GB14";
const DROP_USER = "GB15";
const STAMP = "20260808";
const BACKUP_KEEP = `orders_dup_backup_gb14_keep_${STAMP}`;
const BACKUP_DROP = `orders_dup_backup_gb15_drop_${STAMP}`;
const EXPECTED = 51;

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

const { rows: profiles } = await pool.query(
  `SELECT id, user_name FROM profiles WHERE user_name IN ($1, $2)`,
  [KEEP_USER, DROP_USER],
);
const keepUserId = profiles.find(p => p.user_name === KEEP_USER)?.id;
const dropUserId = profiles.find(p => p.user_name === DROP_USER)?.id;
if (!keepUserId || !dropUserId) {
  console.error(`缺少用户 ${KEEP_USER}/${DROP_USER}`, profiles);
  await pool.end();
  process.exit(1);
}

const { rows: dupOids } = await pool.query(
  `
  SELECT lower(order_id) AS oid
  FROM ${financialOrdersRelation()}
  WHERE order_id IS NOT NULL AND trim(order_id) <> ''
    AND user_id IN ($1::uuid, $2::uuid)
  GROUP BY lower(order_id)
  HAVING COUNT(DISTINCT user_id) > 1
     AND bool_or(user_id = $1::uuid)
     AND bool_or(user_id = $2::uuid)
  `,
  [keepUserId, dropUserId],
);
const oids = dupOids.map(r => r.oid);
console.log(`mode=${dryRun ? "dry-run" : "execute"} keep=${KEEP_USER} drop=${DROP_USER}`);
console.log(`cross-user dup order_id groups: ${oids.length} (expect ${EXPECTED})`);

if (oids.length !== EXPECTED) {
  console.warn(`warn: expected ${EXPECTED} groups, found ${oids.length}`);
}

const keepRows = await pool.query(
  `
  SELECT o.id, o.order_id, o.player_id, o.provider, o.status, o.money, o.bet_money, o.link, o.create_at
  FROM ${financialOrdersRelation("o")}
  WHERE o.user_id = $1::uuid
    AND lower(o.order_id) = ANY($2::text[])
  ORDER BY o.order_id, o.id
  `,
  [keepUserId, oids],
);
const dropRows = await pool.query(
  `
  SELECT o.id, o.order_id, o.player_id, o.provider, o.status, o.money, o.bet_money, o.link, o.create_at
  FROM ${financialOrdersRelation("o")}
  WHERE o.user_id = $1::uuid
    AND lower(o.order_id) = ANY($2::text[])
  ORDER BY o.order_id, o.id
  `,
  [dropUserId, oids],
);

console.log(`keep ${KEEP_USER}: ${keepRows.rows.length} rows`);
console.log(`drop ${DROP_USER}: ${dropRows.rows.length} rows`);
for (const r of dropRows.rows) {
  console.log(
    `  DROP id=${r.id} order=${r.order_id} player=${r.player_id} ${r.provider} ${r.status} money=${r.money} link=${r.link}`,
  );
}

if (dropRows.rows.length !== EXPECTED) {
  console.warn(`warn: expected ${EXPECTED} drop rows, found ${dropRows.rows.length}`);
}
if (keepRows.rows.length < 1) {
  console.error("abort: keep 侧无行");
  await pool.end();
  process.exit(1);
}

if (dryRun) {
  console.log("\n[dry-run] 无变更");
  console.log(`备份表将为: ${BACKUP_KEEP} (保留侧) / ${BACKUP_DROP} (删除侧)`);
  console.log("执行: DATABASE_RDS_TARGET=public node server/backend/scripts/ops/incidents/cleanup-gb15-cross-dup-keep-gb14.mjs --execute");
  await pool.end();
  process.exit(0);
}

const keepIds = keepRows.rows.map(r => Number(r.id));
const dropIds = dropRows.rows.map(r => Number(r.id));
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`DROP TABLE IF EXISTS ${BACKUP_KEEP}`);
  await client.query(`DROP TABLE IF EXISTS ${BACKUP_DROP}`);
  await client.query(
    `CREATE TABLE ${BACKUP_KEEP} AS SELECT * FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
    [keepIds],
  );
  await client.query(
    `CREATE TABLE ${BACKUP_DROP} AS SELECT * FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`,
    [dropIds],
  );
  const bakKeep = await client.query(`SELECT COUNT(*)::int AS n FROM ${BACKUP_KEEP}`);
  const bakDrop = await client.query(`SELECT COUNT(*)::int AS n FROM ${BACKUP_DROP}`);
  const del = await client.query(
    `DELETE FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[]) AND user_id = $2::uuid`,
    [dropIds, dropUserId],
  );
  await client.query("COMMIT");
  console.log(`\n备份 ${BACKUP_KEEP}: ${bakKeep.rows[0].n} 行`);
  console.log(`备份 ${BACKUP_DROP}: ${bakDrop.rows[0].n} 行`);
  console.log(`已从 ${DROP_USER} 删除 ${del.rowCount ?? 0} 行；${KEEP_USER} 保留不动`);
}
catch (err) {
  await client.query("ROLLBACK");
  console.error("rollback:", err.message);
  process.exit(1);
}
finally {
  client.release();
}

const left = await pool.query(
  `
  SELECT pr.user_name, COUNT(*)::int AS n
  FROM ${financialOrdersRelation("o")}
  JOIN profiles pr ON pr.id = o.user_id
  WHERE lower(o.order_id) = ANY($1::text[])
    AND o.user_id IN ($2::uuid, $3::uuid)
  GROUP BY pr.user_name
  ORDER BY pr.user_name
  `,
  [oids, keepUserId, dropUserId],
);
const stillCross = await pool.query(
  `
  SELECT COUNT(*)::int AS n FROM (
    SELECT lower(order_id)
    FROM ${financialOrdersRelation()}
    WHERE order_id IS NOT NULL AND trim(order_id) <> ''
      AND user_id IN ($1::uuid, $2::uuid)
    GROUP BY lower(order_id)
    HAVING COUNT(DISTINCT user_id) > 1
  ) t
  `,
  [keepUserId, dropUserId],
);
console.log("after by user:", left.rows);
console.log(`remaining GB14↔GB15 cross dups: ${stillCross.rows[0].n}`);
await pool.end();
