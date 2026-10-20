#!/usr/bin/env node
/**
 * 将早期 Polymarket match-scoped 队伍 ID 迁移为稳定队伍 ID。
 *
 * 旧 ID 形如：<sourceMatchId>:home:<teamName> / <sourceMatchId>:away:<teamName>
 * 新 ID 形如：<gameCode>:<normalizedTeamName>
 *
 * 默认 dry-run：
 *   cd changmen/server/backend && node scripts/migrate-polymarket-team-ids.mjs
 * 执行写入：
 *   cd changmen/server/backend && node scripts/migrate-polymarket-team-ids.mjs --execute
 */

import {
  getPgPool,
  initDatabaseUrl,
} from "@changmen/db";

const execute = process.argv.includes("--execute");

function normalizePolymarketTeamName(name) {
  const normalized = String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u4E00-\u9FFF]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

function stablePolymarketTeamId(game, name) {
  const code = String(game || "").trim();
  if (!code)
    return "";
  return `${code}:${normalizePolymarketTeamName(name)}`;
}

function parseLegacyPolymarketTeamId(venueId) {
  const text = String(venueId || "");
  const m = /^([^:]+):(home|away):(.+)$/.exec(text);
  if (!m)
    return null;
  return { sourceMatchId: m[1], side: m[2], name: m[3] };
}

await initDatabaseUrl();
const pool = getPgPool();
if (!pool) {
  console.error("[polymarket-team-ids] 无 DATABASE_URL / PG pool");
  process.exit(2);
}

try {
  const { rows } = await pool.query(
    `SELECT gb_team_id, venue, venue_team_id, venue_name, game, source, confidence
     FROM team_venue_maps
     WHERE venue = 'Polymarket'
     ORDER BY id`,
  );

  const toWriteByKey = new Map();
  const skipped = [];
  for (const row of rows) {
    const legacy = parseLegacyPolymarketTeamId(row.venue_team_id);
    if (!legacy)
      continue;
    const nextId = stablePolymarketTeamId(row.game, row.venue_name || legacy.name);
    if (!nextId) {
      skipped.push({ venue_team_id: row.venue_team_id, reason: "missing_game" });
      continue;
    }
    if (nextId === row.venue_team_id)
      continue;
    const key = `Polymarket:${nextId}`;
    if (!toWriteByKey.has(key) || row.gb_team_id != null) {
      toWriteByKey.set(key, {
        gb_team_id: row.gb_team_id ?? null,
        legacy_venue_team_id: row.venue_team_id,
        venue: "Polymarket",
        venue_team_id: nextId,
        venue_name: row.venue_name || legacy.name,
        game: row.game,
        source: row.source || "migrate",
        confidence: row.confidence ?? 1.0,
      });
    }
  }

  const toWrite = [...toWriteByKey.values()];
  console.log("[polymarket-team-ids] legacy rows:", rows.filter(r => parseLegacyPolymarketTeamId(r.venue_team_id)).length);
  console.log("[polymarket-team-ids] new rows:", toWrite.length);
  if (skipped.length)
    console.log("[polymarket-team-ids] skipped:", JSON.stringify(skipped, null, 2));
  if (!toWrite.length) {
    console.log("[polymarket-team-ids] 无需迁移");
    process.exit(0);
  }
  console.log("[polymarket-team-ids] sample:", JSON.stringify(toWrite.slice(0, 10), null, 2));
  if (!execute) {
    console.log("[polymarket-team-ids] dry-run：加 --execute 才会写入 RDS");
    process.exit(0);
  }

  for (const row of toWrite) {
    await pool.query("BEGIN");
    try {
      if (row.gb_team_id != null) {
        await pool.query(
          `UPDATE team_venue_maps
           SET gb_team_id = NULL, source = 'legacy-polymarket-team-id'
           WHERE gb_team_id = $1
             AND venue = $2
             AND venue_name = $3
             AND venue_team_id <> $4`,
          [row.gb_team_id, row.venue, row.venue_name, row.venue_team_id],
        );
      }
      await pool.query(
        `INSERT INTO team_venue_maps (gb_team_id, venue, venue_team_id, venue_name, game, source, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (venue, venue_team_id) DO UPDATE SET
           gb_team_id = COALESCE(team_venue_maps.gb_team_id, EXCLUDED.gb_team_id),
           venue_name = EXCLUDED.venue_name,
           game = EXCLUDED.game,
           source = EXCLUDED.source,
           confidence = EXCLUDED.confidence`,
        [
          row.gb_team_id,
          row.venue,
          row.venue_team_id,
          row.venue_name,
          row.game,
          row.source || "migrate",
          row.confidence ?? 1.0,
        ],
      );
      await pool.query("COMMIT");
    }
    catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }
  console.log(`[polymarket-team-ids] 写入完成：${toWrite.length} 条`);
}
catch (err) {
  console.error("[polymarket-team-ids] 失败:", err.message);
  process.exit(1);
}
finally {
  await pool.end();
}
