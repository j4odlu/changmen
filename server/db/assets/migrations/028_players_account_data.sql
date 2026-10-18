-- players 存完整账号载荷（凭证/限额等），profiles.accounts 不再写入
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/028_players_account_data.sql

BEGIN;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT '';

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS account_data jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS players_owner_active
  ON players (owner_user_id)
  WHERE deleted_at IS NULL;

COMMIT;
