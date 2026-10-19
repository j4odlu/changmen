#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

const userName = String(process.argv[2] || "SH01").trim();
loadChangmenEnv();
const pool = await ensurePgPoolReady();

const { rows: profiles } = await pool.query(
  `SELECT id, user_name, accounts FROM profiles WHERE user_name ILIKE $1`,
  [userName],
);
if (!profiles.length) {
  console.log("no profile");
  await pool.end();
  process.exit(0);
}

const sh01 = profiles[0];
const ids = new Set((sh01.accounts || []).map(a => Number(a.accountId ?? a.AccountId)));

const { rows: all } = await pool.query(`SELECT user_name, accounts FROM profiles`);
console.log("=== SH01 account ids shared with other users ===");
for (const id of ids) {
  const owners = all
    .filter(p => (p.accounts || []).some(a => Number(a.accountId ?? a.AccountId) === id))
    .map(p => p.user_name);
  if (owners.length > 1) {
    console.log(`playerId ${id} in: ${owners.join(", ")}`);
  }
}

const { rows: logs } = await pool.query(
  `SELECT created_at, title, data
   FROM user_logs
   WHERE user_id = $1
   ORDER BY created_at DESC
   LIMIT 50`,
  [sh01.id],
);
console.log("\n=== recent user_logs (titles) ===");
for (const row of logs) {
  const t = String(row.title || "");
  if (/账号|ACCOUNT|SaveData|CreateTag|登录|login/i.test(t) || t.includes("SH01")) {
    console.log(new Date(Number(row.created_at)).toISOString(), t.slice(0, 120));
  }
}

const { rows: players } = await pool.query(
  `SELECT id, platform_name, player_name, created_at, updated_at
   FROM players WHERE id = ANY($1::int[]) ORDER BY id`,
  [[...ids]],
);
console.log("\n=== players table ===");
for (const p of players) {
  console.log(JSON.stringify({
    id: p.id,
    platform: p.platform_name,
    name: p.player_name,
    created: new Date(Number(p.created_at)).toISOString(),
    updated: new Date(Number(p.updated_at)).toISOString(),
  }));
}

await pool.end();
