#!/usr/bin/env node
import { ensurePgPoolReady } from "@changmen/db";

const pool = await ensurePgPoolReady();
if (!pool) process.exit(1);
const now = Date.now();

for (const q of [
  [`platform_matches`, `
    SELECT platform, source_match_id, match_id, home, away, source_game_id, start_time, synced_at
    FROM platform_matches
    WHERE home ILIKE '%Psycho%' OR away ILIKE '%Psycho%' OR home ILIKE '%ENJOY%' OR away ILIKE '%ENJOY%'
    ORDER BY start_time DESC LIMIT 20`],
  [`client_matches`, `
    SELECT id, title, game, start_time, matchs, jsonb_array_length(COALESCE(bets,'[]'::jsonb)) as bets
    FROM client_matches
    WHERE title ILIKE '%Psycho%' OR title ILIKE '%ENJOY%'
    ORDER BY start_time DESC LIMIT 10`],
  [`client_matches_history`, `
    SELECT id, title, game, start_time, matchs, archived_at
    FROM client_matches_history
    WHERE title ILIKE '%Psycho%' OR title ILIKE '%ENJOY%'
    ORDER BY start_time DESC LIMIT 10`],
]) {
  console.log(`\n=== ${q[0]} ===`);
  const r = await pool.query(q[1]);
  if (!r.rows.length) console.log("(none)");
  for (const row of r.rows) {
    const extra = row.synced_at != null ? { synced_age_min: Math.round((now - Number(row.synced_at)) / 60000) } : {};
    console.log(JSON.stringify({ ...row, ...extra }));
  }
}

await pool.end();
