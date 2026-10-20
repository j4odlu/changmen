#!/usr/bin/env node
/**
 * Fix MOUZ NXT team_venue_maps wrongly sharing gb_team_id 100790 with Bushido Wildcats.
 * MOUZ NXT → 100791, Bushido Wildcats stays 100790.
 * Usage: node scripts/fix-mouz-nxt-gb-team-id.mjs [--dry-run|--execute]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();

const MOUZ_GB = "100791";
const BUSHIDO_GB = "100790";
const dryRun = !process.argv.includes("--execute");

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("no pool");
  process.exit(1);
}

const wrongMouz = await pool.query(
  `SELECT id, gb_team_id, venue, venue_team_id, venue_name FROM team_venue_maps
   WHERE gb_team_id = $1
     AND (venue_name ILIKE '%mouz nxt%' OR venue_name ILIKE 'mouz nxt')`,
  [BUSHIDO_GB],
);
console.log("MOUZ NXT maps wrongly on %s:", BUSHIDO_GB, wrongMouz.rows);

const obPending = await pool.query(
  `SELECT id, gb_team_id, venue, venue_team_id, venue_name FROM team_venue_maps
   WHERE venue = 'OB' AND venue_name = 'MOUZ NXT' AND game = 'cs2' AND gb_team_id IS NULL`,
);
console.log("OB MOUZ NXT pending:", obPending.rows);

if (dryRun) {
  console.log("\n[dry-run] would set %d venue maps → gb_team_id %s", wrongMouz.rows.length + obPending.rows.length, MOUZ_GB);
  await pool.end();
  process.exit(0);
}

const ids = [...wrongMouz.rows.map(r => r.id), ...obPending.rows.map(r => r.id)];
const updated = await pool.query(
  `UPDATE team_venue_maps
   SET gb_team_id = $1, source = 'manual'
   WHERE id = ANY($2::bigint[])
   RETURNING id, venue, venue_name, gb_team_id`,
  [MOUZ_GB, ids],
);
console.log("updated:", updated.rows);

const verify = await pool.query(
  `SELECT gb_team_id, venue, venue_name FROM team_venue_maps
   WHERE gb_team_id IN ($1, $2)
   ORDER BY gb_team_id, venue, venue_name`,
  [BUSHIDO_GB, MOUZ_GB],
);
console.log("\nafter verify:");
for (const r of verify.rows) {
  console.log(`  ${r.gb_team_id} | ${r.venue} | ${r.venue_name}`);
}

await pool.end();
