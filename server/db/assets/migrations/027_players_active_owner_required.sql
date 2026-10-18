-- 活跃 player 必须有 owner_user_id（跑 finalize-players-owner-user-id.mjs 后再 apply）
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/027_players_active_owner_required.sql

BEGIN;

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_active_requires_owner;

ALTER TABLE players ADD CONSTRAINT players_active_requires_owner
  CHECK (deleted_at IS NOT NULL OR owner_user_id IS NOT NULL);

COMMIT;
