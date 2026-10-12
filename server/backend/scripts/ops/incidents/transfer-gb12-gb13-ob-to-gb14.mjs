#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 将 GB12 / GB13 活跃 OB 投注账号转移到 GB14（只改 players.owner_user_id）。
 * 不迁移 orders / money_logs。
 *
 *   node scripts/ops/incidents/transfer-gb12-gb13-ob-to-gb14.mjs [--dry-run]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";
import { loadAccountsForUser, loadProfileById } from "../../../core/db/store.js";

const dryRun = process.argv.includes("--dry-run");

loadChangmenEnv();
if (!process.env.DATABASE_RDS_TARGET)
  process.env.DATABASE_RDS_TARGET = "public";

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
const byName = Object.fromEntries(users.map(u => [String(u.user_name).toUpperCase(), u.id]));
const GB12 = byName.GB12;
const GB13 = byName.GB13;
const GB14 = byName.GB14;
if (!GB12 || !GB13 || !GB14)
  throw new Error(`missing users: ${JSON.stringify(byName)}`);

const fromOwners = [GB12, GB13];

const { rows: moving } = await pool.query(
  `
  SELECT pl.id, u.user_name, pl.platform_id, pl.platform_name, pl.player_name,
         pl.provider, pl.venue_member_id, pl.venue_account_key, pl.owner_user_id
  FROM players pl
  JOIN users u ON u.id = pl.owner_user_id
  WHERE pl.owner_user_id = ANY($1::uuid[])
    AND pl.deleted_at IS NULL
    AND UPPER(COALESCE(pl.provider,'')) = 'OB'
  ORDER BY u.user_name, pl.id
  `,
  [fromOwners],
);

console.log(`moving ${moving.length} active OB players → GB14 (${GB14}) dryRun=${dryRun}`);
for (const p of moving) {
  console.log(
    `  ${p.user_name}\tid=${p.id}\t${p.platform_name}\t${p.player_name}\tvm=${p.venue_member_id || ""}`,
  );
}

if (moving.length === 0) {
  console.log("nothing to move");
  await pool.end();
  process.exit(0);
}

const ids = moving.map(p => Number(p.id));

const { rows: conflicts } = await pool.query(
  `
  WITH moving AS (
    SELECT id, venue_account_key, venue_member_id, provider, platform_id, player_name
    FROM players WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL
  )
  SELECT m.id AS moving_id, o.id AS other_id, u.user_name AS other_user,
         o.deleted_at IS NOT NULL AS other_soft,
         CASE
           WHEN m.venue_account_key <> '' AND o.venue_account_key = m.venue_account_key
             THEN 'venue_account_key'
           WHEN m.venue_member_id <> '' AND o.provider = m.provider
                AND o.venue_member_id = m.venue_member_id
                AND o.owner_user_id = $2::uuid
             THEN 'gb14_provider_vm'
           WHEN o.owner_user_id = $2::uuid
                AND o.platform_id = m.platform_id
                AND o.player_name = m.player_name
                AND o.deleted_at IS NULL
             THEN 'gb14_platform_player_name'
           ELSE '?'
         END AS reason
  FROM moving m
  JOIN players o ON o.id <> m.id
    AND (
      (m.venue_account_key <> '' AND o.venue_account_key = m.venue_account_key)
      OR (
        m.venue_member_id <> '' AND o.provider = m.provider AND o.venue_member_id = m.venue_member_id
        AND o.owner_user_id = $2::uuid
      )
      OR (
        o.owner_user_id = $2::uuid AND o.deleted_at IS NULL
        AND o.platform_id = m.platform_id AND o.player_name = m.player_name
      )
    )
  LEFT JOIN users u ON u.id = o.owner_user_id
  ORDER BY m.id, o.id
  `,
  [ids, GB14],
);

if (conflicts.length) {
  console.error("ABORT: conflicts");
  for (const r of conflicts) console.error(r);
  await pool.end();
  process.exit(1);
}
console.log("conflicts: 0");

const { rows: orderCounts } = await pool.query(
  `SELECT player_id, COUNT(*)::int AS n
   FROM ${financialOrdersRelation()} WHERE player_id = ANY($1::bigint[])
   GROUP BY player_id ORDER BY player_id`,
  [ids],
);
console.log("orders left in place (not migrated):", orderCounts);

if (dryRun) {
  console.log("[dry-run] no write");
  await pool.end();
  process.exit(0);
}

const now = Date.now();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows: updated } = await client.query(
    `
    UPDATE players
    SET owner_user_id = $1::uuid, updated_at = $2
    WHERE id = ANY($3::bigint[])
      AND owner_user_id = ANY($4::uuid[])
      AND deleted_at IS NULL
      AND UPPER(COALESCE(provider,'')) = 'OB'
    RETURNING id, owner_user_id
    `,
    [GB14, now, ids, fromOwners],
  );
  if (updated.length !== ids.length) {
    throw new Error(`expected ${ids.length} updates, got ${updated.length}`);
  }
  await client.query("COMMIT");
  console.log(`updated ${updated.length} players`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}

for (const uid of [GB12, GB13, GB14]) {
  await loadProfileById(uid);
  await loadAccountsForUser(uid);
}
console.log("cache reloaded for GB12/GB13/GB14");

const { rows: verify } = await pool.query(
  `
  SELECT pl.id, u.user_name, pl.platform_name, pl.player_name
  FROM players pl
  JOIN users u ON u.id = pl.owner_user_id
  WHERE pl.id = ANY($1::bigint[])
  ORDER BY pl.id
  `,
  [ids],
);
console.log("verify owners:");
for (const p of verify)
  console.log(`  id=${p.id}\t${p.user_name}\t${p.platform_name}\t${p.player_name}`);

const { rows: leftover } = await pool.query(
  `
  SELECT COUNT(*)::int AS n
  FROM players
  WHERE owner_user_id = ANY($1::uuid[])
    AND deleted_at IS NULL
    AND UPPER(COALESCE(provider,'')) = 'OB'
  `,
  [fromOwners],
);
console.log(`GB12/GB13 active OB remaining: ${leftover[0].n}`);

await pool.end();
