#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();

const ids = {
  GB12: "ce757d3f-6906-4a5d-8bed-b1e2d94edce4",
  GB13: "fa21d1c7-16e2-49af-9416-033ebe64c4cb",
  GB14: "4dd10501-4adf-4be9-9c7e-4b82fae727f7",
};

for (const [name, uid] of Object.entries(ids)) {
  const { rows } = await pool.query(
    `SELECT betting_config->>'betMoney' AS bet_money,
            betting_config->>'profit' AS profit,
            betting_config->'providerFixed' AS fixed,
            betting_config->'providerSortValue' AS sort,
            betting_config->'allowSameBet' AS allow_same,
            betting_config->>'betting' AS betting,
            preferences->'Extensions'->>'arbAllowedPlatforms' AS arb_allow
     FROM profiles WHERE id = $1::uuid`,
    [uid],
  );
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(rows[0], null, 2));
}

// OB order volume for these players before/after transfer under any user
const playerIds = [180, 182, 184, 191, 193, 195, 235];
const { rows: vol } = await pool.query(
  `SELECT u.user_name, date_trunc('day', to_timestamp(o.create_at/1000.0)) AS day,
          COUNT(*)::int AS n, ROUND(AVG(o.bet_money)::numeric,1) AS avg_stake
   FROM ${financialOrdersRelation("o")}
   JOIN users u ON u.id = o.user_id
   WHERE o.player_id = ANY($1::bigint[])
     AND o.create_at >= $2
   GROUP BY 1, 2
   ORDER BY 2 DESC, 1`,
  [playerIds, Date.parse("2026-09-01T00:00:00Z")],
);
console.log("\nOB player orders by day (any owner user_id on order):");
for (const r of vol) console.log(r);

await pool.end();
