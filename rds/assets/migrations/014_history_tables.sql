-- client/platform match history tables used by matcher prune and manual archive ops.

BEGIN;

CREATE TABLE IF NOT EXISTS client_matches_history (
  id          bigint NOT NULL,
  title       text NOT NULL,
  game        text,
  game_id     text,
  start_time  bigint,
  bo          integer,
  round       integer,
  matchs      jsonb,
  bets        jsonb,
  reverse     jsonb NOT NULL DEFAULT '[]'::jsonb,
  built_at    bigint NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_matches_history_archived_at
  ON client_matches_history(archived_at DESC);

CREATE INDEX IF NOT EXISTS client_matches_history_id
  ON client_matches_history(id);

CREATE TABLE IF NOT EXISTS platform_matches_history (
  platform        text NOT NULL,
  source_match_id text NOT NULL,
  source_game_id  text,
  start_time      bigint,
  home_id         text,
  home            text NOT NULL,
  away_id         text,
  away            text NOT NULL,
  bo              smallint,
  is_live         smallint,
  teams           jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at       bigint NOT NULL,
  match_id        bigint,
  archived_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_matches_history_archived_at
  ON platform_matches_history(archived_at DESC);

CREATE INDEX IF NOT EXISTS platform_matches_history_platform_source
  ON platform_matches_history(platform, source_match_id);

COMMIT;
