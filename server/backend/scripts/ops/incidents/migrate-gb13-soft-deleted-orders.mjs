#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * GB13：软删 player 订单迁到活跃 successor；player 77（米兰）按方案 A 保留不动。
 *
 *   node scripts/migrate-gb13-soft-deleted-orders.mjs --dry-run
 *   node scripts/migrate-gb13-soft-deleted-orders.mjs --execute
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

const dryRun = !process.argv.includes("--execute");
const USER_NAME = "GB13";
const BACKUP_TABLE = "orders_migrate_backup_gb13_soft_20260712";

/** 软删 player -> 活跃 successor（77 无映射，跳过） */
const SUCCESSOR = new Map([
  [78, 118],
  [106, 118],
  [80, 111],
  [84, 119],
  [107, 111],
]);

/** 软删间重复：删 106 副本，保留 78（link 有活跃 RAY/PB 对腿） */
const DELETE_IDS = [2013540, 2013539];

/** 明确迁移行（RDS orders.id）；由 _tmp_gb13_soft_migrate_plan.mjs 核对 */
const MIGRATE_ROWS = [
  { id: 1311129, from: 78, to: 118 },
  { id: 1302452, from: 78, to: 118 },
  { id: 1267729, from: 78, to: 118 },
  { id: 1276215, from: 78, to: 118 },
  { id: 1709034, from: 78, to: 118 },
  { id: 1728751, from: 78, to: 118 },
  { id: 2013541, from: 106, to: 118 },
  { id: 2013538, from: 106, to: 118 },
  { id: 1302728, from: 80, to: 111 },
  { id: 1271848, from: 80, to: 111 },
  { id: 1286884, from: 80, to: 111 },
  { id: 1391026, from: 80, to: 111 },
  { id: 1721141, from: 84, to: 119 },
  { id: 1725504, from: 84, to: 119 },
  { id: 1725310, from: 84, to: 119 },
  { id: 2016369, from: 107, to: 111 },
  { id: 2016370, from: 107, to: 111 },
];

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

async function assertTargetPlayers() {
  const targets = [...new Set(MIGRATE_ROWS.map(r => r.to))];
  const { rows } = await pool.query(
    `SELECT id, platform_name, player_name, deleted_at
     FROM players WHERE id = ANY($1::bigint[]) AND owner_user_id = $2::uuid`,
    [targets, userId],
  );
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  for (const tid of targets) {
    const p = byId.get(tid);
    if (!p || p.deleted_at) {
      console.error(`目标 player ${tid} 不可用`);
      process.exit(1);
    }
  }
  return byId;
}

async function loadRows(ids) {
  const { rows } = await pool.query(
    `SELECT o.id, o.player_id, o.order_id, o.provider, o.link, o.match, o.bet_money,
            pl.platform_name, pl.player_name, pl.deleted_at IS NOT NULL AS soft
     FROM ${financialOrdersRelation("o")}
     JOIN players pl ON pl.id = o.player_id
     WHERE o.user_id = $1::uuid AND o.id = ANY($2::bigint[])
     ORDER BY o.id`,
    [userId, ids],
  );
  return rows;
}

await assertTargetPlayers();

const migrateIds = MIGRATE_ROWS.map(r => r.id);
const allIds = [...new Set([...migrateIds, ...DELETE_IDS])];
const existing = await loadRows(allIds);
const byId = new Map(existing.map(r => [Number(r.id), r]));

console.log(`user=${users[0].user_name} (${userId}) mode=${dryRun ? "dry-run" : "execute"}`);
console.log(`migrate=${MIGRATE_ROWS.length} delete=${DELETE_IDS.length} skip_player_77=6`);

for (const row of MIGRATE_ROWS) {
  const cur = byId.get(row.id);
  if (!cur) {
    console.error(`缺失 orders.id=${row.id}`);
    process.exit(1);
  }
  if (Number(cur.player_id) !== row.from) {
    console.error(`id=${row.id} 期望 from=${row.from} 实际 player_id=${cur.player_id}`);
    process.exit(1);
  }
  if (!cur.soft) {
    console.error(`id=${row.id} player ${row.from} 非软删`);
    process.exit(1);
  }
  const conflict = await pool.query(
    `SELECT id FROM ${financialOrdersRelation()}
     WHERE user_id = $1::uuid AND player_id = $2 AND order_id = $3 AND provider = $4`,
    [userId, row.to, cur.order_id, cur.provider],
  );
  if (conflict.rows.length) {
    console.error(`id=${row.id} order_id=${cur.order_id} 目标 ${row.to} 已存在`);
    process.exit(1);
  }
  console.log(
    `MIGRATE id=${row.id} ${row.from}->${row.to} order=${cur.order_id} ${cur.platform_name}/${cur.player_name}`,
  );
}

for (const id of DELETE_IDS) {
  const cur = byId.get(id);
  if (!cur) {
    console.error(`缺失 delete id=${id}`);
    process.exit(1);
  }
  if (Number(cur.player_id) !== 106) {
    console.error(`delete id=${id} 期望 player 106 实际 ${cur.player_id}`);
    process.exit(1);
  }
  console.log(`DELETE id=${id} player=106 order=${cur.order_id} (dup of 78)`);
}

const p77 = await pool.query(
  `SELECT COUNT(*)::int AS n FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid AND o.player_id = 77 AND pl.deleted_at IS NOT NULL`,
  [userId],
);
console.log(`SKIP player 77: ${p77.rows[0].n} 条保留在软删米兰`);

if (dryRun) {
  console.log("\n[dry-run] 无变更");
  console.log("执行: node scripts/migrate-gb13-soft-deleted-orders.mjs --execute");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();

try {
  await client.query("BEGIN");

  await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  await client.query(
    `CREATE TABLE ${BACKUP_TABLE} AS
     SELECT * FROM ${financialOrdersRelation()} WHERE user_id = $1::uuid AND id = ANY($2::bigint[])`,
    [userId, allIds],
  );

  if (DELETE_IDS.length) {
    await client.query(`DELETE FROM ${financialOrdersRelation()} WHERE id = ANY($1::bigint[])`, [DELETE_IDS]);
  }

  for (const row of MIGRATE_ROWS) {
    await client.query(
      `UPDATE ${financialOrdersRelation()} SET player_id = $1::bigint WHERE id = $2 AND user_id = $3::uuid`,
      [row.to, row.id, userId],
    );
  }

  await client.query("COMMIT");
  console.log(`\n完成: 迁移 ${MIGRATE_ROWS.length} 删 ${DELETE_IDS.length}`);
  console.log(`备份: ${BACKUP_TABLE}`);
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
