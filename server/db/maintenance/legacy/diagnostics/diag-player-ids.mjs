#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
const ids = [5, 14, 45, 46, 47, 48, 53];
const { rows } = await pool.query(
  `SELECT id, data FROM kv_store WHERE key LIKE 'player:%' AND id = ANY($1::bigint[])`,
  [ids],
).catch(() => ({ rows: [] }));

// fallback: scan profiles for any account with these ids
const { rows: profs } = await pool.query(`SELECT accounts FROM profiles`);
const found = new Map();
for (const p of profs) {
  for (const a of p.accounts || []) {
    const id = Number(a.accountId ?? a.AccountId);
    if (ids.includes(id) && !found.has(id)) {
      found.set(id, a);
    }
  }
}
console.log("from profiles scan:");
for (const id of ids) {
  const a = found.get(id);
  if (a) {
    console.log(id, a.provider ?? a.Type, a.platformName ?? a.PlatformName, a.playerName ?? a.PlayerName);
  } else {
    console.log(id, "NOT FOUND in any profile");
  }
}
await pool.end();
