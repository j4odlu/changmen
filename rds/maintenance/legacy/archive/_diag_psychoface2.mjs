#!/usr/bin/env node
import { ensurePgPoolReady } from "@changmen/db";
const pool = await ensurePgPoolReady();
const ts = 1783422960000;

const q1 = await pool.query(`
  SELECT platform, source_match_id, match_id, home, away, source_game_id, start_time
  FROM platform_matches
  WHERE start_time BETWEEN $1 - 7200000 AND $1 + 7200000
    AND (home ILIKE '%Psycho%' OR away ILIKE '%Psycho%' OR home ILIKE '%ENJOY%' OR away ILIKE '%ENJOY%')
  ORDER BY platform, start_time
`, [ts]);
console.log("=== platform_matches ±2h same teams ===");
for (const r of q1.rows) console.log(JSON.stringify(r));

const q2 = await pool.query(`
  SELECT COUNT(*)::int as c FROM platform_bets WHERE platform='RAY' AND source_match_id='38405081'
`);
console.log("\nRAY 38405081 platform_bets:", q2.rows[0].c);

const q3 = await pool.query(`
  SELECT gb_team_id, venue, venue_team_id, venue_name, game FROM team_venue_maps
  WHERE venue_name ILIKE '%Psycho%' OR venue_name ILIKE '%ENJOY%'
  ORDER BY venue, venue_name LIMIT 30
`);
console.log("\n=== team_venue_maps ===");
for (const r of q3.rows) console.log(JSON.stringify(r));

// CSGO matches around same time on other platforms
const q4 = await pool.query(`
  SELECT platform, source_match_id, home, away, start_time, match_id
  FROM platform_matches
  WHERE source_game_id IN ('140', '3', 'cs2') AND start_time BETWEEN $1 - 3600000 AND $1 + 3600000
  ORDER BY ABS(start_time - $1), platform
  LIMIT 25
`, [ts]);
console.log("\n=== CS2 matches ±1h around PsychoFace start ===");
for (const r of q4.rows) console.log(JSON.stringify(r));

await pool.end();
