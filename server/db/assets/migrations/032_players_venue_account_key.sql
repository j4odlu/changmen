-- players.venue_account_key：全库场馆投注账号指纹（跨用户互斥）
-- 优先 provider+venue_member_id；否则 sha256(gateway+token) 见 server/db/venue_account_key.js
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/032_players_venue_account_key.sql
-- 凭证类 key 需再跑: node scripts/backfill-players-venue-account-key.mjs

BEGIN;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS venue_account_key text NOT NULL DEFAULT '';

UPDATE players
SET venue_account_key = lower(trim(provider)) || ':member:' || trim(venue_member_id)
WHERE deleted_at IS NULL
  AND venue_account_key = ''
  AND venue_member_id <> ''
  AND provider <> '';

CREATE UNIQUE INDEX IF NOT EXISTS players_venue_account_key_active
  ON players (venue_account_key)
  WHERE deleted_at IS NULL
    AND venue_account_key <> '';

CREATE INDEX IF NOT EXISTS players_venue_account_key_lookup
  ON players (venue_account_key)
  WHERE deleted_at IS NULL
    AND venue_account_key <> '';

COMMIT;
