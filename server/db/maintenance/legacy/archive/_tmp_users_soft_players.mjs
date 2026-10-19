#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();

const { rows } = await pool.query(`
  SELECT u.user_name,
         COUNT(*)::int AS soft_players,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM orders o
             WHERE o.user_id = pl.owner_user_id AND o.player_id = pl.id
           )
         )::int AS with_orders,
         COALESCE(SUM((
           SELECT COUNT(*)::int FROM orders o
           WHERE o.user_id = pl.owner_user_id AND o.player_id = pl.id
         )), 0)::int AS order_rows
  FROM players pl
  JOIN users u ON u.id = pl.owner_user_id
  WHERE pl.deleted_at IS NOT NULL
  GROUP BY u.user_name
  ORDER BY soft_players DESC, u.user_name
`);

console.log(`有软删 player 的用户: ${rows.length}\n`);
if (!rows.length) {
  console.log("（无）");
}
else {
  console.log("user\t软删数\t有订单player数\t订单总行");
  for (const r of rows) {
    console.log(`${r.user_name}\t${r.soft_players}\t${r.with_orders}\t${r.order_rows}`);
  }
}

const detail = await pool.query(`
  SELECT u.user_name, pl.id, pl.platform_name, pl.player_name, pl.provider,
         (SELECT COUNT(*)::int FROM orders o WHERE o.user_id = pl.owner_user_id AND o.player_id = pl.id) AS orders
  FROM players pl
  JOIN users u ON u.id = pl.owner_user_id
  WHERE pl.deleted_at IS NOT NULL
  ORDER BY u.user_name, pl.id
`);

if (detail.rows.length) {
  console.log("\n明细:");
  for (const r of detail.rows) {
    console.log(`  ${r.user_name}\t${r.id}\t${r.platform_name}/${r.player_name}\t${r.provider || "-"}\torders=${r.orders}`);
  }
}

await pool.end();
