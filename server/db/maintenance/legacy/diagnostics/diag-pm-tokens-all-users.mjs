#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const ids = [45, 47, 48, 46];
const { rows } = await pool.query(`SELECT u.user_name, p.accounts FROM profiles p JOIN users u ON u.id = p.id`);
for (const row of rows) {
  for (const a of row.accounts || []) {
    const id = Number(a.accountId ?? a.AccountId);
    if (!ids.includes(id))
      continue;
    const token = a.token ?? a.Token;
    console.log(row.user_name, id, a.provider ?? a.Type, Boolean(token), (token || "").slice(0, 40));
  }
}
await pool.end();
