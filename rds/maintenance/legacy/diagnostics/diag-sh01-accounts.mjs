#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

const userName = String(process.argv[2] || "SH01").trim();
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const { rows } = await pool.query(
  `SELECT id, user_name, accounts FROM profiles WHERE user_name ILIKE $1`,
  [userName],
);
if (!rows.length) {
  console.log(`no profile for ${userName}`);
  await pool.end();
  process.exit(0);
}
for (const row of rows) {
  const accounts = Array.isArray(row.accounts) ? row.accounts : [];
  console.log(`user=${row.user_name} id=${row.id} accountCount=${accounts.length}`);
  for (const a of accounts) {
    console.log(JSON.stringify({
      accountId: a.accountId ?? a.AccountId,
      playerName: a.playerName ?? a.PlayerName,
      provider: a.provider ?? a.Type,
      platformName: a.platformName ?? a.PlatformName,
      updateTime: a.updateTime ?? a.UpdateTime,
    }));
  }
}
await pool.end();
