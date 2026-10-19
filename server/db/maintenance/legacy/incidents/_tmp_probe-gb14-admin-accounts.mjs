#!/usr/bin/env node
/**
 * Probe what admin list would see for GB14 accounts (fresh from RDS).
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const { rows: u } = await pool.query(
  `SELECT id, user_name FROM users WHERE user_name ILIKE 'gb14'`,
);
console.log("user", u[0]);
const uid = u[0].id;

const { rows: active } = await pool.query(
  `SELECT id, provider, platform_name, player_name, deleted_at IS NOT NULL AS soft
   FROM players WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
   ORDER BY id`,
  [uid],
);
console.log(`GB14 active players (${active.length}):`);
for (const p of active)
  console.log(`  ${p.id}\t${p.provider}\t${p.platform_name}\t${p.player_name}`);

const { rows: ob } = await pool.query(
  `SELECT COUNT(*)::int AS n FROM players
   WHERE owner_user_id = $1::uuid AND deleted_at IS NULL AND UPPER(COALESCE(provider,''))='OB'`,
  [uid],
);
console.log("active OB count:", ob[0].n);

await pool.end();
