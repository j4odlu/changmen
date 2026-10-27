#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

// All OB orders for GB12/13/14 in last 30 days
const { rows } = await pool.query(
  `SELECT u.user_name, pl.id AS player_id, pl.platform_name, pl.player_name,
          pl.deleted_at IS NOT NULL AS soft,
          COUNT(*)::int AS n,
          ROUND(AVG(o.bet_money)::numeric,1) AS avg_stake,
          to_timestamp(MAX(o.create_at)/1000.0) AS last_ts
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   JOIN users u ON u.id = o.user_id
   WHERE u.user_name ILIKE ANY(ARRAY['gb12','gb13','gb14'])
     AND UPPER(COALESCE(pl.provider,'')) = 'OB'
     AND o.create_at >= $1
   GROUP BY 1, 2, 3, 4, 5
   ORDER BY last_ts DESC NULLS LAST`,
  [Date.parse("2026-08-01T00:00:00Z")],
);
console.log("OB orders Aug+ by user/player:");
for (const r of rows) console.log(r);

// GB14 Extensions parse
const { rows: ext } = await pool.query(
  `SELECT jsonb_typeof(preferences->'Extensions') AS ext_type,
          preferences->'Extensions' AS ext
   FROM profiles WHERE id = '4dd10501-4adf-4be9-9c7e-4b82fae727f7'`,
);
console.log("\nGB14 Extensions typeof:", ext[0].ext_type);
const raw = ext[0].ext;
const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
console.log("arbAllowedPlatforms:", parsed?.arbAllowedPlatforms);
console.log("valueBet.autoBet:", parsed?.valueBet?.autoBet);

await pool.end();
