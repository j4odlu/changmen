#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const { rows } = await pool.query(
  `SELECT betting_config, accounts FROM profiles WHERE user_name='River'`,
);
const p = rows[0];
const cfg = p.betting_config;
const accs = (p.accounts || []).filter(a => [46, 47, 48].includes(Number(a.accountId)));
console.log(JSON.stringify({ betMoney: cfg.betMoney, accounts: accs }, null, 2));
await pool.end();
