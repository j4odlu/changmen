#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * Delete all orders for a user.
 * Usage: node scripts/delete-user-orders.mjs <userName> [--dry-run]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";

const userName = String(process.argv[2] || "").trim();
const dryRun = process.argv.includes("--dry-run");
if (!userName) {
  console.error("Usage: node scripts/delete-user-orders.mjs <userName> [--dry-run]");
  process.exit(1);
}

loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();

const { rows: users } = await pool.query(
  `SELECT id, user_name FROM users WHERE user_name ILIKE $1`,
  [userName],
);
const user = users[0];
if (!user) {
  console.error(`user not found: ${userName}`);
  process.exit(1);
}

const uid = user.id;
const { rows: countRows } = await pool.query(
  `SELECT COUNT(*)::int AS n FROM ${financialOrdersRelation()} WHERE user_id = $1`,
  [uid],
);
const n = countRows[0]?.n ?? 0;
console.log(`${user.user_name} (${uid}): ${n} orders`);

if (dryRun) {
  console.log("[dry-run] no rows deleted");
  await pool.end();
  process.exit(0);
}

if (n === 0) {
  console.log("nothing to delete");
  await pool.end();
  process.exit(0);
}

const res = await pool.query(`DELETE FROM ${financialOrdersRelation()} WHERE user_id = $1`, [uid]);
console.log(`deleted ${res.rowCount} rows`);

const { rows: left } = await pool.query(
  `SELECT COUNT(*)::int AS n FROM ${financialOrdersRelation()} WHERE user_id = $1`,
  [uid],
);
console.log(`remaining: ${left[0]?.n ?? 0}`);
await pool.end();
