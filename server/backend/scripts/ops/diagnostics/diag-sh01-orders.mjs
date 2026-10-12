#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const { rows: users } = await pool.query(
  `SELECT id, user_name, created_at FROM users WHERE user_name ILIKE 'SH01'`,
);
const uid = users[0]?.id;
console.log("user:", users[0]);

if (uid) {
  const { rows: orderPlayers } = await pool.query(
    `SELECT DISTINCT player_id, provider, COUNT(*)::int AS n
     FROM ${financialOrdersRelation()} WHERE user_id = $1
     GROUP BY player_id, provider ORDER BY player_id`,
    [uid],
  );
  console.log("\n=== SH01 orders by player_id ===");
  for (const r of orderPlayers) console.log(r);

  const { rows: allUsers } = await pool.query(
    `SELECT user_name, jsonb_array_length(COALESCE(accounts,'[]'::jsonb)) AS n
     FROM profiles p JOIN users u ON u.id = p.id
     ORDER BY n DESC, user_name`,
  );
  console.log("\n=== all users account counts ===");
  for (const r of allUsers) console.log(`${r.user_name}\t${r.n}`);
}

await pool.end();
