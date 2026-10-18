-- changmen RDS PostgreSQL baseline（去 Supabase：无 auth.users / RLS / Realtime）
-- 应用：在香港轻量服务器上执行（需已内网连通 RDS）
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_baseline.sql
--
-- 幂等：使用 IF NOT EXISTS / OR REPLACE，可重复执行（已有表则跳过创建）。

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 认证（替代 Supabase Auth）────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name     text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    bigint NOT NULL,
  updated_at    bigint NOT NULL
);

-- ── profiles（业务用户配置，id = users.id）────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  user_name       text NOT NULL UNIQUE,
  accounts        jsonb NOT NULL DEFAULT '[]',
  betting_config  jsonb NOT NULL DEFAULT '{}',
  collect_config  jsonb NOT NULL DEFAULT '{}',
  preferences     jsonb NOT NULL DEFAULT '{}',
  created_at      bigint NOT NULL,
  updated_at      bigint NOT NULL
);

-- ── orders ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  player_id  bigint NOT NULL,
  order_id   text NOT NULL,
  link       bigint,
  provider   text,
  match      text,
  bet        text,
  item       text,
  odds       double precision NOT NULL DEFAULT 0,
  bet_money  double precision NOT NULL DEFAULT 0,
  money      double precision NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'None',
  create_at  bigint NOT NULL,
  raw        jsonb NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_user_order
  ON orders(user_id, order_id, player_id);

CREATE INDEX IF NOT EXISTS orders_user_date
  ON orders(user_id, create_at);

-- ── client_matches（matcher 输出，浏览器只读）────────────────────────

CREATE SEQUENCE IF NOT EXISTS client_matches_id_seq;

CREATE TABLE IF NOT EXISTS client_matches (
  id           bigint PRIMARY KEY DEFAULT nextval('client_matches_id_seq'),
  merge_key    text,
  title        text NOT NULL,
  game         text,
  game_id      text,
  start_time   bigint,
  bo           integer,
  round        integer,
  round_start  bigint NOT NULL DEFAULT 0,
  matchs       jsonb,
  bets         jsonb,
  reverse      jsonb NOT NULL DEFAULT '[]'::jsonb,
  built_at     bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS client_matches_merge_key_uidx
  ON client_matches(merge_key)
  WHERE merge_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_matches_game ON client_matches(game_id);
CREATE INDEX IF NOT EXISTS client_matches_time ON client_matches(start_time);

SELECT setval(
  'client_matches_id_seq',
  GREATEST(COALESCE((SELECT MAX(id) FROM client_matches), 0), 1)
);

-- ── platform_matches / platform_bets / live_timers ────────────────────

CREATE TABLE IF NOT EXISTS platform_matches (
  platform        text NOT NULL,
  source_match_id text NOT NULL,
  match_id        bigint REFERENCES client_matches(id) ON DELETE SET NULL,
  source_game_id  text,
  start_time      bigint,
  home_id         text,
  home            text NOT NULL,
  away_id         text,
  away            text NOT NULL,
  bo              smallint,
  teams           jsonb NOT NULL DEFAULT '[]',
  synced_at       bigint NOT NULL,
  PRIMARY KEY (platform, source_match_id)
);

CREATE TABLE IF NOT EXISTS platform_bets (
  platform        text NOT NULL,
  source_match_id text NOT NULL,
  source_bet_id   text NOT NULL,
  map             smallint NOT NULL DEFAULT 0,
  bet_name        text NOT NULL,
  home_odds       numeric(6,4) NOT NULL,
  away_odds       numeric(6,4) NOT NULL,
  is_locked       boolean NOT NULL DEFAULT false,
  source_home_id  text,
  source_away_id  text,
  updated_at      bigint NOT NULL,
  PRIMARY KEY (platform, source_match_id, source_bet_id)
);

CREATE TABLE IF NOT EXISTS live_timers (
  platform        text NOT NULL,
  source_match_id text NOT NULL,
  round           smallint NOT NULL,
  round_start     bigint NOT NULL,
  updated_at      bigint NOT NULL,
  PRIMARY KEY (platform, source_match_id)
);

CREATE INDEX IF NOT EXISTS platform_matches_match_id ON platform_matches(match_id);
CREATE INDEX IF NOT EXISTS platform_matches_platform ON platform_matches(platform);
CREATE INDEX IF NOT EXISTS platform_matches_start_time ON platform_matches(start_time);
CREATE INDEX IF NOT EXISTS platform_bets_match ON platform_bets(platform, source_match_id);

-- ── canonical_teams / team_venue_maps ──────────────────────────────

CREATE SEQUENCE IF NOT EXISTS canonical_teams_id_seq;
CREATE SEQUENCE IF NOT EXISTS canonical_teams_manual_id_seq START WITH 100000;

CREATE TABLE IF NOT EXISTS canonical_teams (
  id            bigint PRIMARY KEY DEFAULT nextval('canonical_teams_id_seq'),
  gb_team_id    bigint UNIQUE,
  game          text NOT NULL,
  name          text NOT NULL,
  acronym       text,
  pandascore_id integer,
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game, name)
);

CREATE TABLE IF NOT EXISTS team_venue_maps (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  gb_team_id    bigint REFERENCES canonical_teams(gb_team_id) ON DELETE CASCADE,
  venue         text NOT NULL,
  venue_team_id text,
  venue_name    text NOT NULL,
  game          text,
  source        text NOT NULL DEFAULT 'manual',
  confidence    numeric(3,2) NOT NULL DEFAULT 1.00,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue, venue_team_id),
  UNIQUE (gb_team_id, venue, venue_name)
);

CREATE INDEX IF NOT EXISTS team_venue_maps_venue_name_idx
  ON team_venue_maps(venue, venue_name);

CREATE OR REPLACE FUNCTION canonical_teams_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := nextval('canonical_teams_id_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonical_teams_before_insert_trg ON canonical_teams;
CREATE TRIGGER canonical_teams_before_insert_trg
  BEFORE INSERT ON canonical_teams
  FOR EACH ROW
  EXECUTE FUNCTION canonical_teams_before_insert();

CREATE OR REPLACE FUNCTION next_manual_gb_team_id() RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nextval('canonical_teams_manual_id_seq');
$$;

SELECT setval(
  'canonical_teams_id_seq',
  GREATEST(COALESCE((SELECT MAX(id) FROM canonical_teams), 0), 1)
);

SELECT setval(
  'canonical_teams_manual_id_seq',
  GREATEST(
    COALESCE((SELECT MAX(gb_team_id) FROM canonical_teams WHERE gb_team_id >= 100000), 99999),
    100000
  )
);

COMMIT;
