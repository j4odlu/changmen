#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB13'`)).rows[0].id;

const ids = ["1735298294147299082", "1791314984364202907", "1792532397322475707"];
for (const orderId of ids) {
  const { rows } = await pool.query(
    `SELECT o.id, o.player_id, pl.platform_name, o.link, o.bet_money, o.match
     FROM orders o JOIN players pl ON pl.id=o.player_id
     WHERE o.user_id=$1 AND o.order_id=$2 AND o.provider='OB' ORDER BY o.player_id`,
    [uid, orderId],
  );
  console.log(`\n${orderId} ${rows[0]?.match?.slice(0,40)}`);
  for (const r of rows) {
    const legs = await pool.query(
      `SELECT o.player_id, pl.platform_name, o.provider, o.link
       FROM orders o JOIN players pl ON pl.id=o.player_id
       WHERE o.user_id=$1 AND o.link=$2 AND NOT (o.player_id=$3 AND o.provider='OB')`,
      [uid, r.link, r.player_id],
    );
    console.log(`  pid=${r.player_id} ${r.platform_name} link=${r.link} legs=${JSON.stringify(legs.rows)}`);
  }
}
await pool.end();
