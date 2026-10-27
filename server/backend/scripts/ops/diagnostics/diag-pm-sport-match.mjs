#!/usr/bin/env node
/** 诊断单场 client_match 的 pm_sport + Gamma 源 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady } from "@changmen/db";
import { fetchGammaEventById, gammaEventToSportMessage } from "@changmen/polymarket-sports/gamma_map.js";
import { buildPmSportSnapshot } from "@changmen/polymarket-sports/parse_sport.js";

loadChangmenEnv();

const matchId = Number(process.argv[2] || 700);
const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无 DATABASE_URL");
  process.exit(1);
}

const cm = await pool.query(
  `SELECT id, title, game, start_time, built_at, pm_sport, matchs
   FROM client_matches WHERE id = $1`,
  [matchId],
);
const row = cm.rows[0];
if (!row) {
  console.error("client_match 不存在:", matchId);
  process.exit(1);
}

const pmEventId = row.matchs?.Polymarket ?? row.matchs?.polymarket;
console.log("=== client_matches ===");
console.log(JSON.stringify({
  id: row.id,
  title: row.title,
  game: row.game,
  start_time: row.start_time,
  built_at: row.built_at,
  pm_event_id: pmEventId,
  pm_sport: row.pm_sport,
}, null, 2));

const pmPlatform = await pool.query(
  `SELECT source_match_id, match_id, home, away, start_time, synced_at
   FROM platform_matches
   WHERE platform = 'Polymarket' AND match_id = $1`,
  [matchId],
);
console.log("\n=== platform_matches Polymarket ===");
console.log(JSON.stringify(pmPlatform.rows[0], null, 2));

await pool.end();

if (pmEventId) {
  console.log("\n=== Gamma GET /events/" + pmEventId + " (live) ===");
  const event = await fetchGammaEventById(String(pmEventId));
  if (!event) {
    console.log("Gamma 返回空");
  }
  else {
    console.log(JSON.stringify({
      id: event.id,
      title: event.title,
      slug: event.slug,
      gameId: event.gameId,
      live: event.live,
      ended: event.ended,
      score: event.score,
      period: event.period,
      elapsed: event.elapsed,
      startTime: event.startTime,
      resolutionSource: event.resolutionSource,
    }, null, 2));
    const msg = gammaEventToSportMessage(event);
    const snap = buildPmSportSnapshot(msg);
    console.log("\n=== changmen 会从 Gamma 推导出的 label ===");
    console.log(snap.label);
    console.log("status:", snap.status, "live:", snap.live, "ended:", snap.ended);
  }
}
