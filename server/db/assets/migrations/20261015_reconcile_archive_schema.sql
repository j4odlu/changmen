-- One canonical schema: reconcile pre-existing archive tables with 014 and
-- object names with 001/025. No historical data migration is replayed.
-- Execute in a transaction; maintenance runner verifies data before COMMIT.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;
LOCK TABLE client_matches_history, platform_matches_history, team_venue_maps IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE tab text; typ text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['client_matches_history','platform_matches_history'] LOOP
    SELECT format_type(a.atttypid,a.atttypmod) INTO typ
      FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||tab) AND a.attname='archived_at' AND NOT a.attisdropped;
    IF typ = 'bigint' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN archived_at DROP DEFAULT',tab);
      -- Split into whole seconds + remaining milliseconds: avoid a floating
      -- point division of the full epoch. UTC literal makes timezone irrelevant.
      EXECUTE format('ALTER TABLE %I ALTER COLUMN archived_at TYPE timestamptz USING '
        || '(TIMESTAMPTZ ''epoch'' + (archived_at / 1000) * INTERVAL ''1 second'' '
        || '+ (archived_at %% 1000) * INTERVAL ''1 millisecond'')',tab);
    ELSIF typ IS DISTINCT FROM 'timestamp with time zone' THEN
      RAISE EXCEPTION 'Unexpected %.archived_at type: %',tab,typ;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN archived_at SET DEFAULT now(), ALTER COLUMN archived_at SET NOT NULL',tab);
  END LOOP;
END $$;

-- These constraints already hold for current writers. NULLs cause rollback;
-- never invent replacement values or delete rows to make a constraint pass.
ALTER TABLE client_matches_history
  ALTER COLUMN id TYPE bigint, ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN bo TYPE integer, ALTER COLUMN round TYPE integer,
  ALTER COLUMN title SET NOT NULL, ALTER COLUMN built_at SET NOT NULL,
  ALTER COLUMN reverse SET NOT NULL, ALTER COLUMN reverse SET DEFAULT '[]'::jsonb;
ALTER TABLE platform_matches_history
  ALTER COLUMN match_id TYPE bigint,
  ALTER COLUMN home SET NOT NULL, ALTER COLUMN away SET NOT NULL,
  ALTER COLUMN synced_at SET NOT NULL, ALTER COLUMN teams SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.team_venue_maps'::regclass AND conname='team_platform_maps_canonical_id_fkey') THEN
    ALTER TABLE team_venue_maps RENAME CONSTRAINT team_platform_maps_canonical_id_fkey TO team_venue_maps_gb_team_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.team_venue_maps'::regclass AND conname='team_platform_maps_pkey') THEN
    -- Renaming a primary-key constraint also renames its index; retain OIDs.
    ALTER TABLE team_venue_maps RENAME CONSTRAINT team_platform_maps_pkey TO team_venue_maps_pkey;
  END IF;
  IF to_regclass('public.team_platform_maps_id_seq') IS NOT NULL THEN
    IF pg_get_serial_sequence('public.team_venue_maps','id') IS DISTINCT FROM 'public.team_platform_maps_id_seq' THEN
      RAISE EXCEPTION 'Unexpected owner of team_platform_maps_id_seq';
    END IF;
    ALTER SEQUENCE team_platform_maps_id_seq RENAME TO team_venue_maps_id_seq;
  END IF;
END $$;
COMMIT;
