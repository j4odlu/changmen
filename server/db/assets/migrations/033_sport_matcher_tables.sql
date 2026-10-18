-- N3 sport matcher tables（与电竞 client_matches / platform_* / canonical_teams 物理隔离）
-- 棒/足等同表，用 sport + game 区分；场馆列统一 venue（不用 platform）

BEGIN;

-- ── sport_client_matches（合并输出）─────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS sport_client_matches_id_seq;

CREATE TABLE IF NOT EXISTS sport_client_matches (
  id                bigint PRIMARY KEY DEFAULT nextval('sport_client_matches_id_seq'),
  sport             text NOT NULL,
  merge_key         text,
  title             text NOT NULL,
  game              text,
  game_id           text,
  start_time        bigint,
  bo                integer,
  round             integer,
  round_start       bigint NOT NULL DEFAULT 0,
  matchs            jsonb,
  bets              jsonb,
  reverse           jsonb NOT NULL DEFAULT '[]'::jsonb,
  built_at          bigint NOT NULL,
  home_gb_team_id   bigint,
  away_gb_team_id   bigint
);

CREATE UNIQUE INDEX IF NOT EXISTS sport_client_matches_merge_key_uidx
  ON sport_client_matches (sport, merge_key)
  WHERE merge_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS sport_client_matches_sport_time
  ON sport_client_matches (sport, start_time);

CREATE INDEX IF NOT EXISTS sport_client_matches_sport_game
  ON sport_client_matches (sport, game);

CREATE INDEX IF NOT EXISTS sport_client_matches_built_at_desc
  ON sport_client_matches (built_at DESC);

SELECT setval(
  'sport_client_matches_id_seq',
  GREATEST(COALESCE((SELECT MAX(id) FROM sport_client_matches), 0), 1)
);

CREATE TABLE IF NOT EXISTS sport_client_matches_history (
  id                bigint NOT NULL,
  sport             text NOT NULL,
  merge_key         text,
  title             text NOT NULL,
  game              text,
  game_id           text,
  start_time        bigint,
  bo                integer,
  round             integer,
  round_start       bigint NOT NULL DEFAULT 0,
  matchs            jsonb,
  bets              jsonb,
  reverse           jsonb NOT NULL DEFAULT '[]'::jsonb,
  built_at          bigint NOT NULL,
  home_gb_team_id   bigint,
  away_gb_team_id   bigint,
  archived_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sport_client_matches_history_archived_at
  ON sport_client_matches_history (archived_at DESC);

CREATE INDEX IF NOT EXISTS sport_client_matches_history_sport_id
  ON sport_client_matches_history (sport, id);

-- ── sport_venue_matches / sport_venue_bets（原始）────────────────────

CREATE TABLE IF NOT EXISTS sport_venue_matches (
  sport             text NOT NULL,
  venue             text NOT NULL,
  source_match_id   text NOT NULL,
  match_id          bigint REFERENCES sport_client_matches(id) ON DELETE SET NULL,
  source_game_id    text,
  start_time        bigint,
  home_id           text,
  home              text NOT NULL,
  away_id           text,
  away              text NOT NULL,
  teams             jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at         bigint NOT NULL,
  PRIMARY KEY (sport, venue, source_match_id)
);

CREATE INDEX IF NOT EXISTS sport_venue_matches_match_id
  ON sport_venue_matches (match_id);

CREATE INDEX IF NOT EXISTS sport_venue_matches_sport_time
  ON sport_venue_matches (sport, start_time);

CREATE TABLE IF NOT EXISTS sport_venue_bets (
  sport             text NOT NULL,
  venue             text NOT NULL,
  source_match_id   text NOT NULL,
  source_bet_id     text NOT NULL,
  map               smallint NOT NULL DEFAULT 0,
  market_code       text NOT NULL DEFAULT 'moneyline',
  line              numeric,
  bet_name          text NOT NULL,
  home_odds         numeric(12,6) NOT NULL,
  away_odds         numeric(12,6) NOT NULL,
  is_locked         boolean NOT NULL DEFAULT false,
  source_home_id    text,
  source_away_id    text,
  updated_at        bigint NOT NULL,
  PRIMARY KEY (sport, venue, source_match_id, source_bet_id)
);

CREATE INDEX IF NOT EXISTS sport_venue_bets_lookup
  ON sport_venue_bets (sport, venue, source_match_id);

CREATE INDEX IF NOT EXISTS sport_venue_bets_market
  ON sport_venue_bets (sport, market_code, line);

-- ── sport team tables（与电竞 canonical_teams 隔离）──────────────────

CREATE SEQUENCE IF NOT EXISTS sport_canonical_teams_id_seq;
CREATE SEQUENCE IF NOT EXISTS sport_canonical_teams_manual_id_seq START WITH 200000;

CREATE TABLE IF NOT EXISTS sport_canonical_teams (
  id            bigint PRIMARY KEY DEFAULT nextval('sport_canonical_teams_id_seq'),
  gb_team_id    bigint UNIQUE,
  game          text NOT NULL,
  name          text NOT NULL,
  acronym       text,
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game, name)
);

CREATE OR REPLACE FUNCTION sport_canonical_teams_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := nextval('sport_canonical_teams_id_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sport_canonical_teams_before_insert_trg ON sport_canonical_teams;
CREATE TRIGGER sport_canonical_teams_before_insert_trg
  BEFORE INSERT ON sport_canonical_teams
  FOR EACH ROW
  EXECUTE FUNCTION sport_canonical_teams_before_insert();

CREATE OR REPLACE FUNCTION next_sport_manual_gb_team_id() RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nextval('sport_canonical_teams_manual_id_seq');
$$;

SELECT setval(
  'sport_canonical_teams_id_seq',
  GREATEST(COALESCE((SELECT MAX(id) FROM sport_canonical_teams), 0), 1)
);

SELECT setval(
  'sport_canonical_teams_manual_id_seq',
  GREATEST(
    COALESCE((SELECT MAX(gb_team_id) FROM sport_canonical_teams WHERE gb_team_id >= 200000), 199999),
    200000
  )
);

CREATE TABLE IF NOT EXISTS sport_team_venue_maps (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  gb_team_id      bigint REFERENCES sport_canonical_teams(gb_team_id) ON DELETE CASCADE,
  venue           text NOT NULL,
  venue_team_id   text,
  venue_name      text NOT NULL,
  game            text,
  source          text NOT NULL DEFAULT 'manual',
  confidence      numeric(3,2) NOT NULL DEFAULT 1.00,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue, venue_team_id, game),
  UNIQUE (gb_team_id, venue, venue_name)
);

CREATE INDEX IF NOT EXISTS sport_team_venue_maps_venue_name_idx
  ON sport_team_venue_maps (venue, venue_name);

CREATE INDEX IF NOT EXISTS sport_team_venue_maps_game
  ON sport_team_venue_maps (game);

-- ── 主客覆盖（对标 client_match_platform_overrides）──────────────────

CREATE TABLE IF NOT EXISTS sport_client_match_venue_overrides (
  client_match_id bigint NOT NULL REFERENCES sport_client_matches(id) ON DELETE CASCADE,
  venue           text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('force_aligned', 'force_reversed')),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_match_id, venue)
);

CREATE INDEX IF NOT EXISTS sport_client_match_venue_overrides_cm
  ON sport_client_match_venue_overrides (client_match_id);

COMMIT;
