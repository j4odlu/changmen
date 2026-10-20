#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB13'`)).rows[0].id;

const soft = await pool.query(
  `SELECT pl.id, pl.platform_name, pl.player_name, COUNT(o.id)::int AS n
   FROM players pl
   LEFT JOIN orders o ON o.player_id = pl.id AND o.user_id = $1
   WHERE pl.owner_user_id = $1 AND pl.deleted_at IS NOT NULL
   GROUP BY pl.id, pl.platform_name, pl.player_name
   HAVING COUNT(o.id) > 0
   ORDER BY pl.id`,
  [uid],
);
console.log("软删仍有订单:");
console.table(soft.rows);

const active = await pool.query(
  `SELECT o.player_id, pl.platform_name, COUNT(*)::int AS n
   FROM orders o
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1 AND pl.deleted_at IS NULL
   GROUP BY o.player_id, pl.platform_name
   ORDER BY o.player_id`,
  [uid],
);
console.log("\n活跃 player 订单总数:");
console.table(active.rows);

await pool.end();
