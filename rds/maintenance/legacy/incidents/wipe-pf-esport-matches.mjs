#!/usr/bin/env node
/**
 * 一次性：从 RDS 清掉 PredictFun 电竞赛事（platform_* + 合场 matchs/bets 中的 PF）。
 * 不删 orders / 账号。体育 sport_venue_* 的 PF 行一并清。
 *
 *   node scripts/ops/incidents/wipe-pf-esport-matches.mjs
 *   node scripts/ops/incidents/wipe-pf-esport-matches.mjs --apply
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady } from "@changmen/db";

loadChangmenEnv();

const APPLY = process.argv.includes("--apply");
const PF = ["PredictFun", "PF"];

function keysOf(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, Number(v) || 0]),
  );
}

async function countPf(pool) {
  const [
    platforms,
    bets,
    timers,
    cmPf,
    cmPfOnlyActive,
    sportVenue,
    sportBets,
    sportCmPf,
  ] = await Promise.all([
    pool.query(
      `SELECT platform, count(*)::int AS n FROM platform_matches
       WHERE platform = ANY($1::text[]) GROUP BY 1`,
      [PF],
    ),
    pool.query(
      `SELECT platform, count(*)::int AS n FROM platform_bets
       WHERE platform = ANY($1::text[]) GROUP BY 1`,
      [PF],
    ),
    pool.query(
      `SELECT platform, count(*)::int AS n FROM live_timers
       WHERE platform = ANY($1::text[]) GROUP BY 1`,
      [PF],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM client_matches
       WHERE matchs ?| $1::text[]`,
      [PF],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM client_matches
       WHERE ended_at IS NULL
         AND matchs ?| $1::text[]
         AND (SELECT count(*) FROM jsonb_object_keys(COALESCE(matchs, '{}'::jsonb)) k
              WHERE k NOT IN ('PredictFun','PF')) = 0`,
      [PF],
    ),
    pool.query(
      `SELECT venue, count(*)::int AS n FROM sport_venue_matches
       WHERE venue = ANY($1::text[]) GROUP BY 1`,
      [PF],
    ),
    pool.query(
      `SELECT venue, count(*)::int AS n FROM sport_venue_bets
       WHERE venue = ANY($1::text[]) GROUP BY 1`,
      [PF],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM sport_client_matches
       WHERE matchs ?| $1::text[]`,
      [PF],
    ),
  ]);
  return {
    platform_matches: platforms.rows,
    platform_bets: bets.rows,
    live_timers: timers.rows,
    client_matches_with_pf: cmPf.rows[0]?.n || 0,
    client_matches_pf_only_active: cmPfOnlyActive.rows[0]?.n || 0,
    sport_venue_matches: sportVenue.rows,
    sport_venue_bets: sportBets.rows,
    sport_client_matches_with_pf: sportCmPf.rows[0]?.n || 0,
  };
}

function stripPfSql(table) {
  return `
    UPDATE ${table}
    SET
      matchs = (COALESCE(matchs, '{}'::jsonb) - 'PredictFun' - 'PF'),
      bets = (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN jsonb_typeof(elem->'Sources') = 'object'
            THEN jsonb_set(elem, '{Sources}', (elem->'Sources') - 'PredictFun' - 'PF', true)
            ELSE elem
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(COALESCE(bets, '[]'::jsonb)) = 'array'
               THEN bets ELSE '[]'::jsonb END
        ) elem
      ),
      reverse = CASE
        WHEN jsonb_typeof(reverse) = 'array' THEN (
          SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
          FROM jsonb_array_elements(reverse) x
          WHERE x #>> '{}' NOT IN ('PredictFun', 'PF')
        )
        WHEN jsonb_typeof(reverse) = 'object' THEN reverse - 'PredictFun' - 'PF'
        ELSE reverse
      END
    WHERE matchs ?| $1::text[]
  `;
}

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无法连接 RDS");
  process.exit(1);
}

const before = await countPf(pool);
console.log(APPLY ? "APPLY" : "DRY-RUN", JSON.stringify(before, null, 2));

if (!APPLY) {
  console.log("未改库。确认后加 --apply");
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");

  await client.query(
    `WITH moved AS (
       DELETE FROM platform_matches
       WHERE platform = ANY($1::text[])
       RETURNING *
     )
     INSERT INTO platform_matches_history (
       platform, source_match_id, source_game_id, start_time, home_id, home,
       away_id, away, bo, is_live, rot_num, teams, synced_at, match_id
     )
     SELECT platform, source_match_id, source_game_id, start_time, home_id, home,
            away_id, away, bo, is_live, rot_num, teams, synced_at, match_id
     FROM moved`,
    [PF],
  );
  const betsDel = await client.query(
    `DELETE FROM platform_bets WHERE platform = ANY($1::text[])`,
    [PF],
  );
  const timersDel = await client.query(
    `DELETE FROM live_timers WHERE platform = ANY($1::text[])`,
    [PF],
  );

  const cmStrip = await client.query(stripPfSql("client_matches"), [PF]);
  const nowMs = Date.now();
  const cmEnded = await client.query(
    `UPDATE client_matches
     SET ended_at = COALESCE(ended_at, $1)
     WHERE ended_at IS NULL
       AND (matchs IS NULL OR matchs = '{}'::jsonb)`,
    [nowMs],
  );

  await client.query(
    `DELETE FROM sport_venue_bets WHERE venue = ANY($1::text[])`,
    [PF],
  );
  await client.query(
    `DELETE FROM sport_venue_matches WHERE venue = ANY($1::text[])`,
    [PF],
  );

  const sportStrip = await client.query(stripPfSql("sport_client_matches"), [PF]);
  const sportDelEmpty = await client.query(
    `DELETE FROM sport_client_matches
     WHERE matchs IS NULL OR matchs = '{}'::jsonb`,
  );

  await client.query("COMMIT");
  console.log("deleted", {
    platform_bets: betsDel.rowCount,
    live_timers: timersDel.rowCount,
    client_matches_stripped: cmStrip.rowCount,
    client_matches_ended_empty: cmEnded.rowCount,
    sport_client_matches_stripped: sportStrip.rowCount,
    sport_client_matches_deleted_empty: sportDelEmpty.rowCount,
  });
}
catch (err) {
  await client.query("ROLLBACK");
  throw err;
}
finally {
  client.release();
}

const after = await countPf(pool);
console.log("AFTER", JSON.stringify(after, null, 2));
process.exit(0);
