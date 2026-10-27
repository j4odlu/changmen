#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady } from "@changmen/db";
import { loadProfileById, pullProfilesFromDb, listAccountsForUser } from "../core/db/store.js";

loadChangmenEnv();
const pool = await ensurePgPoolReady();
await pullProfilesFromDb();

const { rows: users } = await pool.query(
  `SELECT u.id, u.user_name, u.is_admin, p.accounts, p.updated_at
   FROM users u JOIN profiles p ON p.id = u.id
   WHERE u.user_name ILIKE 'River'`,
);
const river = users[0];
console.log("River user:", river.user_name, river.id, "is_admin:", river.is_admin);
console.log("RDS accounts count:", (river.accounts || []).length);
for (const a of river.accounts || []) {
  console.log(" ", a.accountId, a.provider, a.platformName, a.playerName);
}

const mem = listAccountsForUser(river.id);
console.log("Memory cache count:", mem.length);

const ids = (river.accounts || []).map(a => Number(a.accountId ?? a.AccountId)).filter(Boolean);
if (ids.length) {
  const { rows: players } = await pool.query(
    `SELECT id, owner_user_id, platform_name, player_name, deleted_at
     FROM players WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [ids],
  );
  console.log("Player ownership:");
  for (const p of players) {
    const ok = p.owner_user_id === river.id ? "OK" : `MISMATCH owner=${p.owner_user_id}`;
    console.log(`  ${p.id} ${p.platform_name}/${p.player_name} deleted=${p.deleted_at} ${ok}`);
  }
}

const { rows: logs } = await pool.query(
  `SELECT create_at, title, LEFT(data, 120) AS data
   FROM user_logs WHERE user_id = $1
   ORDER BY create_at DESC LIMIT 8`,
  [river.id],
);
console.log("\nRecent logs:");
for (const l of logs) console.log(new Date(l.create_at).toISOString(), l.title, l.data?.slice(0, 80));

await pool.end();
