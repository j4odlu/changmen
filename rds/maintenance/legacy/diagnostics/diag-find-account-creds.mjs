#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const want = new Set([45, 46, 47, 48, 53, 14]);
const { rows } = await pool.query(`SELECT u.user_name, p.accounts FROM profiles p JOIN users u ON u.id = p.id`);
for (const row of rows) {
  for (const a of row.accounts || []) {
    const id = Number(a.accountId ?? a.AccountId);
    if (!want.has(id))
      continue;
    console.log(`\n${row.user_name} player ${id}:`);
    console.log(JSON.stringify({
      provider: a.provider ?? a.Type,
      platformName: a.platformName ?? a.PlatformName,
      playerName: a.playerName ?? a.PlayerName,
      hasToken: Boolean(a.token ?? a.Token),
      hasCookie: Boolean(a.cookie ?? a.Cookie),
      pause: a.pause ?? a.Pause,
      rateConfig: a.rateConfig ?? a.RateConfig,
    }));
  }
}
await pool.end();
