#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();
const uid = "4dd10501-4adf-4be9-9c7e-4b82fae727f7";

const { rows } = await pool.query(
  `SELECT id, platform_name, player_name, total_balance,
          account_data->>'errorCount' AS err,
          account_data->>'pause' AS pause,
          account_data->>'todayOrder' AS today_order,
          account_data->>'maxOrder' AS max_order,
          account_data->>'active' AS active,
          to_timestamp((updated_at::bigint)/1000.0) AS updated_ts
   FROM players
   WHERE owner_user_id = $1::uuid AND deleted_at IS NULL AND UPPER(provider)='OB'
   ORDER BY id`,
  [uid],
);
console.log("OB status:");
for (const r of rows) console.log(r);

// Recent linked arb orders for GB14 — see if OB was intended as other leg
const { rows: links } = await pool.query(
  `SELECT o.link, o.player_id, pl.provider, pl.platform_name, o.status,
          to_timestamp(o.create_at/1000.0) AS created,
          left(coalesce(o.order_id,''), 40) AS oid
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid
     AND o.create_at >= $2
   ORDER BY o.create_at DESC
   LIMIT 40`,
  [uid, Date.parse("2026-09-17T14:00:00Z")],
);
console.log("\nrecent orders (look for link pairs):");
for (const r of links) console.log(r);

const byLink = new Map();
for (const r of links) {
  const k = String(r.link || "");
  if (!byLink.has(k)) byLink.set(k, []);
  byLink.get(k).push(`${r.provider}/${r.platform_name}:${r.status}`);
}
console.log("\nlink groups:");
for (const [k, v] of byLink) {
  if (v.length > 1 || k.startsWith("-") || k.length > 5)
    console.log(k, v);
}

await pool.end();
