#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const r = await pool.query(`SELECT accounts FROM profiles WHERE user_name = $1`, ["River"]);
for (const a of r.rows[0].accounts ?? []) {
  console.log(JSON.stringify({
    name: a.playerName ?? a.PlayerName,
    provider: a.provider ?? a.Type,
    id: a.accountId ?? a.AccountId,
    rateConfig: a.rateConfig ?? a.RateConfig,
    markupOnly: a.markupOnly,
    noMarkup: a.noMarkup,
  }));
}
await pool.end();
