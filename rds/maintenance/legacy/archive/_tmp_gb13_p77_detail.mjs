#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB13'`)).rows[0].id;

const p77 = await pool.query(
  `SELECT id, platform_name, player_name, provider,
          account_data->>'gateway' AS gw,
          account_data->>'venueAccountName' AS van
   FROM players WHERE id=77`,
);
console.log("player 77:", p77.rows[0]);

const orders77 = await pool.query(
  `SELECT o.order_id, o.link, o.match, o.bet_money, o.status,
          to_char(to_timestamp(o.create_at/1000.0),'YYYY-MM-DD') AS dt
   FROM orders o WHERE user_id=$1 AND player_id=77 ORDER BY o.create_at`,
  [uid],
);
for (const o of orders77.rows) {
  const legs = await pool.query(
    `SELECT o.player_id, pl.platform_name, pl.player_name,
            pl.deleted_at IS NOT NULL AS soft, o.provider, o.link
     FROM orders o JOIN players pl ON pl.id=o.player_id
     WHERE o.user_id=$1 AND o.link=$2 AND o.player_id<>77`,
    [uid, o.link],
  );
  console.log("---", o.order_id, o.dt, o.match?.slice(0, 40));
  for (const l of legs.rows) {
    console.log(`  leg ${l.player_id} ${l.platform_name}/${l.provider} ${l.soft ? "SOFT" : "ACTIVE"}`);
  }
}

const dup = await pool.query(
  `SELECT o.id, o.player_id, pl.player_name, o.order_id, o.link, o.bet_money, o.match
   FROM orders o JOIN players pl ON pl.id=o.player_id
   WHERE o.user_id=$1 AND o.order_id IN ('1782743087574525866','1790174152687192203')
   ORDER BY o.order_id, o.player_id`,
  [uid],
);
console.log("\n=== dup 78/106 ===");
for (const r of dup.rows)
  console.log(r);

await pool.end();
