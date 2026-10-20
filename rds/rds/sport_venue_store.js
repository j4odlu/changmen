/**
 * sport_venue_matches / sport_venue_bets — N3 场馆原始赛程与盘口。
 */

import { _jsonb, _writeRds, getPgPool } from "./common.js";

/**
 * @param {string} sport
 * @param {string} [venue]
 * @returns {Promise<object[]>}
 */
export async function fetchSportVenueMatches(sport, venue) {
  const pool = getPgPool();
  if (!pool)
    return [];
  if (venue) {
    const { rows } = await pool.query(
      `SELECT sport, venue, source_match_id, match_id, source_game_id, start_time,
              home_id, home, away_id, away, teams, synced_at
       FROM sport_venue_matches
       WHERE sport = $1 AND venue = $2
       ORDER BY start_time NULLS LAST`,
      [String(sport), String(venue)],
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT sport, venue, source_match_id, match_id, source_game_id, start_time,
            home_id, home, away_id, away, teams, synced_at
     FROM sport_venue_matches
     WHERE sport = $1
     ORDER BY start_time NULLS LAST`,
    [String(sport)],
  );
  return rows;
}

/**
 * @param {string} sport
 * @param {string} [venue]
 * @returns {Promise<object[]>}
 */
export async function fetchSportVenueBets(sport, venue) {
  const pool = getPgPool();
  if (!pool)
    return [];
  if (venue) {
    const { rows } = await pool.query(
      `SELECT sport, venue, source_match_id, source_bet_id, map, market_code, line,
              bet_name, home_odds, away_odds, is_locked, source_home_id, source_away_id, updated_at
       FROM sport_venue_bets
       WHERE sport = $1 AND venue = $2`,
      [String(sport), String(venue)],
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT sport, venue, source_match_id, source_bet_id, map, market_code, line,
            bet_name, home_odds, away_odds, is_locked, source_home_id, source_away_id, updated_at
     FROM sport_venue_bets
     WHERE sport = $1`,
    [String(sport)],
  );
  return rows;
}

/**
 * @param {object[]} rows
 */
export async function upsertSportVenueMatches(rows) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const raw = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const byKey = new Map();
  for (const r of raw)
    byKey.set(`${r.sport}|${r.venue}|${r.source_match_id}`, r);
  const list = [...byKey.values()];
  if (!list.length)
    return;
  await pool.query(
    `INSERT INTO sport_venue_matches (
       sport, venue, source_match_id, match_id, source_game_id, start_time,
       home_id, home, away_id, away, teams, synced_at
     )
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::text[], $4::bigint[], $5::text[], $6::bigint[],
       $7::text[], $8::text[], $9::text[], $10::text[], $11::jsonb[], $12::bigint[]
     )
     ON CONFLICT (sport, venue, source_match_id) DO UPDATE SET
       match_id = COALESCE(EXCLUDED.match_id, sport_venue_matches.match_id),
       source_game_id = EXCLUDED.source_game_id,
       start_time = EXCLUDED.start_time,
       home_id = EXCLUDED.home_id,
       home = EXCLUDED.home,
       away_id = EXCLUDED.away_id,
       away = EXCLUDED.away,
       teams = EXCLUDED.teams,
       synced_at = EXCLUDED.synced_at`,
    [
      list.map(r => String(r.sport)),
      list.map(r => String(r.venue)),
      list.map(r => String(r.source_match_id)),
      list.map(r => (r.match_id != null ? Number(r.match_id) : null)),
      list.map(r => (r.source_game_id != null ? String(r.source_game_id) : null)),
      list.map(r => (r.start_time != null ? Number(r.start_time) : null)),
      list.map(r => (r.home_id != null ? String(r.home_id) : null)),
      list.map(r => String(r.home || "")),
      list.map(r => (r.away_id != null ? String(r.away_id) : null)),
      list.map(r => String(r.away || "")),
      list.map(r => _jsonb(r.teams, [])),
      list.map(r => Number(r.synced_at) || Date.now()),
    ],
  );
}

/**
 * @param {object[]} rows
 */
