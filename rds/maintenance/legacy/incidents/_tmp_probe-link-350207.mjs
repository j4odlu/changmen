#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();
const uid = "4dd10501-4adf-4be9-9c7e-4b82fae727f7";

const { rows } = await pool.query(
  `SELECT preferences->'Message' AS msg,
          preferences->>'Message' AS msg_text
   FROM profiles WHERE id = $1::uuid`,
  [uid],
);
console.log("Message prefs:", JSON.stringify(rows[0], null, 2));

// Link UI shows last 6 of linkId; find links ending in 350207 around tonight
const { rows: links } = await pool.query(
  `SELECT o.link, o.player_id, pl.provider, o.status, o.bet_money, o.odds,
          to_timestamp(o.create_at/1000.0) AS created,
          o.raw->>'match' AS match_name,
          o.raw->>'bet' AS bet_name
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid
     AND (
       o.link::text LIKE '%350207'
       OR o.create_at BETWEEN $2 AND $3
     )
   ORDER BY o.create_at DESC
   LIMIT 40`,
  [uid, Date.parse("2026-09-17T16:40:00Z"), Date.parse("2026-09-17T17:10:00Z")],
);
console.log("\norders near screenshot time / link 350207:");
for (const r of links) console.log(r);

await pool.end();
