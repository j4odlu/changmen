#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * GB18 ↔ GB19 平博交叉同步：9 个相同 order_id 各写两份。
 * 真单在 GB19 player 252（jiayu1 / RMB54556WIJ，有 PM/RAY 对家腿）。
 * GB18 player 233 上的副本是错误活标签同步，删除。
 *
 *   DATABASE_RDS_TARGET=public node server/backend/scripts/ops/incidents/cleanup-gb18-gb19-pb-cross-dups.mjs
 *   DATABASE_RDS_TARGET=public node server/backend/scripts/ops/incidents/cleanup-gb18-gb19-pb-cross-dups.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = !process.argv.includes("--execute");
const KEEP_USER = "GB19";
const DROP_USER = "GB18";
const KEEP_PLAYER = 252;
const DROP_PLAYER = 233;
const STAMP = "20260914";
const BACKUP_KEEP = `orders_dup_backup_gb19_keep_pb_${STAMP}`;
const BACKUP_DROP = `orders_dup_backup_gb18_drop_pb_${STAMP}`;
const OIDS = [
  "767023318",
  "767023326",
  "767035000",
  "767035868",
  "767097374",
  "767257930",
  "767267916",
  "767268335",
  "767269823",
];

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
  `SELECT id, user_name FROM profiles WHERE lower(user_name) IN ('gb18', 'gb19')`,
);
const keepUserId = profiles.find(p => String(p.user_name).toLowerCase() === "gb19")?.id;
const dropUserId = profiles.find(p => String(p.user_name).toLowerCase() === "gb18")?.id;
if (!keepUserId || !dropUserId) {
  console.error(`缺少用户 ${KEEP_USER}/${DROP_USER}`, profiles);
  await pool.end();
  process.exit(1);
}

const keepRows = await pool.query(
  `
  SELECT o.id, o.order_id, o.player_id, o.provider, o.status, o.money, o.bet_money, o.link, o.create_at
  FROM ${financialOrdersRelation("o")}
  WHERE o.user_id = $1::uuid
    AND o.player_id = $2
    AND upper(o.provider) = 'PB'
    AND o.order_id = ANY($3::text[])
  ORDER BY o.order_id, o.id
  `,
  [keepUserId, KEEP_PLAYER, OIDS],
);
const dropRows = await pool.query(
  `
  SELECT o.id, o.order_id, o.player_id, o.provider, o.status, o.money, o.bet_money, o.link, o.create_at
  FROM ${financialOrdersRelation("o")}
  WHERE o.user_id = $1::uuid
    AND o.player_id = $2
    AND upper(o.provider) = 'PB'
    AND o.order_id = ANY($3::text[])
  ORDER BY o.order_id, o.id
  `,
  [dropUserId, DROP_PLAYER, OIDS],
);

console.log(`mode=${dryRun ? "dry-run" : "execute"} keep=${KEEP_USER}/p${KEEP_PLAYER} drop=${DROP_USER}/p${DROP_PLAYER}`);
console.log(`keep rows=${keepRows.rows.length} drop rows=${dropRows.rows.length} expect=${OIDS.length}`);

const keepOids = new Set(keepRows.rows.map(r => String(r.order_id)));
const dropOids = new Set(dropRows.rows.map(r => String(r.order_id)));
for (const oid of OIDS) {
  if (!keepOids.has(oid)) {
    console.error(`abort: GB19 缺少 keep 行 ${oid}`);
    await pool.end();
    process.exit(1);
  }
  if (!dropOids.has(oid)) {
    console.error(`abort: GB18 缺少 drop 行 ${oid}`);
    await pool.end();
    process.exit(1);
  }
}
if (keepRows.rows.length !== OIDS.length || dropRows.rows.length !== OIDS.length) {
  console.error("abort: 行数与清单不一致，拒绝删除");
  await pool.end();
  process.exit(1);
}

for (const r of dropRows.rows) {
  console.log(
    `  DROP id=${r.id} order=${r.order_id} player=${r.player_id} ${r.status} money=${r.money} link=${r.link}`,
  );
}

if (dryRun) {
  console.log("\n[dry-run] 无变更");
  console.log(`备份表将为: ${BACKUP_KEEP} / ${BACKUP_DROP}`);
  console.log("执行加 --execute");
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
  if (bakKeep.rows[0].n !== OIDS.length || bakDrop.rows[0].n !== OIDS.length) {
    throw new Error(`备份行数不对 keep=${bakKeep.rows[0].n} drop=${bakDrop.rows[0].n}`);
  }
  const del = await client.query(
    `DELETE FROM ${financialOrdersRelation()}
     WHERE id = ANY($1::bigint[])
       AND user_id = $2::uuid
       AND player_id = $3
       AND upper(provider) = 'PB'`,
    [dropIds, dropUserId, DROP_PLAYER],
  );
  if ((del.rowCount ?? 0) !== OIDS.length) {
    throw new Error(`删除行数 ${del.rowCount} != ${OIDS.length}`);
  }
  await client.query("COMMIT");
  console.log(`\n备份 ${BACKUP_KEEP}: ${bakKeep.rows[0].n} 行`);
  console.log(`备份 ${BACKUP_DROP}: ${bakDrop.rows[0].n} 行`);
  console.log(`已从 ${DROP_USER} p${DROP_PLAYER} 删除 ${del.rowCount} 行；${KEEP_USER} 保留不动`);
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
  SELECT pr.user_name, o.player_id, COUNT(*)::int AS n
  FROM ${financialOrdersRelation("o")}
  JOIN profiles pr ON pr.id = o.user_id
  WHERE o.order_id = ANY($1::text[])
    AND o.user_id IN ($2::uuid, $3::uuid)
  GROUP BY pr.user_name, o.player_id
  ORDER BY pr.user_name
  `,
  [OIDS, keepUserId, dropUserId],
);
const stillCross = await pool.query(
  `
  SELECT COUNT(*)::int AS n FROM (
    SELECT lower(order_id)
    FROM ${financialOrdersRelation()}
    WHERE order_id = ANY($1::text[])
      AND user_id IN ($2::uuid, $3::uuid)
    GROUP BY lower(order_id)
    HAVING COUNT(DISTINCT user_id) > 1
  ) t
  `,
  [OIDS, keepUserId, dropUserId],
);
console.log("after by user:", left.rows);
console.log(`remaining cross dups on these 9 ids: ${stillCross.rows[0].n}`);
await pool.end();
