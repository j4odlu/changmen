#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();
const pool = await ensurePgPoolReady();

const counts = await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(map, 0) = 0) AS map0,
    COUNT(*) FILTER (WHERE map > 0) AS mapn,
    COUNT(*) AS total
  FROM platform_bets
  WHERE platform = 'PredictFun'
    AND updated_at > (EXTRACT(EPOCH FROM NOW() - INTERVAL '6 hours') * 1000)::bigint
`);
console.log("PF bets last 6h:", counts.rows[0]);

const byMatch = await pool.query(`
  SELECT source_match_id,
         COUNT(*) AS bets,
         COUNT(*) FILTER (WHERE map > 0) AS mapn,
         ARRAY_AGG(DISTINCT map ORDER BY map) AS maps,
         MAX(home_name) AS sample_home,
         MAX(away_name) AS sample_away,
         MAX(updated_at) AS updated_at
  FROM platform_bets
  WHERE platform = 'PredictFun'
    AND updated_at > (EXTRACT(EPOCH FROM NOW() - INTERVAL '6 hours') * 1000)::bigint
  GROUP BY source_match_id
  ORDER BY MAX(updated_at) DESC
  LIMIT 20
`);
console.log("\nby match:");
for (const r of byMatch.rows) {
  console.log(
    `${r.source_match_id} bets=${r.bets} mapn=${r.mapn} maps=${JSON.stringify(r.maps)} ${r.sample_home} vs ${r.sample_away}`,
  );
}

const sampleMaps = await pool.query(`
  SELECT source_match_id, map, bet_name, home_name, away_name, home_odds, away_odds
  FROM platform_bets
  WHERE platform = 'PredictFun'
    AND map > 0
    AND updated_at > (EXTRACT(EPOCH FROM NOW() - INTERVAL '6 hours') * 1000)::bigint
  ORDER BY updated_at DESC
  LIMIT 20
`);
console.log("\nmap>0 sample:", sampleMaps.rows.length);
for (const r of sampleMaps.rows)
  console.log(`  ${r.source_match_id} m${r.map} ${r.bet_name} ${r.home_name}/${r.away_name} ${r.home_odds}/${r.away_odds}`);

const mcon = await pool.query(`
  SELECT source_match_id, map, bet_name, home_name, away_name, home_odds, away_odds, match_id
  FROM platform_bets
  WHERE platform = 'PredictFun'
    AND (home_name ILIKE '%mcon%' OR away_name ILIKE '%mcon%'
      OR home_name ILIKE '%once upon%' OR away_name ILIKE '%once upon%')
  ORDER BY source_match_id, map
`);
console.log("\nmCon/OUAT PF bets:", mcon.rows.length);
for (const r of mcon.rows)
  console.log(`  mid=${r.match_id} src=${r.source_match_id} m${r.map} ${r.bet_name} ${r.home_name} vs ${r.away_name} odds=${r.home_odds}/${r.away_odds}`);

await pool.end();