export async function upsertSportVenueBets(rows) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const raw = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const byKey = new Map();
  for (const r of raw)
    byKey.set(`${r.sport}|${r.venue}|${r.source_match_id}|${r.source_bet_id}`, r);
  const list = [...byKey.values()];
  if (!list.length)
    return;
  await pool.query(
    `INSERT INTO sport_venue_bets (
       sport, venue, source_match_id, source_bet_id, map, market_code, line,
       bet_name, home_odds, away_odds, is_locked, source_home_id, source_away_id, updated_at
     )
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::smallint[], $6::text[], $7::numeric[],
       $8::text[], $9::numeric[], $10::numeric[], $11::boolean[], $12::text[], $13::text[], $14::bigint[]
     )
     ON CONFLICT (sport, venue, source_match_id, source_bet_id) DO UPDATE SET
       map = EXCLUDED.map,
       market_code = EXCLUDED.market_code,
       line = EXCLUDED.line,
       bet_name = EXCLUDED.bet_name,
       home_odds = EXCLUDED.home_odds,
       away_odds = EXCLUDED.away_odds,
       is_locked = EXCLUDED.is_locked,
       source_home_id = EXCLUDED.source_home_id,
       source_away_id = EXCLUDED.source_away_id,
       updated_at = EXCLUDED.updated_at`,
    [
      list.map(r => String(r.sport)),
      list.map(r => String(r.venue)),
      list.map(r => String(r.source_match_id)),
      list.map(r => String(r.source_bet_id)),
      list.map(r => Number(r.map) || 0),
      list.map(r => String(r.market_code || "moneyline")),
      list.map(r => (r.line != null && r.line !== "" ? Number(r.line) : null)),
      list.map(r => String(r.bet_name || "")),
      list.map(r => Number(r.home_odds) || 0),
      list.map(r => Number(r.away_odds) || 0),
      list.map(r => Boolean(r.is_locked)),
      list.map(r => (r.source_home_id != null ? String(r.source_home_id) : null)),
      list.map(r => (r.source_away_id != null ? String(r.source_away_id) : null)),
      list.map(r => Number(r.updated_at) || Date.now()),
    ],
  );
}

export function writeSportVenueMatchesAsync(rows) {
  _writeRds(() => upsertSportVenueMatches(rows), "sport_venue_matches");
}

export function writeSportVenueBetsAsync(rows) {
  _writeRds(() => upsertSportVenueBets(rows), "sport_venue_bets");
}

/**
 * 某 sport+venue 快照：删除本批未出现的 source_match_id（及对应 bets）。
 * 仅裁剪本轮有成功数据的 venue，避免单侧拉失败误删另一侧。
 * @param {string} sport
 * @param {string} venue
 * @param {string[]} keepSourceMatchIds
 */
export async function pruneSportVenueSnapshot(sport, venue, keepSourceMatchIds) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  const sportKey = String(sport);
  const venueKey = String(venue);
  const keep = [...new Set((keepSourceMatchIds || []).map(String).filter(Boolean))];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (keep.length) {
      await client.query(
        `DELETE FROM sport_venue_bets
         WHERE sport = $1 AND venue = $2
           AND NOT (source_match_id = ANY($3::text[]))`,
        [sportKey, venueKey, keep],
      );
      await client.query(
        `DELETE FROM sport_venue_matches
         WHERE sport = $1 AND venue = $2
           AND NOT (source_match_id = ANY($3::text[]))`,
        [sportKey, venueKey, keep],
      );
    }
    else {
      await client.query(
        `DELETE FROM sport_venue_bets WHERE sport = $1 AND venue = $2`,
        [sportKey, venueKey],
      );
      await client.query(
        `DELETE FROM sport_venue_matches WHERE sport = $1 AND venue = $2`,
        [sportKey, venueKey],
      );
    }
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

/**
 * 绑定 venue 原始赛到合并 id。
 * @param {string} sport
 * @param {string} venue
 * @param {string} sourceMatchId
 * @param {number|null} matchId
 */
export async function setSportVenueMatchId(sport, venue, sourceMatchId, matchId) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  await pool.query(
    `UPDATE sport_venue_matches
     SET match_id = $4
     WHERE sport = $1 AND venue = $2 AND source_match_id = $3`,
    [String(sport), String(venue), String(sourceMatchId), matchId != null ? Number(matchId) : null],
  );
}
