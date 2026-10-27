#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";

loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();

const { rows: riverOrders } = await pool.query(
  `SELECT DISTINCT o.player_id, o.provider, COUNT(*)::int AS n
   FROM ${financialOrdersRelation("o")} JOIN users u ON u.id = o.user_id
   WHERE u.user_name ILIKE 'River'
     AND o.provider IN ('PB', 'RAY', 'Polymarket')
   GROUP BY o.player_id, o.provider ORDER BY o.provider, n DESC`,
);
console.log("River PM/PB/RAY orders:");
for (const r of riverOrders) console.log(r);

const ids = [14, 46, 48, 53];
const { rows: players } = await pool.query(
  `SELECT id, platform_id, platform_name, player_name FROM players WHERE id = ANY($1::bigint[]) ORDER BY id`,
  [ids],
);
console.log("\nplayers:");
for (const r of players) console.log(r);

const { rows: profs } = await pool.query(`SELECT u.user_name, p.accounts FROM profiles p JOIN users u ON u.id = p.id`);
const want = new Set([14, 45, 46, 48, 53]);
console.log("\naccount creds in any profile:");
for (const row of profs) {
  for (const a of row.accounts || []) {
    const id = Number(a.accountId ?? a.AccountId);
    if (!want.has(id)) continue;
    console.log(row.user_name, id, a.provider ?? a.Type,
      a.platformName ?? a.PlatformName, a.playerName ?? a.PlayerName,
      "token", Boolean(a.token ?? a.Token));
  }
}

await pool.end();
