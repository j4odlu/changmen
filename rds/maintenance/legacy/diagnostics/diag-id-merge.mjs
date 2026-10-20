#!/usr/bin/env node
import { ensurePgPoolReady } from "@changmen/db";

const obSourceId = process.argv[2] || "4338949224517918";
const pool = await ensurePgPoolReady();
if (!pool)
  process.exit(1);

const pm = await pool.query(
  `SELECT platform, source_match_id, match_id, home, away, home_id, away_id, source_game_id, start_time
   FROM platform_matches
   WHERE source_match_id = $1
      OR match_id = 291
      OR (home ILIKE '%1w%' AND away ILIKE '%INOX%')
   ORDER BY platform`,
  [obSourceId],
);

console.log("platform_matches:\n");
for (const r of pm.rows) {
  console.log(JSON.stringify(r));
}

const allIds = pm.rows.flatMap(r => [r.home_id, r.away_id]).filter(Boolean);
const maps = await pool.query(
  `SELECT tvm.venue, tvm.venue_team_id, tvm.venue_name, tvm.gb_team_id, ct.name AS canonical_name, ct.game
   FROM team_venue_maps tvm
   LEFT JOIN canonical_teams ct ON ct.gb_team_id = tvm.gb_team_id
   WHERE tvm.venue_team_id = ANY($1::text[])
      OR (tvm.venue_name ILIKE '%1w%' OR tvm.venue_name ILIKE '%inox%')
   ORDER BY tvm.venue, tvm.gb_team_id`,
  [allIds],
);

console.log("\nteam_venue_maps (by venue_team_id + name search):\n");
for (const m of maps.rows) {
  console.log(JSON.stringify(m));
}

const cm = await pool.query(
  `SELECT id, title, game_id, start_time, merge_key, matchs FROM client_matches WHERE id = 291`,
);
console.log("\nclient_match #291:", cm.rows[0]);

await pool.end();
