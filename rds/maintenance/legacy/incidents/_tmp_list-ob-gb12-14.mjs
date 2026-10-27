#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * One-off: list OB players for GB12/GB13/GB14 (read-only).
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

const { ensurePgPoolReady, getPgPool } = await import("@changmen/db");
await ensurePgPoolReady();
const pool = getPgPool();
if (!pool) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

const { rows: users } = await pool.query(
  `SELECT u.id, u.user_name
   FROM users u
   WHERE u.user_name ILIKE ANY(ARRAY['gb12','gb13','gb14'])
   ORDER BY u.user_name`,
);
console.log("users:", users);
const ids = users.map(u => u.id);

const { rows: players } = await pool.query(
  `SELECT pl.id, u.user_name, pl.platform_name, pl.player_name, pl.provider,
          pl.venue_member_id, pl.venue_account_key, pl.credit, pl.total_balance,
          pl.deleted_at IS NOT NULL AS soft_deleted,
          ((pl.account_data ? 'gateway') OR (pl.account_data ? 'token')) AS has_cred
   FROM players pl
   JOIN users u ON u.id = pl.owner_user_id
   WHERE pl.owner_user_id = ANY($1::uuid[])
     AND (
       UPPER(COALESCE(pl.provider,'')) = 'OB'
       OR LOWER(COALESCE(pl.platform_name,'')) LIKE '%ob%'
       OR LOWER(COALESCE(pl.platform_name,'')) LIKE '%电竞%'
     )
   ORDER BY u.user_name, pl.deleted_at NULLS FIRST, pl.id`,
  [ids],
);

console.log("\nOB-ish players:");
for (const p of players) {
  console.log(
    `  ${p.user_name}\tid=${p.id}\tprov=${p.provider}\tplat=${p.platform_name}\tname=${p.player_name}\tvm=${p.venue_member_id || ""}\tsoft=${p.soft_deleted}\tcred=${p.has_cred}\tcredit=${p.credit}\tbal=${p.total_balance}`,
  );
}

const { rows: all } = await pool.query(
  `SELECT pl.id, u.user_name, pl.provider, pl.platform_name, pl.player_name
   FROM players pl
   JOIN users u ON u.id = pl.owner_user_id
   WHERE pl.owner_user_id = ANY($1::uuid[]) AND pl.deleted_at IS NULL
   ORDER BY u.user_name, pl.id`,
  [ids],
);
console.log("\nall active:");
for (const p of all)
  console.log(`  ${p.user_name}\t${p.id}\t${p.provider}\t${p.platform_name}\t${p.player_name}`);

// order counts for OB players
if (players.length) {
  const pids = players.filter(p => !p.soft_deleted).map(p => p.id);
  if (pids.length) {
    const { rows: oc } = await pool.query(
      `SELECT o.user_id, u.user_name, o.player_id, COUNT(*)::int AS n
       FROM ${financialOrdersRelation("o")}
       JOIN users u ON u.id = o.user_id
       WHERE o.player_id = ANY($1::bigint[])
       GROUP BY o.user_id, u.user_name, o.player_id
       ORDER BY u.user_name, o.player_id`,
      [pids],
    );
    console.log("\norder counts by player:");
    for (const r of oc)
      console.log(`  ${r.user_name}\tplayer=${r.player_id}\torders=${r.n}`);
  }
}

await pool.end();
