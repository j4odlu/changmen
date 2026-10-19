#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const r = await pool.query(`
  SELECT id, title, reverse, matchs, home_gb_team_id, away_gb_team_id, built_at
  FROM client_matches
  WHERE title ILIKE '%Mandatory%' OR title ILIKE '%FOKUS%' OR title ILIKE '%Fokus%'
  ORDER BY built_at DESC LIMIT 5
`);
console.log("client_matches:");
for (const row of r.rows) {
  console.log(JSON.stringify(row, null, 2));
}
const pm = await pool.query(`
  SELECT platform, source_match_id, home, away, match_id
  FROM platform_matches
  WHERE home ILIKE '%Mandatory%' OR away ILIKE '%Mandatory%'
     OR home ILIKE '%FOKUS%' OR away ILIKE '%FOKUS%'
  ORDER BY platform LIMIT 30
`);
console.log("platform_matches:");
for (const row of pm.rows) {
  console.log(JSON.stringify(row));
}
if (r.rows[0]?.id) {
  const ov = await pool.query(`
    SELECT * FROM client_match_platform_overrides WHERE client_match_id = $1
  `, [r.rows[0].id]);
  console.log("overrides:", JSON.stringify(ov.rows, null, 2));
  const gb = await pool.query(`
    SELECT gb_team_id, name, game FROM canonical_teams WHERE gb_team_id IN ($1, $2)
  `, [r.rows[0].home_gb_team_id, r.rows[0].away_gb_team_id]);
  console.log("canonical_teams:", JSON.stringify(gb.rows, null, 2));
  const maps = await pool.query(`
    SELECT venue, venue_team_id, venue_name, gb_team_id
    FROM team_venue_maps
    WHERE gb_team_id IN ($1, $2) OR venue_name ILIKE '%Mandatory%' OR venue_name ILIKE '%FOKUS%'
    ORDER BY venue, gb_team_id LIMIT 30
  `, [r.rows[0].home_gb_team_id, r.rows[0].away_gb_team_id]);
  console.log("team_venue_maps:", JSON.stringify(maps.rows, null, 2));
}
await pool.end();
