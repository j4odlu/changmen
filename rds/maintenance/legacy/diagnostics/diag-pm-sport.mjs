#!/usr/bin/env node
/** 诊断 Polymarket pm_sport 数据链 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getResolvedDatabaseLabel } from "@changmen/db";

loadChangmenEnv();

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无法连接 RDS：请检查 backend/.env 中的 DATABASE_URL");
  process.exit(1);
}

console.log(`[diag-pm-sport] DB=${getResolvedDatabaseLabel() || "connected"}\n`);

function fmtTs(raw) {
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0)
    return "(null)";
  return new Date(ms < 1e12 ? ms * 1000 : ms).toISOString();
}

const pmRows = await pool.query(
  `SELECT source_match_id, match_id, home, away, start_time, synced_at
   FROM platform_matches
   WHERE platform = 'Polymarket'
   ORDER BY synced_at DESC NULLS LAST
   LIMIT 10`,
);

console.log("=== platform_matches Polymarket (latest 10) ===");
console.log("rows:", pmRows.rowCount);
for (const r of pmRows.rows) {
  console.log(JSON.stringify({
    source_match_id: r.source_match_id,
    match_id: r.match_id,
    home: r.home,
    away: r.away,
    start_time: fmtTs(r.start_time),
    synced_at: fmtTs(r.synced_at),
  }));
}

const cmRows = await pool.query(
  `SELECT id, title, game, matchs->>'Polymarket' AS pm_id,
          pm_sport IS NOT NULL AS has_pm_sport, built_at
   FROM client_matches
   WHERE matchs ? 'Polymarket'
   ORDER BY built_at DESC
   LIMIT 10`,
);

console.log("\n=== client_matches with Polymarket (latest 10) ===");
console.log("rows:", cmRows.rowCount);
for (const r of cmRows.rows) {
  console.log(JSON.stringify({
    id: r.id,
    title: r.title,
    game: r.game,
    pm_id: r.pm_id,
    has_pm_sport: r.has_pm_sport,
    built_at: fmtTs(r.built_at),
  }));
}

const summary = await pool.query(
  `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE match_id IS NOT NULL)::int AS linked,
          COUNT(*) FILTER (WHERE match_id IS NULL)::int AS unlinked
   FROM platform_matches
   WHERE platform = 'Polymarket'`,
);
console.log("\n=== Polymarket platform_matches summary ===");
console.log(summary.rows[0]);

const pmSportCount = await pool.query(
  `SELECT COUNT(*)::int AS with_pm_sport FROM client_matches WHERE pm_sport IS NOT NULL`,
);
console.log("\n=== client_matches with pm_sport ===");
console.log(pmSportCount.rows[0]);

await pool.end();
