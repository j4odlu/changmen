#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const names = ["SH01", "GB12", "River"];
const { rows } = await pool.query(
  `SELECT user_name, accounts, updated_at FROM profiles WHERE user_name = ANY($1::text[]) ORDER BY user_name`,
  [names],
);

for (const row of rows) {
  const accs = row.accounts || [];
  console.log(`\n=== ${row.user_name} count=${accs.length} profileUpdated=${row.updated_at} ===`);
  for (const a of accs) {
    console.log(
      `${a.accountId ?? a.AccountId}\t${a.provider ?? a.Type}\t${a.platformName ?? a.PlatformName}\t${a.playerName ?? a.PlayerName}`,
    );
  }
}

await pool.end();
