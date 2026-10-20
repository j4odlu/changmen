#!/usr/bin/env node
/**
 * 核对 storage/*.json 与 RDS tag_platforms/players 是否一致。
 *
 *   cd changmen/server/backend && node scripts/ops/migrations/check-players-rds-migrate.mjs
 */

import { getPgPool, initDatabaseUrl } from "@changmen/db";
import { readJsonFile } from "@changmen/storage/json_file_store.js";

function rowId(row) {
  return Number(row?.id ?? row?.ID ?? row?.playerId ?? 0);
}

await initDatabaseUrl();
const pool = getPgPool();
if (!pool) {
  console.error("[check] 无 DATABASE_URL");
  process.exit(1);
}

const tagJson = readJsonFile("tag_platforms", {}) || {};
const playersJson = readJsonFile("players", {}) || {};
const tpEntries = Object.values(tagJson);
const plEntries = Object.values(playersJson);

const { rows: [counts] } = await pool.query(`
  SELECT
    (SELECT COUNT(*)::int FROM tag_platforms) AS tag_platforms,
    (SELECT COUNT(*)::int FROM players) AS players,
    (SELECT COUNT(*)::int FROM players WHERE deleted_at IS NULL) AS players_active
`);

const tpIds = tpEntries.map(rowId).filter(Boolean);
const plIds = plEntries.map(rowId).filter(Boolean);

const missingTp = [];
if (tpIds.length) {
  const { rows } = await pool.query(
    "SELECT id FROM tag_platforms WHERE id = ANY($1::bigint[])",
    [tpIds],
  );
  const have = new Set(rows.map(r => Number(r.id)));
  for (const id of tpIds) {
    if (!have.has(id))
      missingTp.push(id);
  }
}

const missingPl = [];
if (plIds.length) {
  const { rows } = await pool.query(
    "SELECT id FROM players WHERE id = ANY($1::bigint[])",
    [plIds],
  );
  const have = new Set(rows.map(r => Number(r.id)));
  for (const id of plIds) {
    if (!have.has(id))
      missingPl.push(id);
  }
}

const { rows: [seq] } = await pool.query(`
  SELECT
    (SELECT MAX(id) FROM tag_platforms) AS max_tag_platform_id,
    (SELECT MAX(id) FROM players) AS max_player_id,
    (SELECT last_value FROM tag_platforms_id_seq) AS tag_platforms_seq,
    (SELECT last_value FROM players_id_seq) AS players_seq
`);

const ok
  = missingTp.length === 0
    && missingPl.length === 0
    && counts.tag_platforms > 0
    && counts.players >= plEntries.filter(r => rowId(r) && Number(r?.platformId ?? r?.platform_id)).length;

const report = {
  ok,
  json: {
    tagPlatforms: tpEntries.length,
    players: plEntries.length,
  },
  rds: counts,
  sequences: seq,
  missingInRds: {
    tagPlatformIds: missingTp,
    playerIds: missingPl,
  },
};

console.log("[check-players-rds]", JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
