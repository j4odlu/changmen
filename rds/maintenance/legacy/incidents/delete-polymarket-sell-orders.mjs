#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * Delete Polymarket sell orders (raw.pmSide = 'sell' only).
 * Usage: node scripts/delete-polymarket-sell-orders.mjs [--dry-run] [--player-id=N] [--user=NAME]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { deletePolymarketSellOrders, ensurePgPoolReady, getPgPool } from "@changmen/db";

const dryRun = process.argv.includes("--dry-run");
const playerArg = process.argv.find(a => a.startsWith("--player-id="));
const userArg = process.argv.find(a => a.startsWith("--user="));
const playerId = playerArg ? Number(playerArg.split("=")[1]) : undefined;
const userName = userArg ? String(userArg.split("=")[1] || "").trim() : "";

loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();
if (!pool) {
  console.error("DATABASE_URL not configured");
  process.exit(1);
}

let userId;
if (userName) {
  const { rows } = await pool.query(
    `SELECT id, user_name FROM users WHERE user_name ILIKE $1`,
    [userName],
  );
  const user = rows[0];
  if (!user) {
    console.error(`user not found: ${userName}`);
    process.exit(1);
  }
  userId = user.id;
  console.log(`scope user: ${user.user_name} (${userId})`);
}

const params = [];
let where = `provider = 'Polymarket' AND raw->>'pmSide' = 'sell'`;
if (userId) {
  params.push(userId);
  where += ` AND user_id = $${params.length}::uuid`;
}
if (Number.isFinite(playerId) && playerId > 0) {
  params.push(playerId);
  where += ` AND player_id = $${params.length}`;
  console.log(`scope player_id: ${playerId}`);
}

const { rows: preview } = await pool.query(
  `SELECT id, order_id, player_id, item, create_at FROM ${financialOrdersRelation()} WHERE ${where} ORDER BY create_at DESC`,
  params,
);
console.log(`matched sell orders: ${preview.length}`);
for (const row of preview.slice(0, 20))
  console.log(`  id=${row.id} order_id=${row.order_id} player=${row.player_id} item=${row.item}`);
if (preview.length > 20)
  console.log(`  ... and ${preview.length - 20} more`);

if (dryRun) {
  console.log("[dry-run] no rows deleted");
  await pool.end();
  process.exit(0);
}

if (!preview.length) {
  console.log("nothing to delete");
  await pool.end();
  process.exit(0);
}

const { deleted, ids } = await deletePolymarketSellOrders({
  userId,
  playerId: Number.isFinite(playerId) && playerId > 0 ? playerId : undefined,
});
console.log(`deleted ${deleted} rows (ids: ${ids.join(", ")})`);
await pool.end();
