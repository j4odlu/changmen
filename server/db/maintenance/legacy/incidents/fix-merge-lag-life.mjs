#!/usr/bin/env node
/**
 * Merge Life's A Game (100767) into LAG Gaming (100766), then clear stale override if needed.
 * Usage: node scripts/fix-merge-lag-life.mjs [--dry-run|--execute]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, reassignGbTeamId } from "@changmen/db";

loadChangmenEnv();

const dryRun = !process.argv.includes("--execute");
const FROM = "100767"; // Life's A Game
const TO = "100766"; // LAG Gaming

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("no pool");
  process.exit(1);
}

const before = await pool.query(
  `SELECT id, gb_team_id, venue, venue_team_id, venue_name FROM team_venue_maps
   WHERE gb_team_id IN ($1, $2) ORDER BY gb_team_id, venue`,
  [FROM, TO],
);
console.log("before maps:", before.rows);

const canon = await pool.query(
  `SELECT id, gb_team_id, name, game FROM canonical_teams WHERE gb_team_id IN ($1, $2)`,
  [FROM, TO],
);
console.log("canonical:", canon.rows);

if (dryRun) {
  console.log("\n[dry-run] would reassignGbTeamId(%s → %s) and soft-retire canonical %s", FROM, TO, FROM);
  await pool.end();
  process.exit(0);
}

const n = await reassignGbTeamId(FROM, TO);
console.log("reassigned maps:", n);

// Soft-retire loser canonical row (keep history; clear gb_team_id)
const retired = await pool.query(
  `UPDATE canonical_teams
   SET gb_team_id = NULL, updated_by = 'merge-lag-life', updated_at = NOW()
   WHERE gb_team_id = $1
   RETURNING id, name`,
  [FROM],
);
console.log("retired canonical:", retired.rows);

// Ensure OB Life map points to LAG
const check = await pool.query(
  `SELECT id, gb_team_id, venue, venue_team_id, venue_name FROM team_venue_maps
   WHERE venue_team_id = '82520867761394394' OR gb_team_id IN ($1, $2)
   ORDER BY gb_team_id, venue`,
  [FROM, TO],
);
console.log("after:", check.rows);

await pool.end();
