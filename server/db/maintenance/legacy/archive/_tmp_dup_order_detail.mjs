import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
const { initDatabaseUrl, getPgPool } = await import("@changmen/db");
await initDatabaseUrl();
const pool = getPgPool();
if (!pool) {
  console.error("DATABASE_URL 未配置或连接池不可用");
  process.exit(1);
}

const summary = await pool.query(`
  SELECT COUNT(*)::int AS dup_groups,
         COALESCE(SUM(cnt), 0)::int AS dup_rows_total
  FROM (
    SELECT order_id, COUNT(*)::int AS cnt
    FROM orders
    GROUP BY order_id
    HAVING COUNT(*) > 1
  ) t
`);

const rows = await pool.query(`
  WITH dup AS (
    SELECT order_id
    FROM orders
    GROUP BY order_id
    HAVING COUNT(*) > 1
  )
  SELECT
    o.order_id,
    COUNT(*) OVER (PARTITION BY o.order_id)::int AS dup_cnt,
    u.user_name,
    o.user_id,
    o.player_id,
    COALESCE(NULLIF(p.player_name, ''), NULLIF(p.venue_member_id, ''), '(empty)') AS player_name,
    p.venue_member_id,
    o.provider,
    o.status,
    o.bet_money,
    o.money,
    o.create_at,
    to_char(to_timestamp(o.create_at / 1000.0), 'YYYY-MM-DD HH24:MI:SS') AS create_at_local
  FROM orders o
  JOIN dup d ON d.order_id = o.order_id
  JOIN profiles pr ON pr.id = o.user_id
  JOIN users u ON u.id = pr.id
  LEFT JOIN players p ON p.id = o.player_id
  ORDER BY dup_cnt DESC, o.order_id, o.create_at, o.player_id
`);

const byProvider = await pool.query(`
  WITH dup AS (
    SELECT order_id FROM orders GROUP BY order_id HAVING COUNT(*) > 1
  )
  SELECT COALESCE(o.provider, '(null)') AS provider,
         COUNT(DISTINCT o.order_id)::int AS dup_order_ids,
         COUNT(*)::int AS dup_rows
  FROM orders o
  JOIN dup d ON d.order_id = o.order_id
  GROUP BY COALESCE(o.provider, '(null)')
  ORDER BY dup_rows DESC
`);

console.log("=== 汇总 ===");
console.log(JSON.stringify(summary.rows[0], null, 2));
console.log("\n=== 按 provider 分布 ===");
console.table(byProvider.rows);
console.log("\n=== 重复 order_id 明细（共", rows.rows.length, "行）===");
console.table(rows.rows);
await pool.end();
