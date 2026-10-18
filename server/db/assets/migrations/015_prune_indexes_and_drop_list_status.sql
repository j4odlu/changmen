-- Prune / matcher hot-path indexes and removal of the legacy list_status column.
-- Active client_matches now means visible; hidden/expired rows live in client_matches_history.

CREATE INDEX IF NOT EXISTS client_matches_built_at_desc
  ON client_matches(built_at DESC);

CREATE INDEX IF NOT EXISTS platform_matches_synced_at
  ON platform_matches(synced_at);

CREATE INDEX IF NOT EXISTS platform_matches_platform_synced_at
  ON platform_matches(platform, synced_at);

CREATE INDEX IF NOT EXISTS platform_bets_updated_at
  ON platform_bets(updated_at);

CREATE INDEX IF NOT EXISTS platform_bets_platform_updated_at
  ON platform_bets(platform, updated_at);

CREATE INDEX IF NOT EXISTS live_timers_updated_at
  ON live_timers(updated_at);

CREATE INDEX IF NOT EXISTS live_timers_platform_updated_at
  ON live_timers(platform, updated_at);

CREATE INDEX IF NOT EXISTS client_matches_history_built_at_desc
  ON client_matches_history(built_at DESC);

ALTER TABLE client_matches
  DROP COLUMN IF EXISTS list_status;
