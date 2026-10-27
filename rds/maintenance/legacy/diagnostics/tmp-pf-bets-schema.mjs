#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady } from "@changmen/db";
loadChangmenEnv();
const pool = await ensurePgPoolReady();
const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='platform_bets' ORDER BY ordinal_position`);
console.log(cols.rows.map(r => `${r.column_name}:${r.data_type}`).join("\n"));
const sample = await pool.query(`SELECT * FROM platform_bets WHERE platform='PredictFun' ORDER BY updated_at DESC LIMIT 5`);
console.log("sample", JSON.stringify(sample.rows, null, 2));
const cnt = await pool.query(`SELECT COALESCE(map, -1)::text AS m, COUNT(*)::int AS c FROM platform_bets WHERE platform='PredictFun' GROUP BY 1 ORDER BY 1`);
console.log("map dist", cnt.rows);
const astralis = await pool.query(`SELECT source_match_id, map, bet_name, home, away, home_odds, away_odds, updated_at FROM platform_bets WHERE platform='PredictFun' AND source_match_id IN ('222638','215815','222810') ORDER BY source_match_id, map`);
console.log("specific", astralis.rows);
await pool.end();
