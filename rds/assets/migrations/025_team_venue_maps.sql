-- team_platform_maps → team_venue_maps；platform → venue（幂等）

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.team_platform_maps') IS NOT NULL
     AND to_regclass('public.team_venue_maps') IS NULL THEN
    ALTER TABLE team_platform_maps RENAME TO team_venue_maps;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.team_venue_maps') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'team_venue_maps' AND column_name = 'platform'
  ) THEN
    ALTER TABLE team_venue_maps RENAME COLUMN platform TO venue;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.team_venue_maps') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_platform_maps_platform_venue_id_key') THEN
    ALTER TABLE team_venue_maps
      RENAME CONSTRAINT team_platform_maps_platform_venue_id_key
      TO team_venue_maps_venue_venue_id_key;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_platform_maps_gb_team_id_platform_venue_name_key') THEN
    ALTER TABLE team_venue_maps
      RENAME CONSTRAINT team_platform_maps_gb_team_id_platform_venue_name_key
      TO team_venue_maps_gb_team_id_venue_venue_name_key;
  END IF;
END $$;

ALTER INDEX IF EXISTS team_platform_maps_venue_name_idx RENAME TO team_venue_maps_venue_name_idx;

DO $$
BEGIN
  IF to_regclass('public.team_venue_maps') IS NOT NULL THEN
    EXECUTE $c$COMMENT ON TABLE team_venue_maps IS '场馆队伍 → gb_team_id 映射（原 team_platform_maps）'$c$;
    EXECUTE $c$COMMENT ON COLUMN team_venue_maps.venue IS '场馆标识（OB/RAY/PB/…）'$c$;
  END IF;
END $$;

COMMIT;
