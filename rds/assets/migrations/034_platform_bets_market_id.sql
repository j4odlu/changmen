-- PredictFun 等：盘口 orderbook marketId（与 source_home_id token 不同）
ALTER TABLE platform_bets
  ADD COLUMN IF NOT EXISTS market_id text;
