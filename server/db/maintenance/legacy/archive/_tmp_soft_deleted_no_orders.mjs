#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();

const userFilter = process.argv.find(a => a.startsWith("--user="))?.slice(7) || "GB13";

const { rows } = await pool.query(
  `SELECT pl.id, u.user_name, pl.platform_name, pl.player_name, pl.provider,
          COUNT(o.id)::int AS orders
   FROM players pl
   JOIN users u ON u.id = pl.owner_user_id
   LEFT JOIN orders o ON o.player_id = pl.id AND o.user_id = pl.owner_user_id
   WHERE pl.deleted_at IS NOT NULL
     AND ($1 = '' OR u.user_name ILIKE $1)
   GROUP BY pl.id, u.user_name, pl.platform_name, pl.player_name, pl.provider
   ORDER BY u.user_name, pl.id`,
  [userFilter],
);

const empty = rows.filter(x => x.orders === 0);
const withOrders = rows.filter(x => x.orders > 0);

console.log(`user=${userFilter || "ALL"} 软删 player 共 ${rows.length}`);
console.log(`\n=== 无订单 (${empty.length}) ===`);
for (const x of empty) {
  console.log(`${x.id}\t${x.platform_name}/${x.player_name}\t${x.provider || "-"}`);
}

console.log(`\n=== 仍有订单 (${withOrders.length}) ===`);
for (const x of withOrders) {
  console.log(`${x.id}\t${x.platform_name}/${x.player_name}\torders=${x.orders}`);
}

await pool.end();
