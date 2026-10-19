#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";
loadChangmenEnv();
const pool = await ensurePgPoolReady();

const cm = await pool.query(`
  SELECT id, title, reverse, matchs, home_gb_team_id, away_gb_team_id, game, built_at
  FROM client_matches
  WHERE title ILIKE '%Misa%' AND title ILIKE '%REBORN%'
     OR title ILIKE '%Reborn%'
  ORDER BY built_at DESC LIMIT 10
`);
console.log("=== client_matches ===");
for (const row of cm.rows) {
  console.log(JSON.stringify(row, null, 2));
}

for (const row of cm.rows) {
  const ids = Object.values(row.matchs || {});
  if (!ids.length) continue;
  const pm = await pool.query(`
    SELECT platform, source_match_id, home, away, home_id, away_id, match_id, start_time
    FROM platform_matches
    WHERE match_id = $1 OR source_match_id = ANY($2::text[])
    ORDER BY platform
  `, [row.id, ids]);
  console.log(`\n=== platform_matches for #${row.id} ===`);
  for (const p of pm.rows) console.log(JSON.stringify(p));

  const ov = await pool.query(`
    SELECT platform, mode FROM client_match_platform_overrides WHERE client_match_id = $1
  `, [row.id]);
  console.log("overrides:", JSON.stringify(ov.rows));

  if (row.home_gb_team_id && row.away_gb_team_id) {
    const gb = await pool.query(`
      SELECT gb_team_id, name, game FROM canonical_teams WHERE gb_team_id IN ($1, $2)
    `, [row.home_gb_team_id, row.away_gb_team_id]);
    console.log("canonical_teams:", JSON.stringify(gb.rows));
  }

  const maps = await pool.query(`
    SELECT venue, venue_team_id, venue_name, gb_team_id
    FROM team_venue_maps
    WHERE venue_name ILIKE '%Misa%' OR venue_name ILIKE '%REBORN%' OR venue_name ILIKE '%Reborn%'
    ORDER BY venue, venue_name LIMIT 40
  `);
  console.log("team_venue_maps (Misa/Reborn):");
  for (const m of maps.rows) console.log(JSON.stringify(m));
}

await pool.end();
