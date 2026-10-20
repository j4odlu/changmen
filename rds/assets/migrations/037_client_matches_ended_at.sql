-- Lifecycle: ended stays in client_matches (ended_at set); GetMatchs only sees ended_at IS NULL.
-- Replaces “move to client_matches_history” as the primary end-of-match signal.

ALTER TABLE client_matches
  ADD COLUMN IF NOT EXISTS ended_at bigint NULL;

COMMENT ON COLUMN client_matches.ended_at IS
  'Epoch ms when match ended; NULL = active (visible to Client_GetMatchs)';

CREATE INDEX IF NOT EXISTS idx_client_matches_active
  ON client_matches (start_time ASC NULLS LAST)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_matches_ended
  ON client_matches (ended_at DESC NULLS LAST)
  WHERE ended_at IS NOT NULL;
