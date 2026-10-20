#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const { rows } = await pool.query(
  `SELECT user_name, accounts, betting_config FROM profiles WHERE user_name = $1`,
  ["River"],
);
const p = rows[0];
const cfg = p.betting_config || {};
console.log("betting_config:", JSON.stringify({
  profit: cfg.profit,
  maxProfit: cfg.maxProfit,
  betMoney: cfg.betMoney,
  minMoney: cfg.minMoney,
  maxMoney: cfg.maxMoney,
  betting: cfg.betting,
  tenNumber: cfg.tenNumber,
}, null, 2));
for (const a of p.accounts || []) {
  const id = Number(a.accountId ?? a.AccountId);
  if (id === 46 || id === 47) {
    console.log("account", id, JSON.stringify({
      provider: a.provider,
      playerName: a.playerName,
      multiply: a.multiply,
      profit: a.profit,
    }));
  }
}

const rayOdds = 1.73;
const pmOdds = 2.7027;
const rayStake = 100;
const pmStake = 56;
const implied = 1 / (1 / rayOdds + 1 / pmOdds);
const hedgeFromRay = (rayOdds * rayStake) / pmOdds;
console.log("\narb math:");
console.log("implied", implied.toFixed(4), "margin%", ((implied - 1) * 100).toFixed(2));
console.log("hedge PM from RAY 100@", rayOdds, "->", hedgeFromRay.toFixed(2), "actual PM", pmStake);
console.log("if Alliance wins: PM", (pmStake * (pmOdds - 1)).toFixed(2), "RAY", -rayStake, "net", (pmStake * (pmOdds - 1) - rayStake).toFixed(2));
console.log("if NiP wins: RAY", (rayStake * (rayOdds - 1)).toFixed(2), "PM", -pmStake, "net", (rayStake * (rayOdds - 1) - pmStake).toFixed(2));

await pool.end();
