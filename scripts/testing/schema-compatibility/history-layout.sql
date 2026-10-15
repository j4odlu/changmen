-- Test-only historical shape. Handwritten, not a dump or a production migration.
-- 014 CREATE TABLE IF NOT EXISTS did not reconcile pre-existing archive tables.
ALTER TABLE client_matches_history
  ALTER COLUMN archived_at DROP DEFAULT,
  ALTER COLUMN archived_at TYPE bigint USING (EXTRACT(epoch FROM archived_at)*1000)::bigint,
  ALTER COLUMN archived_at SET DEFAULT ((EXTRACT(epoch FROM now()) * (1000)::numeric))::bigint,
  ALTER COLUMN bo TYPE smallint,
  ALTER COLUMN built_at DROP NOT NULL,
  ALTER COLUMN id TYPE integer,
  ALTER COLUMN id DROP NOT NULL,
  ALTER COLUMN reverse DROP NOT NULL,
  ALTER COLUMN reverse DROP DEFAULT,
  ALTER COLUMN round TYPE smallint,
  ALTER COLUMN title DROP NOT NULL;
ALTER TABLE platform_matches_history
  ALTER COLUMN archived_at DROP DEFAULT,
  ALTER COLUMN archived_at TYPE bigint USING (EXTRACT(epoch FROM archived_at)*1000)::bigint,
  ALTER COLUMN archived_at SET DEFAULT ((EXTRACT(epoch FROM now()) * (1000)::numeric))::bigint,
  ALTER COLUMN away DROP NOT NULL,
  ALTER COLUMN home DROP NOT NULL,
  ALTER COLUMN match_id TYPE integer,
  ALTER COLUMN synced_at DROP NOT NULL,
  ALTER COLUMN teams DROP NOT NULL;
-- 025/031 rename the table and selected unique constraints, retaining these names.
ALTER TABLE team_venue_maps RENAME CONSTRAINT team_venue_maps_gb_team_id_fkey TO team_platform_maps_canonical_id_fkey;
ALTER TABLE team_venue_maps RENAME CONSTRAINT team_venue_maps_pkey TO team_platform_maps_pkey;
ALTER SEQUENCE team_venue_maps_id_seq RENAME TO team_platform_maps_id_seq;
