-- team_venue_maps.venue_id → venue_team_id（幂等）
-- 语义：场馆侧队伍 ID（SaveMatch HomeID/AwayID 等），非场馆本身的 id

DO $$
BEGIN
  IF to_regclass('public.team_venue_maps') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'team_venue_maps' AND column_name = 'venue_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'team_venue_maps' AND column_name = 'venue_team_id'
  ) THEN
    ALTER TABLE team_venue_maps RENAME COLUMN venue_id TO venue_team_id;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_venue_maps_venue_venue_id_key') THEN
    ALTER TABLE team_venue_maps
      RENAME CONSTRAINT team_venue_maps_venue_venue_id_key
      TO team_venue_maps_venue_venue_team_id_key;
  END IF;

  -- 历史约束名（024 曾用）
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_platform_maps_platform_venue_id_key') THEN
    ALTER TABLE team_venue_maps
      RENAME CONSTRAINT team_platform_maps_platform_venue_id_key
      TO team_venue_maps_venue_venue_team_id_key;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.team_venue_maps') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'team_venue_maps' AND column_name = 'venue_team_id'
     ) THEN
    EXECUTE $c$COMMENT ON COLUMN team_venue_maps.venue_team_id IS
      '场馆侧队伍 ID（SaveMatch HomeID/AwayID 等）'$c$;
  END IF;
END $$;
