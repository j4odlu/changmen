-- 放宽赔率精度：Polymarket 等概率盘会产生 100+ / 1000+ 欧赔
-- numeric(6,4) 最大仅 99.9999，会导致 platform_bets 写入 numeric field overflow

BEGIN;

ALTER TABLE IF EXISTS platform_bets
  ALTER COLUMN home_odds TYPE numeric(12,4),
  ALTER COLUMN away_odds TYPE numeric(12,4);

ALTER TABLE IF EXISTS odds_history
  ALTER COLUMN home_odds TYPE numeric(12,4),
  ALTER COLUMN away_odds TYPE numeric(12,4);

ALTER TABLE IF EXISTS value_signals
  ALTER COLUMN sharp_home_odds TYPE numeric(12,4),
  ALTER COLUMN sharp_away_odds TYPE numeric(12,4),
  ALTER COLUMN fair_odds TYPE numeric(12,4),
  ALTER COLUMN soft_odds TYPE numeric(12,4);

COMMIT;
