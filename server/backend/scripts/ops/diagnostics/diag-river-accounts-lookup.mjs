#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const { rows: profiles } = await pool.query(
  `SELECT u.user_name, p.id, p.accounts
   FROM profiles p JOIN users u ON u.id = p.id
   WHERE u.user_name ILIKE ANY($1::text[])`,
  [["River", "SH01", "GB12"]],
);

for (const row of profiles) {
  console.log(`\n=== ${row.user_name} ===`);
  for (const a of row.accounts || []) {
    console.log(JSON.stringify({
      accountId: a.accountId ?? a.AccountId,
      provider: a.provider ?? a.Type,
      platformName: a.platformName ?? a.PlatformName,
      playerName: a.playerName ?? a.PlayerName,
    }));
  }
}

const { rows: riverOrders } = await pool.query(
  `SELECT DISTINCT o.player_id, o.provider, COUNT(*)::int AS n
   FROM ${financialOrdersRelation("o")}
   JOIN users u ON u.id = o.user_id
   WHERE u.user_name ILIKE 'River'
   GROUP BY o.player_id, o.provider ORDER BY o.player_id`,
);
console.log("\n=== River order history ===");
for (const r of riverOrders) console.log(r);

const { rows: players } = await pool.query(
  `SELECT id, provider, platform_name, player_name FROM players
   WHERE id = ANY($1::bigint[]) ORDER BY id`,
  [[5, 14, 18, 45, 53]],
);
console.log("\n=== players lookup ===");
for (const r of players) console.log(r);

await pool.end();
