#!/usr/bin/env node
/**
 * 运维：回填 players.venue_account_key（迁移 032 SQL 已处理 member 类；本脚本补 gateway+token 类）。
 *
 *   cd changmen/server/backend
 *   node scripts/backfill-players-venue-account-key.mjs
 */

import { buildVenueAccountKeyFromRecord } from "@changmen/db/venue_account_key.js";
import { getPgPool, initDatabaseUrl } from "@changmen/db";

await initDatabaseUrl();
const pool = getPgPool();
if (!pool) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const { rows } = await pool.query(
  `SELECT id, provider, venue_member_id, account_data
   FROM players
   WHERE deleted_at IS NULL AND venue_account_key = ''`,
);

let updated = 0;
let skipped = 0;
for (const row of rows) {
  const data = row.account_data && typeof row.account_data === "object" ? row.account_data : {};
  const key = buildVenueAccountKeyFromRecord({
    provider: row.provider || data.provider,
    venueMemberId: row.venue_member_id || data.venueMemberId || data.venueId,
    gateway: data.gateway || data.Gateway,
    token: data.token || data.Token,
  });
  if (!key) {
    skipped++;
    continue;
  }
  const { rowCount } = await pool.query(
    `UPDATE players SET venue_account_key = $2 WHERE id = $1 AND venue_account_key = ''`,
    [row.id, key],
  );
  if (rowCount)
    updated++;
}

console.log(`backfill venue_account_key: updated=${updated} skipped=${skipped} scanned=${rows.length}`);
