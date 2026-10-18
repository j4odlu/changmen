-- platform_bets.line_id：PB euro/odds moneyLine.lineId（下注线号）
-- [changmen 扩展] A8 SaveBet / GetMatchs 无此字段；旧客户端忽略 Sources.LineID，仍用本机 lineCache
ALTER TABLE platform_bets
  ADD COLUMN IF NOT EXISTS line_id bigint;

COMMENT ON COLUMN platform_bets.line_id IS
  'PB moneyLine.lineId；可选。非 PB / 未上报时为 NULL';
