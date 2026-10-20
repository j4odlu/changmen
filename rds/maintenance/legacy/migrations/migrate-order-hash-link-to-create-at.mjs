#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 将旧 changmen hash 占位 link 批量改为 create_at（下单时间 ms），便于侧栏按 Link 降序排序。
 *
 *   cd changmen/server/backend
 *   node scripts/ops/migrations/migrate-order-hash-link-to-create-at.mjs          # 仅预览
 *   node scripts/ops/migrations/migrate-order-hash-link-to-create-at.mjs --execute
 */
import { ARB_LINK_MIN, getPgPool } from "@changmen/db";

const execute = process.argv.includes("--execute");
const pool = getPgPool();
if (!pool) {
  console.error("无 DATABASE_URL / PG pool");
  process.exit(2);
}

/** 与 isHashLink 一致：0 / null 或 0 < link < 1e12 */
const WHERE_HASH = `
  create_at > 0
  AND (
    link IS NULL
    OR link = 0
    OR (link > 0 AND link < ${ARB_LINK_MIN})
  )
`;

const countRes = await pool.query(
  `SELECT count(*)::int AS cnt FROM ${financialOrdersRelation()} WHERE ${WHERE_HASH}`,
);
const toUpdate = countRes.rows[0]?.cnt ?? 0;

const sampleRes = await pool.query(
  `SELECT user_id, order_id, player_id, provider, link, create_at
   FROM ${financialOrdersRelation()}
   WHERE ${WHERE_HASH}
   ORDER BY create_at DESC
   LIMIT 5`,
);

console.log(`--- migrate hash placeholder link → create_at (${execute ? "EXECUTE" : "DRY-RUN"}) ---`);
console.log({ rows_to_update: toUpdate });

if (sampleRes.rows.length) {
  console.log("--- sample before ---");
  for (const r of sampleRes.rows) {
    console.log({
      order_id: String(r.order_id).slice(0, 28),
      provider: r.provider,
      link: String(r.link),
      create_at: String(r.create_at),
    });
  }
}

if (!execute) {
  console.log("\n加 --execute 才会写入 RDS");
  await pool.end();
  process.exit(0);
}

if (toUpdate === 0) {
  console.log("无需更新");
  await pool.end();
  process.exit(0);
}

const upd = await pool.query(
  `UPDATE ${financialOrdersRelation()}
   SET link = create_at
   WHERE ${WHERE_HASH}`,
);
console.log({ updated: upd.rowCount });

const remainRes = await pool.query(
  `SELECT count(*)::int AS cnt FROM ${financialOrdersRelation()} WHERE ${WHERE_HASH}`,
);
console.log({ hash_placeholder_remaining: remainRes.rows[0]?.cnt ?? 0 });

const afterRes = await pool.query(
  `SELECT user_id, order_id, player_id, provider, link, create_at
   FROM ${financialOrdersRelation()}
   WHERE link = create_at AND create_at >= ${ARB_LINK_MIN}
   ORDER BY create_at DESC
   LIMIT 5`,
);
if (afterRes.rows.length) {
  console.log("--- sample after (link = create_at) ---");
  for (const r of afterRes.rows) {
    console.log({
      order_id: String(r.order_id).slice(0, 28),
      provider: r.provider,
      link: String(r.link),
      create_at: String(r.create_at),
    });
  }
}

await pool.end();
console.log("done");
