#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM users WHERE user_name ILIKE 'River'`)).rows[0].id;

const { rows } = await pool.query(
  `SELECT pl.id, pl.platform_name, pl.player_name, pl.provider, pl.deleted_at,
          (SELECT COUNT(*)::int FROM orders o WHERE o.user_id=$1 AND o.player_id=pl.id) AS orders,
          (SELECT COUNT(*)::int FROM money_logs m WHERE m.player_id=pl.id) AS money_logs
   FROM players pl
   WHERE pl.owner_user_id=$1::uuid AND pl.deleted_at IS NOT NULL
   ORDER BY pl.id`,
  [uid],
);
console.log("River 软删 player:", rows.length);
console.table(rows);
await pool.end();
