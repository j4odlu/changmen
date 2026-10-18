-- team_platform_maps: platform_id → venue_id, platform_name → venue_name（幂等）

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.team_platform_maps') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'team_platform_maps' AND column_name = 'platform_id'
  ) THEN
    ALTER TABLE team_platform_maps RENAME COLUMN platform_id TO venue_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'team_platform_maps' AND column_name = 'platform_name'
  ) THEN
    ALTER TABLE team_platform_maps RENAME COLUMN platform_name TO venue_name;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.team_platform_maps') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_platform_maps_platform_platform_id_key') THEN
    ALTER TABLE team_platform_maps
      RENAME CONSTRAINT team_platform_maps_platform_platform_id_key
      TO team_platform_maps_platform_venue_id_key;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_platform_maps_gb_team_id_platform_platform_name_key') THEN
    ALTER TABLE team_platform_maps
      RENAME CONSTRAINT team_platform_maps_gb_team_id_platform_platform_name_key
      TO team_platform_maps_gb_team_id_platform_venue_name_key;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_platform_maps_canonical_id_platform_platform_name_key') THEN
    ALTER TABLE team_platform_maps
      RENAME CONSTRAINT team_platform_maps_canonical_id_platform_platform_name_key
      TO team_platform_maps_gb_team_id_platform_venue_name_key;
  END IF;
END $$;

ALTER INDEX IF EXISTS team_platform_maps_name_idx RENAME TO team_platform_maps_venue_name_idx;

DO $$
BEGIN
  IF to_regclass('public.team_venue_maps') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'team_venue_maps' AND column_name = 'venue_id'
    ) THEN
      EXECUTE $c$COMMENT ON COLUMN team_venue_maps.venue_id IS '场馆侧队伍 ID（SaveMatch HomeID/AwayID 等）'$c$;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'team_venue_maps' AND column_name = 'venue_team_id'
    ) THEN
      EXECUTE $c$COMMENT ON COLUMN team_venue_maps.venue_team_id IS '场馆侧队伍 ID（SaveMatch HomeID/AwayID 等）'$c$;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'team_venue_maps' AND column_name = 'venue_name'
    ) THEN
      EXECUTE $c$COMMENT ON COLUMN team_venue_maps.venue_name IS '场馆侧队名'$c$;
    END IF;
  ELSIF to_regclass('public.team_platform_maps') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'team_platform_maps' AND column_name = 'venue_id'
    ) THEN
      EXECUTE $c$COMMENT ON COLUMN team_platform_maps.venue_id IS '场馆侧队伍 ID（SaveMatch HomeID/AwayID 等）'$c$;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'team_platform_maps' AND column_name = 'venue_name'
    ) THEN
      EXECUTE $c$COMMENT ON COLUMN team_platform_maps.venue_name IS '场馆侧队名'$c$;
    END IF;
  END IF;
END $$;

COMMIT;
