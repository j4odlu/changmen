/**
 * Polymarket Gamma 补充 / Sports WS 接管 → client_matches.pm_sport
 */

import { getPgPool } from "../pg_pool.js";

const PM_PLATFORM = "Polymarket";

/** @returns {Promise<number | null>} client_matches.id */
export async function resolveClientMatchIdForPmSport({ slug, gameId, eventId }) {
  const pool = getPgPool();
  if (!pool)
    return null;

  const keys = new Set();
  if (slug)
    keys.add(String(slug));
  if (eventId)
    keys.add(String(eventId));
  if (gameId != null && eventId)
    keys.add(String(eventId));
  if (!keys.size)
    return null;

  const { rows } = await pool.query(
    `SELECT match_id
     FROM platform_matches
     WHERE platform = $1
       AND match_id IS NOT NULL
       AND source_match_id = ANY($2::text[])
     ORDER BY synced_at DESC
     LIMIT 1`,
    [PM_PLATFORM, [...keys]],
  );
  const matchId = rows[0]?.match_id;
  if (matchId != null)
    return Number(matchId);

  const { rows: cmRows } = await pool.query(
    `SELECT id
     FROM client_matches
     WHERE matchs->>'Polymarket' = ANY($1::text[])
     ORDER BY built_at DESC
     LIMIT 1`,
    [[...keys]],
  );
  const cmId = cmRows[0]?.id;
  return cmId != null ? Number(cmId) : null;
}

/** @param {number[]} clientMatchIds @returns {Promise<Map<number, object>>} */
export async function fetchPmSportByClientMatchIds(clientMatchIds) {
  const pool = getPgPool();
  const ids = [...new Set((clientMatchIds || []).map(Number).filter(Number.isFinite))];
  if (!pool || !ids.length)
    return new Map();

  const { rows } = await pool.query(
    `SELECT id, pm_sport
     FROM client_matches
     WHERE id = ANY($1::bigint[])
       AND pm_sport IS NOT NULL`,
    [ids],
  );
  const out = new Map();
  for (const row of rows) {
    if (row.pm_sport && typeof row.pm_sport === "object")
      out.set(Number(row.id), row.pm_sport);
  }
  return out;
}

/** @param {number} clientMatchId @param {object} pmSport */
export async function updateClientMatchPmSport(clientMatchId, pmSport) {
  const pool = getPgPool();
  if (!pool)
    return false;
  const id = Number(clientMatchId);
  if (!Number.isFinite(id))
    return false;

  const { rowCount } = await pool.query(
    `UPDATE client_matches
     SET pm_sport = $2::jsonb
     WHERE id = $1
       AND ($2::jsonb->>'source' IS DISTINCT FROM 'gamma'
         OR pm_sport IS NULL
         OR pm_sport->>'source' = 'gamma'
         OR (pm_sport->>'source' IS NULL
           AND COALESCE(lower(trim(pm_sport->>'status')), '') NOT IN
             ('not_started', 'scheduled', 'running', 'inprogress', 'finished', 'final',
              'postponed', 'canceled', 'cancelled')
           AND COALESCE(pm_sport->>'live', 'false') <> 'true'
           AND COALESCE(pm_sport->>'ended', 'false') <> 'true'))`,
    [id, JSON.stringify(pmSport ?? {})],
  );
  return rowCount > 0;
}

/** @returns {Promise<Array<{ source_match_id: string, match_id: number, home: string, away: string }>>} */
export async function fetchLinkedPolymarketPlatformMatches() {
  const pool = getPgPool();
  if (!pool)
    return [];

  const { rows } = await pool.query(
    `SELECT source_match_id, match_id, home, away
     FROM platform_matches
     WHERE platform = $1
       AND match_id IS NOT NULL
     ORDER BY synced_at DESC`,
    [PM_PLATFORM],
  );
  return rows.map(row => ({
    source_match_id: String(row.source_match_id),
    match_id: Number(row.match_id),
    home: String(row.home || ""),
    away: String(row.away || ""),
  }));
}
