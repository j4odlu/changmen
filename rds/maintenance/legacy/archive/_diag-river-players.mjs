#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";

loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();

const { rows: river } = await pool.query(
  `SELECT p.id FROM profiles p JOIN users u ON u.id = p.id WHERE u.user_name ILIKE 'River'`,
);
const uid = river[0]?.id;
if (!uid) {
  console.error("River not found");
  process.exit(1);
}

const { rows: players } = await pool.query(
  `SELECT id, platform_id, platform_name, player_name, provider, deleted_at, created_at
   FROM players WHERE owner_user_id = $1::uuid ORDER BY id`,
  [uid],
);

const { rows: prof } = await pool.query(`SELECT accounts FROM profiles WHERE id = $1`, [uid]);
const jsonbIds = (prof[0]?.accounts || []).map(a => Number(a.accountId ?? a.AccountId)).filter(Boolean);

console.log("jsonb accountIds:", jsonbIds);
console.log("\nactive players:");
for (const p of players.filter(x => !x.deleted_at)) {
  const inJson = jsonbIds.includes(Number(p.id));
  console.log(`${p.id}\t${p.provider || "?"}\t${p.platform_name}\t${p.player_name}\tinJsonb=${inJson}`);
}

const { rows: ords } = await pool.query(
  `SELECT player_id, COUNT(*)::int AS n FROM orders WHERE user_id = $1::uuid GROUP BY player_id ORDER BY player_id`,
  [uid],
);
console.log("\norders by player_id:", ords);

await pool.end();
