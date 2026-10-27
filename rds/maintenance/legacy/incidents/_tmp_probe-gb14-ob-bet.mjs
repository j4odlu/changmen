#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * Probe why GB14 OB accounts may not bet.
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const uid = "4dd10501-4adf-4be9-9c7e-4b82fae727f7";

const { rows } = await pool.query(
  `SELECT id, platform_name, player_name, credit, total_balance, updated_at,
          account_data->>'stop' AS stop,
          account_data->>'Stop' AS stop2,
          account_data->>'pause' AS pause,
          account_data->>'isStop' AS is_stop,
          account_data->>'enable' AS enable,
          account_data->>'status' AS status,
          NULLIF(account_data->>'gateway','') IS NOT NULL AS has_gw,
          length(coalesce(account_data->>'token','')) AS token_len,
          account_data->>'api' AS api,
          account_data->>'Api' AS api2,
          account_data->>'uid' AS uid_field,
          account_data->>'memberId' AS member_id,
          account_data->>'venueMemberId' AS venue_member_id_ad,
          venue_member_id,
          account_data->'rateConfig' AS rate_config,
          account_data->>'minOdds' AS min_odds,
          account_data->>'maxOdds' AS max_odds,
          account_data->>'maxOrder' AS max_order,
          account_data->>'todayOrder' AS today_order,
          account_data->>'profit' AS profit,
          account_data->>'money' AS money_field,
          left(account_data::text, 300) AS ad_head
   FROM players
   WHERE owner_user_id = $1::uuid
     AND deleted_at IS NULL
     AND UPPER(COALESCE(provider,'')) = 'OB'
   ORDER BY id`,
  [uid],
);
console.log(`active OB (${rows.length}):`);
for (const r of rows) {
  const { ad_head, ...rest } = r;
  console.log(rest);
  console.log("  ad_head:", ad_head);
}

const { rows: softMoved } = await pool.query(
  `SELECT id, platform_name, player_name, deleted_at,
          to_timestamp(deleted_at/1000.0) AS deleted_ts
   FROM players
   WHERE owner_user_id = $1::uuid
     AND deleted_at IS NOT NULL
     AND id = ANY($2::bigint[])
   ORDER BY id`,
  [uid, [180, 181, 182, 183, 184, 185, 187, 190, 191, 192, 193, 194, 195, 196, 235]],
);
console.log("\ntransferred-set soft-deleted:");
for (const r of softMoved) console.log(r);

const { rows: recentUser } = await pool.query(
  `SELECT o.player_id, pl.provider, pl.platform_name, pl.player_name, o.status,
          o.create_at, to_timestamp(o.create_at/1000.0) AS created,
          left(coalesce(o.order_id,''), 48) AS oid
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid
   ORDER BY o.create_at DESC NULLS LAST
   LIMIT 25`,
  [uid],
);
console.log("\nrecent orders by GB14 user_id:");
for (const r of recentUser) console.log(r);

const { rows: recentPlayers } = await pool.query(
  `SELECT o.user_id::text, u.user_name, o.player_id, pl.platform_name, o.status,
          to_timestamp(o.create_at/1000.0) AS created
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   LEFT JOIN users u ON u.id = o.user_id
   WHERE o.player_id = ANY($1::bigint[])
   ORDER BY o.create_at DESC NULLS LAST
   LIMIT 30`,
  [[180, 182, 184, 191, 193, 195, 235]],
);
console.log("\nrecent orders on active OB player_ids (any user):");
for (const r of recentPlayers) console.log(r);

await pool.end();
