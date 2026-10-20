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
  `SELECT preferences->'Extensions' AS ext,
          preferences->'Message' AS msg,
          betting_config->>'betMoney' AS bet_money,
          betting_config->'providerFixed' AS provider_fixed,
          betting_config->'allowSameBet' AS allow_same_bet,
          betting_config->>'betting' AS betting_on
   FROM profiles WHERE id = $1::uuid`,
  [uid],
);
console.log(JSON.stringify(rows[0], null, 2));

const { rows: accounts } = await pool.query(
  `SELECT id, platform_name, player_name, total_balance,
          (account_data->>'pause')::text AS pause,
          coalesce((account_data->>'balance')::float, total_balance) AS ad_balance,
          account_data->>'currency' AS currency,
          account_data->>'gateway' AS gateway,
          left(account_data->>'token', 8) AS token_prefix,
          account_data->>'userId' AS user_id_ad,
          account_data->>'uid' AS uid_ad,
          account_data->>'pc' AS pc,
          jsonb_object_keys_count(account_data) AS _
   FROM players
   WHERE owner_user_id = $1::uuid AND deleted_at IS NULL AND UPPER(provider)='OB'
   ORDER BY id`,
  [uid],
).catch(async (e) => {
  // fallback without fake function
  const r = await pool.query(
    `SELECT id, platform_name, player_name, total_balance,
            account_data->>'pause' AS pause,
            account_data->>'balance' AS ad_balance,
            account_data->>'currency' AS currency,
            account_data->>'gateway' AS gateway,
            left(account_data->>'token', 12) AS token_prefix,
            account_data->>'userId' AS user_id_ad,
            account_data->>'uid' AS uid_ad,
            jsonb_typeof(account_data->'rateConfig') AS rate_type,
            jsonb_array_length(COALESCE(account_data->'rateConfig','[]'::jsonb)) AS rate_len,
            account_data->>'minOdds' AS min_odds,
            account_data->>'maxOdds' AS max_odds,
            account_data->>'markupOnly' AS markup_only,
            account_data->>'noMarkup' AS no_markup,
            account_data->>'workTimes' AS work_times
     FROM players
     WHERE owner_user_id = $1::uuid AND deleted_at IS NULL AND UPPER(provider)='OB'
     ORDER BY id`,
    [uid],
  );
  return r;
});
console.log("\nOB account detail:");
for (const a of accounts) console.log(a);

// Compare rateConfig of a known-working historical OB on GB14 original (soft) vs transferred
const { rows: sample } = await pool.query(
  `SELECT id, owner_user_id::text, platform_name, player_name,
          account_data->'rateConfig' AS rate,
          deleted_at IS NOT NULL AS soft
   FROM players WHERE id IN (90, 98, 180, 182, 89) ORDER BY id`,
);
console.log("\nrateConfig samples:");
for (const r of sample) console.log(r);

await pool.end();
