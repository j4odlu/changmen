#!/usr/bin/env node
/** Full account audit — players 为唯一真相 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";
import { playerRowToAccountRecord } from "../../../player_account_record.js";

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const { rows: players } = await pool.query(
  `SELECT pl.*, u.user_name, u.is_admin
   FROM players pl
   JOIN profiles p ON p.id = pl.owner_user_id
   JOIN users u ON u.id = p.id
   WHERE pl.deleted_at IS NULL
   ORDER BY u.user_name, pl.id`,
);

console.log("=== PLAYERS (source of truth) ===");
/** @type {Map<number, string[]>} */
const playerToUsers = new Map();
/** @type {Map<string, typeof players>} */
const byUser = new Map();
for (const row of players) {
  const uid = String(row.owner_user_id);
  if (!byUser.has(uid))
    byUser.set(uid, []);
  byUser.get(uid).push(row);
  if (!playerToUsers.has(row.id))
    playerToUsers.set(Number(row.id), []);
  playerToUsers.get(Number(row.id)).push(row.user_name);
}

for (const [uid, rows] of byUser) {
  const first = rows[0];
  console.log(`\n${first.user_name}${first.is_admin ? " [admin]" : ""} accounts=${rows.length}`);
  for (const row of rows) {
    const wire = playerRowToAccountRecord({
      id: row.id,
      platformId: row.platform_id,
      platformName: row.platform_name,
      playerName: row.player_name,
      provider: row.provider,
      credit: row.credit,
      totalBalance: row.total_balance,
      accountData: row.account_data,
      updatedAt: row.updated_at,
    });
    const tok = !!(wire.gateway || wire.token || wire.cookie);
    console.log(
      `  ${row.id}\t${wire.provider ?? "?"}\t${wire.platformName}\t${wire.playerName}\tcred=${tok}`,
    );
  }
}

console.log("\n=== CROSS-USER PLAYER IDS ===");
let cross = 0;
for (const [pid, users] of playerToUsers) {
  const uniq = [...new Set(users)];
  if (uniq.length > 1) {
    cross += 1;
    console.log(`  playerId ${pid} -> ${uniq.join(", ")}`);
  }
}
if (!cross)
  console.log("  (none)");

const { rows: ownerStats } = await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE deleted_at IS NULL) AS active,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND owner_user_id IS NULL) AS active_no_owner,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL) AS active_with_owner
  FROM players
`);
console.log("\n=== PLAYER STATS ===", ownerStats[0]);

const { rows: dupPm } = await pool.query(`
  SELECT u.user_name, COUNT(*) AS pm_count
  FROM players pl
  JOIN users u ON u.id = pl.owner_user_id
  WHERE pl.deleted_at IS NULL
    AND (
      LOWER(COALESCE(pl.provider, '')) LIKE '%polymarket%'
      OR LOWER(COALESCE(pl.platform_name, '')) IN ('pm', 'polymarket')
    )
  GROUP BY u.user_name
  HAVING COUNT(*) > 1
`);
console.log("\n=== USERS WITH >1 POLYMARKET ACCOUNT ===");
if (!dupPm.length)
  console.log("  (none)");
else
  for (const d of dupPm)
    console.log(`  ${d.user_name}: ${d.pm_count} PM accounts`);

const { rows: staleJsonb } = await pool.query(`
  SELECT u.user_name, jsonb_array_length(p.accounts) AS jsonb_count
  FROM profiles p
  JOIN users u ON u.id = p.id
  WHERE jsonb_array_length(COALESCE(p.accounts, '[]'::jsonb)) > 0
  ORDER BY u.user_name
`);
console.log("\n=== STALE profiles.accounts (未清空，只读对照) ===");
if (!staleJsonb.length)
  console.log("  (none)");
else
  for (const s of staleJsonb)
    console.log(`  ${s.user_name}: ${s.jsonb_count} rows in jsonb (ignored at runtime)`);

await pool.end();
