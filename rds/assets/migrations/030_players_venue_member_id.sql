-- players.venue_member_id：场馆会员 ID（与 account_data.venueMemberId 同步）
-- 活跃账号按 (owner_user_id, provider, venue_member_id) 唯一（非空时）
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/030_players_venue_member_id.sql

BEGIN;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS venue_member_id text NOT NULL DEFAULT '';

-- 从 account_data 回填 venue_member_id / provider
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
  );

UPDATE players
SET provider = NULLIF(TRIM(account_data->>'provider'), '')
WHERE deleted_at IS NULL
  AND provider = ''
  AND NULLIF(TRIM(account_data->>'provider'), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS players_owner_provider_venue_member_active
  ON players (owner_user_id, provider, venue_member_id)
  WHERE deleted_at IS NULL
    AND owner_user_id IS NOT NULL
    AND venue_member_id <> ''
    AND provider <> '';

CREATE INDEX IF NOT EXISTS players_owner_provider_venue_member_lookup
  ON players (owner_user_id, provider, venue_member_id)
  WHERE deleted_at IS NULL
    AND venue_member_id <> ''
    AND provider <> '';

COMMIT;
