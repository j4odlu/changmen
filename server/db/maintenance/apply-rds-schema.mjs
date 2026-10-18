#!/usr/bin/env node
import { readRdsMigrationSql } from "./assets.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRdsMigrations } from "./rds-migrations.mjs";
import { ORDER_OBSERVATION_MIGRATIONS, verifyOrderObservationSchema } from "./apply-order-observation-schema.mjs";
import { verifyRdsSchema } from "./rds-schema-check.mjs";

// Explicit manifest; 002 is a retired pg_cron no-op.
export const RDS_MIGRATIONS = [
  "001_baseline.sql",
  "003_money_logs.sql",
  "004_users_is_admin.sql",
  "005_client_matches_list_status.sql",
  "006_tag_platforms_players.sql",
  "007_platform_matches_is_live.sql",
  "008_user_logs.sql",
  "009_orders_changmen_bet.sql",
  "010_value_signals.sql",
  "011_odds_history.sql",
  "012_user_roles_teams.sql",
  "013_widen_odds_numeric.sql",
  "014_history_tables.sql",
  "015_prune_indexes_and_drop_list_status.sql",
  "016_client_matches_pm_sport.sql",
  "017_client_matches_canonical_teams.sql",
  "018_client_match_platform_overrides.sql",
  "023_team_platform_maps_gb_team_id.sql",
  "024_team_platform_maps_venue_columns.sql",
  "025_team_venue_maps.sql",
  "026_players_owner_user_id.sql",
  "027_players_active_owner_required.sql",
  "028_players_account_data.sql",
  "029_orders_user_player_index.sql",
  "030_players_venue_member_id.sql",
  "031_team_venue_maps_venue_team_id.sql",
  "032_players_venue_account_key.sql",
  "033_sport_matcher_tables.sql",
  "034_platform_bets_market_id.sql",
  "035_players_venue_account_key_including_deleted.sql",
  "036_team_provider_ids.sql",
  "037_client_matches_ended_at.sql",
  "038_platform_matches_rot_num.sql",
  "039_platform_bets_line_id.sql",
  "040_football_orders.sql",
  "041_football_orders_status.sql",
  "042_pod_bet_executions.sql",
  "043_auth_session_audit.sql",
  "044_auth_sessions.sql",
  "045_pod_ray_execution.sql",
  ...ORDER_OBSERVATION_MIGRATIONS,
  "20261015_reconcile_archive_schema.sql",
];

async function hasExistingTables(client) {
  const result = await client.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'changmen_schema_migrations') AS existing`);
  return result.rows[0].existing;
}

/** Explicit initialization only; refusing existing tables prevents historical data replay. */
export async function initializeEmptyRdsSchema(client) {
  return withInitializationLock(client, async () => {
    if (await hasExistingTables(client)) throw new Error("初始化拒绝：数据库已有业务表，请使用只读结构核验，缺失结构须单独维护");
    return applyEmptyRdsSchema(client);
  });
}

/** Compatibility for local fixtures: existing databases are checked, never replayed. */
export async function applyRdsSchema(client) {
  return withInitializationLock(client, async () => {
    if (await hasExistingTables(client)) {
      await verifyRdsSchema(client);
      return [];
    }
    return applyEmptyRdsSchema(client);
  });
}

async function withInitializationLock(client, run) {
  await client.query("SELECT pg_advisory_lock(hashtextextended('changmen:rds-schema',0))");
  try { return await run(); }
  finally { await client.query("SELECT pg_advisory_unlock(hashtextextended('changmen:rds-schema',0))"); }
}

async function applyEmptyRdsSchema(client) {
  await client.query("SET lock_timeout = '30s'");
  const completed = await runRdsMigrations(client, RDS_MIGRATIONS, {
    readSql: readRdsMigrationSql,
    beforeMigration: async (connection, name) => {
      if (name !== "027_players_active_owner_required.sql") return;
      const orphanCheck = await connection.query("SELECT COUNT(*)::int AS n FROM players WHERE deleted_at IS NULL AND owner_user_id IS NULL");
      if (orphanCheck.rows[0]?.n > 0)
        throw new Error("仍有活跃 player 无 owner_user_id，请先运行 npm run db:finalize-players-owner");
    },
  });
  await verifyOrderObservationSchema(client);
  const fields = await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='platform_bets' AND column_name IN ('market_id','line_id')`);
  if (new Set(fields.rows.map(row => row.column_name)).size !== 2)
    throw new Error("platform_bets 缺少 market_id 或 line_id");
  return completed;
}

export async function runConfiguredRdsSchema() {
  // Reading the manifest in tests must not load .env or open a database.
  const { buildPgClientConfig, initDatabaseUrl } = await import("@changmen/db");
  const { default: pg } = await import("@changmen/db/pg.js");
  await initDatabaseUrl();
  if (!process.env.DATABASE_URL)
    throw new Error("缺少 DATABASE_URL，请在 server/backend/.env 中配置");
  const client = new pg.Client(buildPgClientConfig(process.env.DATABASE_URL, 30000));
  client.on("error", err => console.warn("[rds] client error:", err.message));
  await client.connect();
  try {
    if (process.argv.includes("--initialize")) {
      const completed = await initializeEmptyRdsSchema(client);
      console.log(`[rds] 空库初始化完成，本次执行 ${completed.length} 个编号迁移`);
    } else {
      await verifyRdsSchema(client);
    }
  }
  finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runConfiguredRdsSchema().catch(error => { console.error("[rds] 失败:", error.message); process.exitCode = 1; });
}
