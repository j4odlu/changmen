import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB12'`)).rows[0].id;
const { rows } = await pool.query(
  `SELECT player_id, provider, link, match, bet, bet_money, status, order_id
   FROM orders WHERE user_id=$1 AND (
     order_id='1755673564733709942'
     OR link IN (1782633486863, -1782633486863, 1782633487047)
   ) ORDER BY provider, player_id`,
  [uid],
);
for (const r of rows) console.log(r);
await pool.end();
