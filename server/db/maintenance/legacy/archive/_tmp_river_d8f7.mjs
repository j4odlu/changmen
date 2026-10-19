#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const r = await pool.query(`SELECT accounts FROM profiles WHERE user_name ILIKE 'River'`);
for (const a of r.rows[0]?.accounts || []) {
  const name = a.playerName ?? a.PlayerName ?? "";
  if (String(name).includes("D8F7") || (a.provider ?? a.Type) === "Polymarket") {
    console.log(JSON.stringify({
      id: a.accountId ?? a.AccountId,
      name,
      type: a.provider ?? a.Type,
      pause: a.pause ?? a.Pause,
      active: a.active ?? a.Active,
      rateConfig: a.rateConfig,
    }, null, 2));
  }
}
await pool.end();
