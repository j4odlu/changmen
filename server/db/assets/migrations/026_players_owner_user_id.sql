-- players 归属用户：每用户独立 (platform, player_name) 命名空间
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/026_players_owner_user_id.sql
--
-- 幂等：IF NOT EXISTS。存量数据需再跑 scripts/ops/migrations/migrate-players-owner-user-id.mjs

BEGIN;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS players_owner_user_id
  ON players (owner_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS players_owner_platform_name_active
  ON players (owner_user_id, platform_id, player_name)
  WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL;

COMMIT;
