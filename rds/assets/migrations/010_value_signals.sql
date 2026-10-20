-- value_signals — 正EV信号记录表
-- 应用：psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/010_value_signals.sql
-- 幂等：IF NOT EXISTS

BEGIN;

CREATE TABLE IF NOT EXISTS value_signals (
  id               bigserial PRIMARY KEY,
  match_id         bigint NOT NULL,
  match_title      text,
  game             text,
  start_time       bigint,
  bet_name         text,
  map              smallint DEFAULT 0,
  home_name        text,
  away_name        text,

  -- 锐利盘（PB）
  sharp_platform   text NOT NULL,
  sharp_home_odds  numeric(6,4),
  sharp_away_odds  numeric(6,4),
  overround        numeric(6,4),

  -- 去vig公平赔率
  fair_odds        numeric(6,4),

  -- 软盘机会
  soft_platform    text NOT NULL,
  soft_side        text NOT NULL,
  soft_odds        numeric(6,4),

  -- 计算值
  edge             numeric(8,5),
  kelly_full       numeric(8,5),
  kelly_frac       numeric(8,5),
  true_prob        numeric(8,5),

  -- 追踪
  status           text NOT NULL DEFAULT 'open',
  bet_placed       boolean DEFAULT false,
  bet_amount       numeric(12,2),
  result           text,
  pnl              numeric(12,2),

  created_at       timestamptz NOT NULL DEFAULT now(),
  expired_at       timestamptz,
  resolved_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS value_signals_dedup
  ON value_signals (match_id, bet_name, map, soft_platform, soft_side)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS value_signals_status ON value_signals (status);
CREATE INDEX IF NOT EXISTS value_signals_created ON value_signals (created_at);
CREATE INDEX IF NOT EXISTS value_signals_edge ON value_signals (edge DESC) WHERE status = 'open';

COMMIT;
