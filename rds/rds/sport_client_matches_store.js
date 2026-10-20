/**
 * sport_client_matches — N3 合并输出（按 sport 隔离；禁止写电竞 client_matches）。
 */

import { _jsonb, _writeRds, getPgPool } from "./common.js";

/** @type {ReadonlySet<string>} */
export const SPORT_MATCHER_TABLES = new Set([
  "sport_client_matches",
  "sport_client_matches_history",
  "sport_venue_matches",
  "sport_venue_bets",
  "sport_canonical_teams",
  "sport_team_venue_maps",
  "sport_client_match_venue_overrides",
]);

function _gbTeamIdForDb(value) {
  if (value == null || value === "")
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {string} sport
 * @returns {Promise<object[]>}
 */
export async function fetchSportClientMatches(sport) {
  const pool = getPgPool();
  if (!pool)
    return [];
  const { rows } = await pool.query(
    `SELECT id, sport, merge_key, title, game, game_id, start_time, bo, round, round_start,
            matchs, bets, reverse, built_at, home_gb_team_id, away_gb_team_id
     FROM sport_client_matches
     WHERE sport = $1
     ORDER BY start_time NULLS LAST, id`,
    [String(sport)],
  );
  return rows;
}

/**
 * 用当前活跃列表替换某 sport 下全部合并行（差量进 history）。
 * @param {string} sport
 * @param {object[]} rows
 */
export async function replaceSportClientMatches(sport, rows) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const sportKey = String(sport);
  const list = Array.isArray(rows) ? rows : [];
  const activeIds = list.map(r => Number(r.id)).filter(n => Number.isFinite(n) && n > 0);

  const client = await pool.connect();
  const upsertSql = `
    INSERT INTO sport_client_matches (
      id, sport, merge_key, title, game, game_id, start_time, bo, round, round_start,
      matchs, bets, reverse, built_at, home_gb_team_id, away_gb_team_id
    )
    SELECT * FROM unnest(
      $1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
      $7::bigint[], $8::integer[], $9::integer[], $10::bigint[],
      $11::jsonb[], $12::jsonb[], $13::jsonb[], $14::bigint[],
      $15::bigint[], $16::bigint[]
    )
    ON CONFLICT (id) DO UPDATE SET
      sport = EXCLUDED.sport,
      merge_key = EXCLUDED.merge_key,
      title = EXCLUDED.title,
      game = EXCLUDED.game,
      game_id = EXCLUDED.game_id,
      start_time = EXCLUDED.start_time,
      bo = EXCLUDED.bo,
      round = EXCLUDED.round,
      round_start = EXCLUDED.round_start,
      matchs = EXCLUDED.matchs,
      bets = EXCLUDED.bets,
      reverse = EXCLUDED.reverse,
      built_at = EXCLUDED.built_at,
      home_gb_team_id = COALESCE(EXCLUDED.home_gb_team_id, sport_client_matches.home_gb_team_id),
      away_gb_team_id = COALESCE(EXCLUDED.away_gb_team_id, sport_client_matches.away_gb_team_id)
  `;
  try {
    await client.query("BEGIN");
    if (list.length) {
      await client.query(upsertSql, [
        list.map(r => Number(r.id)),
        list.map(() => sportKey),
        list.map(r => (r.merge_key != null ? String(r.merge_key) : null)),
        list.map(r => String(r.title || "")),
        list.map(r => (r.game != null ? String(r.game) : null)),
        list.map(r => (r.game_id != null ? String(r.game_id) : null)),
        list.map(r => (r.start_time != null ? Number(r.start_time) : null)),
        list.map(r => (r.bo != null ? Number(r.bo) : null)),
        list.map(r => (r.round != null ? Number(r.round) : null)),
        list.map(r => Number(r.round_start) || 0),
        list.map(r => _jsonb(r.matchs, {})),
        list.map(r => _jsonb(r.bets, [])),
        list.map(r => _jsonb(r.reverse, [])),
        list.map(r => Number(r.built_at) || Date.now()),
        list.map(r => _gbTeamIdForDb(r.home_gb_team_id)),
        list.map(r => _gbTeamIdForDb(r.away_gb_team_id)),
      ]);
    }
    await client.query(
      `WITH moved AS (
         DELETE FROM sport_client_matches
         WHERE sport = $1
           AND NOT (id = ANY($2::bigint[]))
         RETURNING *
       )
       INSERT INTO sport_client_matches_history (
         id, sport, merge_key, title, game, game_id, start_time, bo, round, round_start,
         matchs, bets, reverse, built_at, home_gb_team_id, away_gb_team_id
       )
       SELECT id, sport, merge_key, title, game, game_id, start_time, bo, round, round_start,
              matchs, bets, reverse, built_at, home_gb_team_id, away_gb_team_id
       FROM moved`,
      [sportKey, activeIds],
    );
    await client.query("COMMIT");
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

export function writeSportClientMatchesAsync(sport, rows) {
  _writeRds(() => replaceSportClientMatches(sport, rows), `sport_client_matches:${sport}`);
}

/**
 * @param {number} clientMatchId
 * @param {string} venue
 * @param {'force_aligned'|'force_reversed'} mode
 */
export async function upsertSportClientMatchVenueOverride(clientMatchId, venue, mode) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  await pool.query(
    `INSERT INTO sport_client_match_venue_overrides (client_match_id, venue, mode, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (client_match_id, venue) DO UPDATE SET
       mode = EXCLUDED.mode,
       updated_at = now()`,
    [Number(clientMatchId), String(venue), String(mode)],
  );
}

/**
 * @param {number} clientMatchId
 * @returns {Promise<object[]>}
 */
export async function fetchSportClientMatchVenueOverrides(clientMatchId) {
  const pool = getPgPool();
  if (!pool)
    return [];
  const { rows } = await pool.query(
    `SELECT client_match_id, venue, mode, updated_at
     FROM sport_client_match_venue_overrides
     WHERE client_match_id = $1`,
    [Number(clientMatchId)],
  );
  return rows;
}
