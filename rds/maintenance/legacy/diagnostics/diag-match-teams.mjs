#!/usr/bin/env node
import { ensurePgPoolReady } from "@changmen/db";
import { canonicalMatchKeyByName, normalizeTeam } from "@changmen/match-identity/teams/team_key.js";
import { normalizeEpochMs } from "@changmen/shared/time/match_time";

const terms = (process.argv[2] || "1w,INOX").split(",").map(s => s.trim()).filter(Boolean);
const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无法连接 RDS");
  process.exit(1);
}

const likeClauses = terms
  .flatMap(t => [`home ILIKE $p`, `away ILIKE $p`, `title ILIKE $p`])
  .join(" OR ");
const params = terms.map(t => `%${t}%`);

console.log("搜索词:", terms.join(", "), "\n");

const pm = await pool.query(
  `SELECT platform, source_match_id, match_id, home, away, source_game_id, start_time, synced_at, bo, home_id, away_id
   FROM platform_matches
   WHERE ${terms.map((_, i) => `(home ILIKE $${i + 1} OR away ILIKE $${i + 1})`).join(" OR ")}
   ORDER BY platform, start_time DESC NULLS LAST
   LIMIT 50`,
  params,
);

console.log(`platform_matches: ${pm.rows.length} 行\n`);
for (const r of pm.rows) {
  const st = normalizeEpochMs(r.start_time);
  const stIso = st ? new Date(st).toISOString() : "(无)";
  const nh = normalizeTeam(r.home);
  const na = normalizeTeam(r.away);
  const ck = canonicalMatchKeyByName(r.source_game_id, r.home, r.away);
  console.log(
    [
      `${r.platform}#${r.source_match_id}`,
      `match_id=${r.match_id ?? "NULL"}`,
      `${r.home} vs ${r.away}`,
      `game=${r.source_game_id}`,
      `start=${stIso}`,
      `norm=${nh} vs ${na}`,
      ck ? `mergeKey=${ck.mergeKey}` : "mergeKey=NULL",
    ].join(" | "),
  );
}

const cm = await pool.query(
  `SELECT id, title, game, game_id, start_time, matchs, built_at
   FROM client_matches
   WHERE ${terms.map((_, i) => `title ILIKE $${i + 1}`).join(" OR ")}
   ORDER BY id DESC LIMIT 20`,
  params,
);

console.log(`\nclient_matches: ${cm.rows.length} 行\n`);
for (const r of cm.rows) {
  const platforms = Object.keys(r.matchs || {});
  console.log(
    `#${r.id} platforms=[${platforms.join(",")}] | ${r.title} | matchs=${JSON.stringify(r.matchs)}`,
  );
}

// cross-platform: same normalized teams within 15min
if (pm.rows.length >= 2) {
  console.log("\n── 潜在可合并对（同 game_id + 归一化队名 + ±15min）──");
  const byKey = new Map();
  for (const r of pm.rows) {
    const ck = canonicalMatchKeyByName(r.source_game_id, r.home, r.away);
    if (!ck)
      continue;
    const list = byKey.get(ck.mergeKey) || [];
    list.push(r);
    byKey.set(ck.mergeKey, list);
  }
  for (const [key, rows] of byKey) {
    const platforms = new Set(rows.map(r => r.platform));
    if (platforms.size < 2) {
      console.log(`单平台组 ${key}: ${rows.map(r => r.platform).join(",")}`);
      continue;
    }
    const times = rows.map(r => normalizeEpochMs(r.start_time)).filter(Boolean);
    const maxDiff = times.length >= 2 ? Math.max(...times) - Math.min(...times) : 0;
    console.log(`多平台组 ${key} (${Math.round(maxDiff / 60000)}min 差):`);
    for (const r of rows) {
      console.log(`  ${r.platform} ${r.home} vs ${r.away} @ ${new Date(normalizeEpochMs(r.start_time)).toISOString()}`);
    }
  }
}

const obOnly = pm.rows.find(r => r.platform === "OB");
if (obOnly) {
  const maps = await pool.query(
    `SELECT tvm.venue, tvm.venue_team_id, tvm.venue_name, tvm.gb_team_id, ct.name
     FROM team_venue_maps tvm
     LEFT JOIN canonical_teams ct ON ct.gb_team_id = tvm.gb_team_id
     WHERE tvm.venue = 'OB'
       AND (tvm.venue_team_id = ANY($1::text[])
            OR tvm.venue_name ILIKE '%1w%'
            OR tvm.venue_name ILIKE '%inox%')`,
    [[obOnly.home_id, obOnly.away_id].filter(Boolean)],
  );
  console.log("\n── OB 队伍 ID / team_venue_maps ──");
  console.log("home_id:", obOnly.home_id, "away_id:", obOnly.away_id);
  console.log(JSON.stringify(maps.rows, null, 2));
}

await pool.end();
