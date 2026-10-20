#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();
const uid = "4dd10501-4adf-4be9-9c7e-4b82fae727f7";

const { rows } = await pool.query(
  `SELECT id, platform_name, player_name,
          (SELECT array_agg(k ORDER BY k)
           FROM jsonb_object_keys(account_data) AS k) AS keys,
          account_data->>'token' IS NOT NULL AS has_token,
          account_data->>'gateway' IS NOT NULL AS has_gw,
          account_data->>'uid' AS uid,
          account_data->>'userId' AS user_id,
          account_data->>'UserId' AS UserId,
          account_data->>'memberId' AS member_id,
          account_data->>'venueMemberId' AS venue_member_id,
          account_data->>'api' AS api,
          account_data->>'Api' AS Api,
          account_data->>'secret' AS secret,
          account_data->>'password' AS has_pw_hint,
          length(coalesce(account_data->>'password','')) AS pw_len,
          account_data->>'username' AS username,
          account_data->>'playerName' AS ad_player_name
   FROM players
   WHERE owner_user_id = $1::uuid AND deleted_at IS NULL AND UPPER(provider)='OB'
   ORDER BY id`,
  [uid],
);
for (const r of rows) {
  console.log(`\n#${r.id} ${r.platform_name}/${r.player_name}`);
  console.log("  keys:", r.keys?.join(", "));
  console.log("  uid/userId/memberId/venueMemberId:", r.uid, r.user_id, r.UserId, r.member_id, r.venue_member_id);
  console.log("  api/Api/pw_len:", r.api, r.Api, r.pw_len);
}

// Compare with a soft-deleted original GB14 OB that used to work
const { rows: old } = await pool.query(
  `SELECT id, platform_name, player_name,
          (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(account_data) k) AS keys,
          account_data->>'uid' AS uid,
          account_data->>'venueMemberId' AS vm
   FROM players WHERE id IN (90, 98, 206) ORDER BY id`,
);
console.log("\n--- old GB14 OB (soft) keys ---");
for (const r of old) console.log(r);

await pool.end();
