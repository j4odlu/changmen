#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const r = await pool.query(
  `SELECT accounts, betting_config FROM profiles WHERE user_name = $1`,
  ["River"],
);
const cfg = r.rows[0].betting_config ?? {};
console.log("betting_config:", JSON.stringify({
  betting: cfg.betting,
  makeUp: cfg.makeUp,
  betMoney: cfg.betMoney,
  noSameBet: cfg.noSameBet,
  providerFixed: cfg.providerFixed,
  betSorting: cfg.betSorting,
}, null, 2));
for (const a of r.rows[0].accounts ?? []) {
  const id = a.accountId ?? a.AccountId;
  if (![47, "47"].includes(id) && String(a.playerName).toUpperCase() !== "D8F7")
    continue;
  console.log("D8F7:", JSON.stringify({
    accountId: id,
    provider: a.provider ?? a.Type,
    rateConfig: a.rateConfig ?? a.RateConfig,
    markupOnly: a.markupOnly,
    noMarkup: a.noMarkup,
    minOdds: a.minOdds,
    maxOdds: a.maxOdds,
    multiply: a.multiply,
  }, null, 2));
}
await pool.end();
