#!/usr/bin/env node
/**
 * 在香港轻量 / 已配置 DATABASE_URL 的环境执行 RDS 建表。
 *
 *   cd changmen/server/backend
 *   # .env 中设置 DATABASE_URL=postgresql://gamebet_app:...@pgm-....:5432/gamebet
 *   node scripts/apply-rds-schema.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPgClientConfig, initDatabaseUrl } from "@changmen/db";
import pg from "@changmen/db/pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
const migrationsDir = join(backendRoot, "db", "migrations");

await initDatabaseUrl();
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("缺少 DATABASE_URL，请在 server/backend/.env 中配置");
  process.exit(1);
}

function readSql(name) {
  return readFileSync(join(migrationsDir, name), "utf8");
}

async function main() {
  const client = new pg.Client(buildPgClientConfig(url, 30000));
  client.on("error", (err) => {
    console.warn("[rds] client error:", err.message);
  });
  await client.connect();
  try {
    // 避免 ALTER TABLE 等锁永久卡住 deploy（web/matcher 进程运行时持有表锁）
    await client.query("SET lock_timeout = '30s'");
    console.log("[rds] 执行 001_baseline.sql …");
    await client.query(readSql("001_baseline.sql"));

    console.log("[rds] 执行 003_money_logs.sql …");
    await client.query(readSql("003_money_logs.sql"));

    console.log("[rds] 执行 004_users_is_admin.sql …");
    await client.query(readSql("004_users_is_admin.sql"));

    console.log("[rds] 执行 005_client_matches_list_status.sql …");
    await client.query(readSql("005_client_matches_list_status.sql"));

    console.log("[rds] 执行 006_tag_platforms_players.sql …");
    await client.query(readSql("006_tag_platforms_players.sql"));

    console.log("[rds] 执行 007_platform_matches_is_live.sql …");
    await client.query(readSql("007_platform_matches_is_live.sql"));

    console.log("[rds] 执行 008_user_logs.sql …");
    await client.query(readSql("008_user_logs.sql"));

    console.log("[rds] 执行 009_orders_changmen_bet.sql …");
    await client.query(readSql("009_orders_changmen_bet.sql"));

    console.log("[rds] 执行 010_value_signals.sql …");
    await client.query(readSql("010_value_signals.sql"));

    console.log("[rds] 执行 011_odds_history.sql …");
    await client.query(readSql("011_odds_history.sql"));

    console.log("[rds] 执行 012_user_roles_teams.sql …");
    await client.query(readSql("012_user_roles_teams.sql"));

    console.log("[rds] 执行 013_widen_odds_numeric.sql …");
    await client.query(readSql("013_widen_odds_numeric.sql"));

    console.log("[rds] 执行 014_history_tables.sql …");
    await client.query(readSql("014_history_tables.sql"));

    console.log("[rds] 执行 015_prune_indexes_and_drop_list_status.sql …");
    await client.query(readSql("015_prune_indexes_and_drop_list_status.sql"));

    console.log("[rds] 执行 016_client_matches_pm_sport.sql …");
    await client.query(readSql("016_client_matches_pm_sport.sql"));

    console.log("[rds] 执行 017_client_matches_canonical_teams.sql …");
    await client.query(readSql("017_client_matches_canonical_teams.sql"));

    console.log("[rds] 执行 018_client_match_platform_overrides.sql …");
    await client.query(readSql("018_client_match_platform_overrides.sql"));

    console.log("[rds] 执行 023_team_platform_maps_gb_team_id.sql …");
    await client.query(readSql("023_team_platform_maps_gb_team_id.sql"));

    console.log("[rds] 执行 024_team_platform_maps_venue_columns.sql …");
    await client.query(readSql("024_team_platform_maps_venue_columns.sql"));

    console.log("[rds] 执行 025_team_venue_maps.sql …");
    await client.query(readSql("025_team_venue_maps.sql"));

    console.log("[rds] 执行 026_players_owner_user_id.sql …");
    await client.query(readSql("026_players_owner_user_id.sql"));

    const orphanCheck = await client.query(
      `SELECT COUNT(*)::int AS n FROM players WHERE deleted_at IS NULL AND owner_user_id IS NULL`,
    );
    if ((orphanCheck.rows[0]?.n ?? 0) > 0) {
      throw new Error(
        `[rds] 仍有 ${orphanCheck.rows[0].n} 个活跃 player 无 owner_user_id，请先运行: npm run db:finalize-players-owner`,
      );
    }

    console.log("[rds] 执行 027_players_active_owner_required.sql …");
    await client.query(readSql("027_players_active_owner_required.sql"));

    console.log("[rds] 执行 028_players_account_data.sql …");
    await client.query(readSql("028_players_account_data.sql"));

    console.log("[rds] 执行 029_orders_user_player_index.sql …");
    await client.query(readSql("029_orders_user_player_index.sql"));

    console.log("[rds] 执行 030_players_venue_member_id.sql …");
    await client.query(readSql("030_players_venue_member_id.sql"));

    console.log("[rds] 执行 031_team_venue_maps_venue_team_id.sql …");
    await client.query(readSql("031_team_venue_maps_venue_team_id.sql"));

    console.log("[rds] 执行 032_players_venue_account_key.sql …");
    await client.query(readSql("032_players_venue_account_key.sql"));

    console.log("[rds] 执行 033_sport_matcher_tables.sql …");
    await client.query(readSql("033_sport_matcher_tables.sql"));

    console.log("[rds] 执行 035_players_venue_account_key_including_deleted.sql …");
    await client.query(readSql("035_players_venue_account_key_including_deleted.sql"));

    console.log("[rds] 执行 036_team_provider_ids.sql …");
    await client.query(readSql("036_team_provider_ids.sql"));

    console.log("[rds] 执行 037_client_matches_ended_at.sql …");
    await client.query(readSql("037_client_matches_ended_at.sql"));

    console.log("[rds] 执行 038_platform_matches_rot_num.sql …");
    await client.query(readSql("038_platform_matches_rot_num.sql"));

    console.log("[rds] 执行 040_football_orders.sql …");
    await client.query(readSql("040_football_orders.sql"));

    console.log("[rds] 执行 041_football_orders_status.sql …");
    await client.query(readSql("041_football_orders_status.sql"));

    console.log("[rds] 执行 042_pod_bet_executions.sql …");
    await client.query(readSql("042_pod_bet_executions.sql"));

    console.log("[rds] 执行 043_auth_session_audit.sql …");
    await client.query(readSql("043_auth_session_audit.sql"));

    console.log("[rds] 执行 044_auth_sessions.sql …");
    await client.query(readSql("044_auth_sessions.sql"));

    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log("[rds] 当前 public 表:", tables.rows.map(r => r.tablename).join(", "));
    console.log("[rds] 完成");
  }
  finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[rds] 失败:", err.message);
  process.exit(1);
});
