-- team_platform_maps.canonical_id → gb_team_id（幂等：已 team_venue_maps 则跳过 ALTER）

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.team_platform_maps') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'team_platform_maps' AND column_name = 'canonical_id'
  ) THEN
    ALTER TABLE team_platform_maps RENAME COLUMN canonical_id TO gb_team_id;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.team_platform_maps') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_platform_maps_canonical_id_platform_platform_name_key') THEN
    ALTER TABLE team_platform_maps
      RENAME CONSTRAINT team_platform_maps_canonical_id_platform_platform_name_key
      TO team_platform_maps_gb_team_id_platform_platform_name_key;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.team_venue_maps') IS NOT NULL THEN
    EXECUTE $c$COMMENT ON COLUMN team_venue_maps.gb_team_id IS
      '标准队伍编号，FK → canonical_teams.gb_team_id；NULL = 待识别'$c$;
  ELSIF to_regclass('public.team_platform_maps') IS NOT NULL THEN
    EXECUTE $c$COMMENT ON COLUMN team_platform_maps.gb_team_id IS
      '标准队伍编号，FK → canonical_teams.gb_team_id；NULL = 待识别'$c$;
  END IF;
END $$;

COMMIT;
