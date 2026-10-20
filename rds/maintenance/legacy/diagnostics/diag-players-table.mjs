#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const { rows: players } = await pool.query(
  `SELECT id, platform_id, platform_name, player_name, deleted_at
   FROM players WHERE id = ANY($1::bigint[]) ORDER BY id`,
  [[5, 14, 45, 46, 47, 48, 53]],
);
console.log("players:");
for (const r of players) console.log(r);

const { rows: pb5 } = await pool.query(
  `SELECT id, platform_name, player_name FROM players
   WHERE platform_name ILIKE '%平博%' OR platform_name ILIKE '%PB%'
   ORDER BY id`,
);
console.log("\nall PB players:");
for (const r of pb5) console.log(r);

// sample order raw for river PM/PB
const { rows: samples } = await pool.query(
  `SELECT o.player_id, o.provider,
          o.raw->>'PlatformName' AS pn,
          o.raw->>'PlayerName' AS pl
   FROM ${financialOrdersRelation("o")} JOIN users u ON u.id = o.user_id
   WHERE u.user_name = 'River' AND o.player_id = ANY($1::bigint[])
   LIMIT 3`,
  [[45, 47, 48, 53, 14, 46]],
);
console.log("\nRiver order samples:");
for (const r of samples) console.log(r);

await pool.end();
