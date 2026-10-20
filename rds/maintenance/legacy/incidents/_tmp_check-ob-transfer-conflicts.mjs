#!/usr/bin/env node
/**
 * Check conflicts before transferring GB12/GB13 OB players → GB14.
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const FROM = [180, 181, 182, 183, 184, 185, 187, 190, 191, 192, 193, 194, 195, 196, 235];
const GB14 = "4dd10501-4adf-4be9-9c7e-4b82fae727f7";

const { rows } = await pool.query(
  `
  WITH moving AS (
    SELECT id, venue_account_key, venue_member_id, provider, player_name, platform_id, owner_user_id
    FROM players WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL
  )
  SELECT m.id AS moving_id, m.venue_account_key, m.venue_member_id, m.provider,
         o.id AS other_id, u.user_name AS other_user, o.deleted_at IS NOT NULL AS other_soft,
         CASE
           WHEN m.venue_account_key <> '' AND o.venue_account_key = m.venue_account_key THEN 'venue_account_key'
           WHEN m.venue_member_id <> '' AND o.provider = m.provider AND o.venue_member_id = m.venue_member_id
                AND o.owner_user_id = $2::uuid THEN 'gb14_provider_vm'
           ELSE '?'
         END AS reason
  FROM moving m
  JOIN players o ON o.id <> m.id
    AND (
      (m.venue_account_key <> '' AND o.venue_account_key = m.venue_account_key)
      OR (
        m.venue_member_id <> '' AND o.provider = m.provider AND o.venue_member_id = m.venue_member_id
        AND o.owner_user_id = $2::uuid
      )
    )
  LEFT JOIN users u ON u.id = o.owner_user_id
  ORDER BY m.id, o.id
  `,
  [FROM, GB14],
);
console.log("potential conflicts:", rows.length);
for (const r of rows)
  console.log(r);

const { rows: ml } = await pool.query(
  `SELECT player_id, COUNT(*)::int AS n
   FROM money_logs WHERE player_id = ANY($1::bigint[])
   GROUP BY player_id ORDER BY player_id`,
  [FROM],
);
console.log("money_logs:", ml);

await pool.end();
