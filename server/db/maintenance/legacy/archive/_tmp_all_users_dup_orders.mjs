#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();

const { rows } = await pool.query(`
  WITH dup AS (
    SELECT o.user_id, o.provider, o.order_id, COUNT(*)::int AS rows
    FROM orders o
    GROUP BY o.user_id, o.provider, o.order_id
    HAVING COUNT(*) > 1
  ),
  user_agg AS (
    SELECT user_id,
           COUNT(*)::int AS dup_groups,
           SUM(rows - 1)::int AS extra_rows,
           SUM(rows)::int AS total_dup_rows
    FROM dup
    GROUP BY user_id
  ),
  provider_agg AS (
    SELECT user_id, provider, COUNT(*)::int AS n
    FROM dup
    GROUP BY user_id, provider
  )
  SELECT u.user_name,
         ua.user_id,
         ua.dup_groups,
         ua.extra_rows,
         ua.total_dup_rows,
         (SELECT jsonb_object_agg(provider, n ORDER BY provider)
          FROM provider_agg pa WHERE pa.user_id = ua.user_id) AS by_provider
  FROM user_agg ua
  JOIN users u ON u.id = ua.user_id
  ORDER BY ua.dup_groups DESC, u.user_name
`);

console.log(`全库有重复 order_id 的用户: ${rows.length}\n`);

if (!rows.length) {
  console.log("（无）");
}
else {
  console.log("user\t重复组\t多余副本\t组内总行\t按平台");
  for (const r of rows) {
    const prov = r.by_provider && typeof r.by_provider === "object"
      ? Object.entries(r.by_provider).map(([k, v]) => `${k}:${v}`).join(", ")
      : "-";
    console.log(`${r.user_name}\t${r.dup_groups}\t${r.extra_rows}\t${r.total_dup_rows}\t${prov}`);
  }
}

const totals = await pool.query(`
  SELECT COUNT(*)::int AS dup_groups,
         COALESCE(SUM(cnt - 1), 0)::int AS extra_rows
  FROM (
    SELECT COUNT(*)::int AS cnt
    FROM orders
    GROUP BY user_id, provider, order_id
    HAVING COUNT(*) > 1
  ) t
`);
console.log(`\n全库合计: ${totals.rows[0].dup_groups} 重复组, ${totals.rows[0].extra_rows} 条多余副本`);

await pool.end();
