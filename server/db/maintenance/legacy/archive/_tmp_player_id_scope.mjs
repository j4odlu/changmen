#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
const r = await pool.query(`
  SELECT u.user_name,
         MIN(pl.id)::bigint AS min_id,
         MAX(pl.id)::bigint AS max_id,
         COUNT(*)::int AS n
  FROM players pl
  JOIN users u ON u.id = pl.owner_user_id
  GROUP BY u.user_name
  ORDER BY u.user_name
`);
console.log("各用户 player.id 范围（全局序列，非每用户自增）:\n");
console.table(r.rows);
const overlap = await pool.query(`
  SELECT pl.id, COUNT(DISTINCT pl.owner_user_id)::int AS users
  FROM players pl
  GROUP BY pl.id
  HAVING COUNT(DISTINCT pl.owner_user_id) > 1
`);
console.log(`id 跨用户重复: ${overlap.rows.length} 个`);
await pool.end();
