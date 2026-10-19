#!/usr/bin/env node
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const { rows } = await pool.query(
  `SELECT id, owner_user_id, platform_id, platform_name, player_name, provider,
          venue_member_id, venue_account_key, credit, total_balance,
          created_at, updated_at, deleted_at,
          account_data
   FROM players WHERE id = 295`,
);
const p = rows[0];
if (!p) {
  console.log("not found");
  await pool.end();
  process.exit(1);
}
const ad = p.account_data || {};
console.log({
  id: p.id,
  platform_id: p.platform_id,
  platform_name: p.platform_name,
  player_name: p.player_name,
  provider: p.provider,
  venue_member_id: p.venue_member_id,
  venue_account_key: p.venue_account_key,
  created_at: p.created_at,
  updated_at: p.updated_at,
  deleted_at: p.deleted_at,
  account_data_keys: Object.keys(ad).sort(),
  account_data_providerish: {
    provider: ad.provider,
    Provider: ad.Provider,
    platform: ad.platform,
    Platform: ad.Platform,
    Type: ad.Type,
    type: ad.type,
  },
  has_gateway: Boolean(ad.gateway || ad.Gateway),
  has_token: Boolean(ad.token || ad.Token),
  gateway_sample: String(ad.gateway || ad.Gateway || "").slice(0, 80),
});
console.log("\nfull account_data:");
console.log(JSON.stringify(ad, null, 2));

// any other jjb / platform_id 421
const { rows: peers } = await pool.query(
  `SELECT id, u.user_name, pl.provider, pl.platform_name, pl.player_name, pl.deleted_at IS NOT NULL AS soft
   FROM players pl
   LEFT JOIN users u ON u.id = pl.owner_user_id
   WHERE pl.platform_id = 421 OR LOWER(pl.platform_name) = 'jjb'
   ORDER BY pl.id`,
);
console.log("\npeers platform_id=421 or name jjb:");
for (const r of peers) console.log(r);

await pool.end();
