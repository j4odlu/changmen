#!/usr/bin/env node
/**
 * 运维：从 account_data 回填 players.venue_member_id（迁移 030 已含 SQL，本脚本可重复执行）。
 *
 *   cd server/backend
 *   node scripts/backfill-players-venue-member-id.mjs
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";

loadChangmenEnv();
await ensurePgPoolReady();

async function main() {
  const pool = getPgPool();
  if (!pool) {
    console.error("DATABASE_URL 未配置");
    process.exit(1);
  }
  const { rowCount } = await pool.query(`
    UPDATE players
    SET venue_member_id = COALESCE(
          NULLIF(TRIM(account_data->>'venueMemberId'), ''),
          NULLIF(TRIM(account_data->>'venueId'), ''),
          ''
        )
    WHERE deleted_at IS NULL
      AND venue_member_id = ''
      AND (
        NULLIF(TRIM(account_data->>'venueMemberId'), '') IS NOT NULL
        OR NULLIF(TRIM(account_data->>'venueId'), '') IS NOT NULL
      )
  `);
  const { rowCount: providerRows } = await pool.query(`
    UPDATE players
    SET provider = NULLIF(TRIM(account_data->>'provider'), '')
    WHERE deleted_at IS NULL
      AND provider = ''
      AND NULLIF(TRIM(account_data->>'provider'), '') IS NOT NULL
  `);
  console.log(`backfill venue_member_id: ${rowCount ?? 0} rows`);
  console.log(`backfill provider: ${providerRows ?? 0} rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
