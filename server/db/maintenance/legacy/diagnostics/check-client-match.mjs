#!/usr/bin/env node
/**
 * 诊断 client_match 是否在 Web 可见
 *   cd changmen/server/backend && node scripts/check-client-match.mjs 161
 */

import { ensurePgPoolReady, getResolvedDatabaseLabel } from "@changmen/db";

const matchId = Number(process.argv[2] || 161);
if (!Number.isFinite(matchId)) {
  console.error("用法: node scripts/check-client-match.mjs <client_match_id>");
  process.exit(1);
}

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无法连接 RDS：请检查 backend/.env 中的 DATABASE_URL");
  process.exit(1);
}

const label = getResolvedDatabaseLabel() || "connected";
console.log(`[check] client_match #${matchId} · DB=${label}\n`);

const cm = await pool.query(
  `SELECT id, title, game, start_time, bo, round, built_at, matchs, bets
   FROM client_matches WHERE id = $1`,
  [matchId],
);

if (!cm.rows.length) {
  console.log(`❌ client_matches 中不存在 id=${matchId}`);
  console.log("   → Web 不可见：活跃表只保存当前可见比赛，过期/隐藏行会进入 client_matches_history\n");
  const hist = await pool.query(
    `SELECT id, title, game, start_time, bo, round, built_at, archived_at, matchs, bets
     FROM client_matches_history WHERE id = $1
     ORDER BY archived_at DESC NULLS LAST
     LIMIT 1`,
    [matchId],
  );
  if (hist.rows.length) {
    const h = hist.rows[0];
    console.log("── client_matches_history ──");
    console.log("  title:       ", h.title);
    console.log("  archived_at: ", h.archived_at);
    console.log("  built_at:    ", h.built_at ? new Date(Number(h.built_at)).toISOString() : "(无)");
    console.log("  matchs:      ", JSON.stringify(h.matchs));
  }
}
else {
  const row = cm.rows[0];
  const platforms = Object.keys(row.matchs || {});
  const betCount = Array.isArray(row.bets) ? row.bets.length : 0;
  const startMs = Number(row.start_time) || 0;
  const startIso = startMs ? new Date(startMs < 1e12 ? startMs * 1000 : startMs).toISOString() : "(无)";

  console.log("── client_matches ──");
  console.log("  title:       ", row.title);
  console.log("  game:        ", row.game);
  console.log("  start_time:  ", startIso);
  console.log("  built_at:    ", row.built_at ? new Date(Number(row.built_at)).toISOString() : "(无)");
  console.log("  platforms:   ", platforms.join(", ") || "(空)", `(${platforms.length})`);
  console.log("  bets:        ", betCount, "条");
  console.log("  matchs:      ", JSON.stringify(row.matchs));
  console.log("\n✅ Web 应可见（存在于 client_matches 活跃表）");
  if (platforms.length < 2) {
    console.log("⚠️  平台数 < 2：下次 matchMerge 可能被 filterMultiPlatform 滤掉并删除");
  }
}

const pm = await pool.query(
  `SELECT platform, source_match_id, match_id, home, away, start_time, synced_at
   FROM platform_matches
   WHERE match_id = $1
      OR (platform = 'RAY' AND source_match_id = '38398938')
      OR (platform = 'IA' AND source_match_id = '373860')
   ORDER BY platform`,
  [matchId],
);

console.log("\n── platform_matches（RAY/IA 关联行）──");
if (!pm.rows.length) {
  console.log("  (无匹配行)");
}
else {
  const now = Date.now();
  for (const r of pm.rows) {
    const syncedRaw = r.synced_at;
    const syncedMs = syncedRaw != null ? Number(syncedRaw) : Number.NaN;
    const synced
      = Number.isFinite(syncedMs) && syncedMs > 0
        ? new Date(syncedMs < 1e12 ? syncedMs * 1000 : syncedMs).toISOString()
        : String(syncedRaw ?? "(无)");
    const ageMin
      = Number.isFinite(syncedMs) && syncedMs > 0
        ? Math.round((now - (syncedMs < 1e12 ? syncedMs * 1000 : syncedMs)) / 60000)
        : null;
    const stale = ageMin != null && ageMin > 60 ? " ⚠️ >1h 未刷新，可能被 archive" : "";
    console.log(
      `  ${r.platform} #${r.source_match_id} → match_id=${r.match_id ?? "NULL"} | ${r.home} vs ${r.away} | synced ${synced}${stale}`,
    );
  }
}

const vis = await pool.query(
  `SELECT COUNT(*)::int AS c FROM client_matches`,
);
console.log("\n── 汇总 ──");
console.log("  当前 Web 可见 client_matches 总数:", vis.rows[0].c);

const ferno = await pool.query(
  `SELECT id, title, matchs, built_at
   FROM client_matches
   WHERE title ILIKE '%Ferno%' OR title ILIKE '%Hastra%'
   ORDER BY id DESC LIMIT 5`,
);
if (ferno.rows.length) {
  console.log("\n── 队名含 Ferno/Hastra 的 client_matches ──");
  for (const r of ferno.rows) {
    console.log(`  #${r.id} | ${r.title} | matchs=${JSON.stringify(r.matchs)}`);
  }
}

const bySrc = await pool.query(
  `SELECT id, title, matchs
   FROM client_matches
   WHERE matchs::text LIKE '%38398938%' OR matchs::text LIKE '%373860%'
   LIMIT 5`,
);
if (bySrc.rows.length) {
  console.log("\n── matchs 含 RAY/IA source id 的行 ──");
  for (const r of bySrc.rows) {
    console.log(`  #${r.id} | ${r.title}`);
  }
}

await pool.end();
