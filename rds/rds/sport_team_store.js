/**
 * sport_canonical_teams / sport_team_venue_maps — N3 体育队名（与电竞表隔离）。
 */

import { _writeRds, getPgPool } from "./common.js";

async function rdsLoadAll(sql, params, mapRow) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const PAGE = 1000;
  const result = [];
  for (let off = 0; ; off += PAGE) {
    const { rows } = await pool.query(`${sql} OFFSET $${params.length + 1} LIMIT $${params.length + 2}`, [
      ...params,
      off,
      PAGE,
    ]);
    if (!rows.length)
      break;
    for (const row of rows) result.push(mapRow ? mapRow(row) : row);
    if (rows.length < PAGE)
      break;
  }
  return result;
}

/**
 * @param {string[]} [gamesCodes] 缺省加载全部体育队
 */
export async function fetchAllSportCanonicalTeams(gameCodes) {
  const games = Array.isArray(gameCodes) ? gameCodes.filter(Boolean).map(String) : [];
  if (games.length) {
    return rdsLoadAll(
      `SELECT id, gb_team_id, game, name, acronym
       FROM sport_canonical_teams
       WHERE game = ANY($1::text[])
       ORDER BY id`,
      [games],
      r => ({
        id: r.id,
        gb_team_id: r.gb_team_id,
        game: r.game,
        name: r.name,
        acronym: r.acronym,
      }),
    );
  }
  return rdsLoadAll(
    `SELECT id, gb_team_id, game, name, acronym FROM sport_canonical_teams ORDER BY id`,
    [],
    r => ({
      id: r.id,
      gb_team_id: r.gb_team_id,
      game: r.game,
      name: r.name,
      acronym: r.acronym,
    }),
  );
}

/**
 * @param {string[]} [gameCodes]
 */
export async function fetchAllSportTeamVenueMaps(gameCodes) {
  const games = Array.isArray(gameCodes) ? gameCodes.filter(Boolean).map(String) : [];
  if (games.length) {
    return rdsLoadAll(
      `SELECT gb_team_id, venue, venue_team_id, venue_name, game, source, confidence
       FROM sport_team_venue_maps
       WHERE game = ANY($1::text[])
       ORDER BY id`,
      [games],
      r => ({
        gb_team_id: r.gb_team_id,
        venue: r.venue,
        venue_team_id: r.venue_team_id,
        venue_name: r.venue_name,
        game: r.game,
        source: r.source,
        confidence: r.confidence,
      }),
    );
  }
  return rdsLoadAll(
    `SELECT gb_team_id, venue, venue_team_id, venue_name, game, source, confidence
     FROM sport_team_venue_maps
     ORDER BY id`,
    [],
    r => ({
      gb_team_id: r.gb_team_id,
      venue: r.venue,
      venue_team_id: r.venue_team_id,
      venue_name: r.venue_name,
      game: r.game,
      source: r.source,
      confidence: r.confidence,
    }),
  );
}

export async function nextSportManualGbTeamId() {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const { rows } = await pool.query(`SELECT next_sport_manual_gb_team_id() AS id`);
  return Number(rows[0]?.id);
}

/**
 * @param {{ game: string, name: string, acronym?: string, gb_team_id?: number, updated_by?: string }} row
 */
export async function upsertSportCanonicalTeam(row) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const game = String(row.game || "");
  const name = String(row.name || "").trim();
  if (!game || !name)
    throw new Error("sport canonical team 需要 game + name");

  let gb = row.gb_team_id != null ? Number(row.gb_team_id) : null;
  if (!Number.isFinite(gb) || gb <= 0)
    gb = await nextSportManualGbTeamId();

  const { rows } = await pool.query(
    `INSERT INTO sport_canonical_teams (gb_team_id, game, name, acronym, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (game, name) DO UPDATE SET
       acronym = COALESCE(EXCLUDED.acronym, sport_canonical_teams.acronym),
       updated_by = COALESCE(EXCLUDED.updated_by, sport_canonical_teams.updated_by),
       updated_at = now()
     RETURNING id, gb_team_id, game, name, acronym`,
    [
      gb,
      game,
      name,
      row.acronym != null ? String(row.acronym) : null,
      row.updated_by != null ? String(row.updated_by) : null,
    ],
  );
  return rows[0];
}

/**
 * @param {{ gb_team_id: number, venue: string, venue_team_id?: string, venue_name: string, game?: string, source?: string, confidence?: number }} row
 */
export async function upsertSportTeamVenueMap(row) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const gb = Number(row.gb_team_id);
  const venue = String(row.venue || "");
  const venueName = String(row.venue_name || "").trim();
  const game = row.game != null ? String(row.game) : null;
  if (!Number.isFinite(gb) || !venue || !venueName)
    throw new Error("sport team venue map 需要 gb_team_id + venue + venue_name");

  await pool.query(
    `INSERT INTO sport_team_venue_maps (
       gb_team_id, venue, venue_team_id, venue_name, game, source, confidence
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (venue, venue_team_id, game) DO UPDATE SET
       gb_team_id = EXCLUDED.gb_team_id,
       venue_name = EXCLUDED.venue_name,
       source = EXCLUDED.source,
       confidence = EXCLUDED.confidence`,
    [
      gb,
      venue,
      row.venue_team_id != null ? String(row.venue_team_id) : null,
      venueName,
      game,
      String(row.source || "manual"),
      row.confidence != null ? Number(row.confidence) : 1,
    ],
  );
}

export function saveSportTeamMappingFireAndForget(row) {
  _writeRds(() => upsertSportTeamVenueMap(row), "sport_team_venue_maps");
}
