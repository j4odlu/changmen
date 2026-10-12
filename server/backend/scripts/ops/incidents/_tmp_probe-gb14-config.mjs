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

const { rows: prof } = await pool.query(
  `SELECT p.id, u.user_name,
          p.betting_config,
          p.preferences
   FROM profiles p
   JOIN users u ON u.id = p.id
   WHERE p.id = $1::uuid`,
  [uid],
);
console.log("profile betting_config:", JSON.stringify(prof[0]?.betting_config, null, 2));
console.log("preferences keys:", Object.keys(prof[0]?.preferences || {}));
const prefs = prof[0]?.preferences || {};
for (const k of ["betMoney", "profit", "USERCONFIG", "CollectConfig", "config"]) {
  if (prefs[k] !== undefined)
    console.log(`prefs.${k}:`, JSON.stringify(prefs[k], null, 2).slice(0, 800));
}

// also check users table / data store keys if any
const { rows: dataKeys } = await pool.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name = 'profiles' ORDER BY ordinal_position`,
);
console.log("profiles columns:", dataKeys.map(r => r.column_name).join(", "));

const { rows: full } = await pool.query(`SELECT * FROM profiles WHERE id = $1::uuid`, [uid]);
const row = full[0] || {};
for (const [k, v] of Object.entries(row)) {
  if (k === "id" || k === "accounts") continue;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/betMoney|profit|config|USERCONFIG/i.test(k) || /betMoney|\"profit\"/.test(s))
    console.log(`col ${k}:`, s.slice(0, 1000));
}

// Compare: how many OB orders since transfer (~ Sep 17 14:30 UTC = after transfer)
const { rows: since } = await pool.query(
  `SELECT pl.id, pl.platform_name, pl.player_name, COUNT(*)::int AS n,
          MAX(o.create_at) AS last_at,
          to_timestamp(MAX(o.create_at)/1000.0) AS last_ts
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid
     AND UPPER(COALESCE(pl.provider,'')) = 'OB'
     AND o.create_at >= $2
   GROUP BY pl.id, pl.platform_name, pl.player_name
   ORDER BY n DESC`,
  [uid, Date.parse("2026-09-17T14:00:00Z")],
);
console.log("\nOB orders since transfer (GB14 user_id):");
for (const r of since) console.log(r);

const { rows: byProv } = await pool.query(
  `SELECT UPPER(COALESCE(pl.provider,'')) AS prov, COUNT(*)::int AS n
   FROM ${financialOrdersRelation("o")}
   JOIN players pl ON pl.id = o.player_id
   WHERE o.user_id = $1::uuid AND o.create_at >= $2
   GROUP BY 1 ORDER BY n DESC`,
  [uid, Date.parse("2026-09-17T14:00:00Z")],
);
console.log("\norders by provider since transfer:");
for (const r of byProv) console.log(r);

await pool.end();
