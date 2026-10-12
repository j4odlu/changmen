#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const GB12 = "ce757d3f-6906-4a5d-8bed-b1e2d94edce4";

const { rows: active } = await pool.query(
  `SELECT id, provider, platform_id, platform_name, player_name,
          venue_member_id, deleted_at IS NOT NULL AS soft,
          NULLIF(account_data->>'provider','') AS ad_provider,
          NULLIF(account_data->>'platform','') AS ad_platform,
          NULLIF(account_data->>'Type','') AS ad_type
   FROM players
   WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
   ORDER BY id`,
  [GB12],
);
console.log("GB12 active:");
for (const r of active) console.log(r);

const { rows: softOb } = await pool.query(
  `SELECT id, provider, platform_name, player_name, deleted_at
   FROM players
   WHERE owner_user_id = $1::uuid AND deleted_at IS NOT NULL
     AND UPPER(COALESCE(provider,'')) = 'OB'
   ORDER BY id`,
  [GB12],
);
console.log(`\nGB12 soft-deleted OB (${softOb.length}):`);
for (const r of softOb) console.log(r);

// orders still attributed to GB12 but player now owned by GB14
const { rows: orphanOrders } = await pool.query(
  `SELECT o.player_id, pl.provider, pl.platform_name, pl.player_name,
          u.user_name AS player_owner, COUNT(*)::int AS n
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   LEFT JOIN users u ON u.id = pl.owner_user_id
   WHERE o.user_id = $1::uuid
     AND UPPER(COALESCE(pl.provider,'')) = 'OB'
   GROUP BY o.player_id, pl.provider, pl.platform_name, pl.player_name, u.user_name
   ORDER BY o.player_id`,
  [GB12],
);
console.log("\nGB12 orders still pointing at OB players (orders not migrated):");
for (const r of orphanOrders) console.log(r);

await pool.end();
