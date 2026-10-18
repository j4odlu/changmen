-- odds_history — 赔率变动历史（每次 SaveBet 追加一行，不覆盖）
-- 用途：CLV 收盘线追踪、赔率走势、调线速度分析、历史回测
-- 幂等：IF NOT EXISTS

BEGIN;

CREATE TABLE IF NOT EXISTS odds_history (
  id               bigserial PRIMARY KEY,
  platform         text NOT NULL,
  source_match_id  text NOT NULL,
  source_bet_id    text NOT NULL,
  map              smallint DEFAULT 0,
  bet_name         text,
  home_odds        numeric(6,4),
  away_odds        numeric(6,4),
  is_locked        boolean DEFAULT false,
  recorded_at      bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS odds_history_lookup
  ON odds_history (platform, source_match_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS odds_history_time
  ON odds_history (recorded_at);

COMMIT;
