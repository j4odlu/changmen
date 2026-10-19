#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";
loadChangmenEnv();
const pool = await ensurePgPoolReady();

for (const q of ["FOKUS", "Misa", "MISA", "Mandatory"]) {
  const r = await pool.query(`
    SELECT gb_team_id, game, name, pandascore_id
    FROM canonical_teams
    WHERE name ILIKE $1 OR acronym ILIKE $1
    ORDER BY game, gb_team_id
  `, [`%${q}%`]);
  console.log(`\n=== canonical_teams like ${q} ===`);
  for (const row of r.rows) console.log(JSON.stringify(row));
}

const dup = await pool.query(`
  SELECT game, venue_name, COUNT(DISTINCT gb_team_id) AS gb_count,
         array_agg(DISTINCT gb_team_id) AS gb_ids
  FROM team_venue_maps
  WHERE gb_team_id IS NOT NULL
  GROUP BY game, venue_name
  HAVING COUNT(DISTINCT gb_team_id) > 1
  ORDER BY gb_count DESC, venue_name
  LIMIT 15
`);
console.log("\n=== venue_name -> multiple gb_team_id (same game) ===");
for (const row of dup.rows) console.log(JSON.stringify(row));

await pool.end();
