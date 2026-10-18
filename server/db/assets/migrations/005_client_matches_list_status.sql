-- LEGACY: client_matches.list_status was used for browser visibility.
-- Migration 015 drops this column; active client_matches now means visible.

ALTER TABLE client_matches
  ADD COLUMN IF NOT EXISTS list_status smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN client_matches.list_status IS
  'LEGACY: 015_prune_indexes_and_drop_list_status.sql drops this column';
