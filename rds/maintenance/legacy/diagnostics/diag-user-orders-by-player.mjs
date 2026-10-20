#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

const userName = String(process.argv[2] || "SH01").trim();
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const { rows: profiles } = await pool.query(
  `SELECT id FROM profiles WHERE user_name ILIKE $1`,
  [userName],
);
if (!profiles.length) {
  console.log(`no profile for ${userName}`);
  await pool.end();
  process.exit(0);
}
const uid = profiles[0].id;
const { rows } = await pool.query(
  `SELECT DISTINCT player_id, platform, COUNT(*)::int AS order_count
   FROM ${financialOrdersRelation()} WHERE user_id = $1
   GROUP BY player_id, platform ORDER BY player_id`,
  [uid],
);
console.log(`${userName} order history by player_id:`);
for (const row of rows) {
  console.log(`  player ${row.player_id}\t${row.platform}\torders=${row.order_count}`);
}
await pool.end();
